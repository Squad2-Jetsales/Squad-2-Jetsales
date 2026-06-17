// server/src/modules/ai/knowledge/knowledge.service.js
//
// Orquestração de knowledge bases + documentos + ingestão (F3.2).
// Todas as queries são tenant-scoped: KBs filtram por organization_id; docs
// passam pelos guards (assertKbOwned/assertDocOwned). Operações multi-tabela
// em db.transaction(). O processamento pesado (parse/chunk/embed) roda no
// ingestion.worker via fila — aqui só enfileiramos.

const db = require('../../../database');
const { httpError } = require('../../../middlewares/error.middleware');
const { assertKbOwned, assertDocOwned } = require('./knowledge.guards');
const { enqueueIngestion } = require('../ingestion/ingestion.queue');
const storage = require('../ingestion/storage');
const { toKnowledgeBase, toKnowledgeDocument, toIngestionJob } = require('./knowledge.mapper');

const KB = 'knowledge_bases';
const DOC = 'knowledge_documents';
const JOB = 'knowledge_ingestion_jobs';

const MIME_TO_EXT = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/msword': '.doc',
  'text/html': '.html',
  'text/plain': '.txt',
  'text/markdown': '.md',
};

function extFromName(name) {
  const m = (name || '').match(/\.[a-z0-9]+$/i);
  return m ? m[0].toLowerCase() : '';
}
function extFromMime(mime) {
  return MIME_TO_EXT[(mime || '').toLowerCase()] || '';
}

/* ----------------------------- Knowledge bases ---------------------------- */

async function listKbs(organizationId, { chatbotId } = {}) {
  const q = db(KB).where({ organization_id: organizationId }).orderBy('created_at', 'desc');
  if (chatbotId) q.andWhere({ chatbot_id: chatbotId });
  const rows = await q;
  return rows.map(toKnowledgeBase);
}

async function getKb(organizationId, kbId) {
  const kb = await assertKbOwned(organizationId, kbId);
  return toKnowledgeBase(kb);
}

async function createKb(organizationId, { chatbotId, name, embeddingModel, chunkSize, chunkOverlap }) {
  // O chatbot precisa ser da mesma org (tenancy).
  const chatbot = await db('chatbots')
    .where({ id: chatbotId, organization_id: organizationId })
    .first();
  if (!chatbot) throw httpError(404, 'Chatbot não encontrado', 'CHATBOT_NOT_FOUND');

  const insert = { organization_id: organizationId, chatbot_id: chatbotId, name };
  if (embeddingModel) insert.embedding_model = embeddingModel;
  if (chunkSize != null) insert.chunk_size = chunkSize;
  if (chunkOverlap != null) insert.chunk_overlap = chunkOverlap;

  const [row] = await db(KB).insert(insert).returning('*');
  return toKnowledgeBase(row);
}

async function updateKb(organizationId, kbId, patch) {
  await assertKbOwned(organizationId, kbId);

  const update = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.embeddingModel !== undefined) update.embedding_model = patch.embeddingModel;
  if (patch.chunkSize !== undefined) update.chunk_size = patch.chunkSize;
  if (patch.chunkOverlap !== undefined) update.chunk_overlap = patch.chunkOverlap;

  if (Object.keys(update).length === 0) return getKb(organizationId, kbId);

  update.updated_at = db.fn.now();
  const [row] = await db(KB)
    .where({ id: kbId, organization_id: organizationId })
    .update(update)
    .returning('*');
  return toKnowledgeBase(row);
}

async function deleteKb(organizationId, kbId) {
  await assertKbOwned(organizationId, kbId);
  // Coleta os arquivos antes do cascade (FK ON DELETE CASCADE remove docs/chunks/jobs).
  const docs = await db(DOC).where({ knowledge_base_id: kbId }).select('storage_key');
  await db(KB).where({ id: kbId, organization_id: organizationId }).del();
  await Promise.all(docs.map((d) => storage.remove(d.storage_key).catch(() => {})));
}

/* -------------------------------- Documents ------------------------------- */

const DOC_LIST_COLUMNS = [
  'id',
  'knowledge_base_id',
  'title',
  'source_url',
  'status',
  'mime_type',
  'file_size_bytes',
  'chunk_count',
  'tokens_used',
  'checksum',
  'metadata',
  'indexed_at',
  'created_at',
  'updated_at',
];

async function listDocuments(organizationId, kbId, { status, cursor, limit } = {}) {
  await assertKbOwned(organizationId, kbId);

  const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const q = db(DOC)
    .where({ knowledge_base_id: kbId })
    .select(DOC_LIST_COLUMNS)
    .orderBy('created_at', 'desc')
    .limit(lim + 1);
  if (status) q.andWhere({ status });
  if (cursor) q.andWhere('created_at', '<', cursor);

  const rows = await q;
  const hasMore = rows.length > lim;
  const page = hasMore ? rows.slice(0, lim) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map(toKnowledgeDocument),
    nextCursor: hasMore && last ? new Date(last.created_at).toISOString() : null,
  };
}

async function createDocument(organizationId, kbId, { title, content, sourceUrl, file }) {
  await assertKbOwned(organizationId, kbId);

  let mimeType;
  let fileSizeBytes;
  let checksum;
  let resolvedTitle = title;
  const textContent = content != null ? String(content) : null;

  if (file) {
    checksum = storage.sha256(file.buffer);
    mimeType = file.mimetype || null;
    fileSizeBytes = file.size ?? file.buffer.length;
    resolvedTitle = title || file.originalname;
  } else {
    if (!textContent || !textContent.trim()) {
      throw httpError(400, 'Informe um arquivo (file) ou um content de texto', 'DOCUMENT_EMPTY');
    }
    checksum = storage.sha256(Buffer.from(textContent, 'utf-8'));
    mimeType = 'text/plain';
    fileSizeBytes = Buffer.byteLength(textContent, 'utf-8');
    resolvedTitle = title || 'Documento de texto';
  }

  // Dedupe por checksum dentro da MESMA KB.
  const dup = await db(DOC).where({ knowledge_base_id: kbId, checksum }).first();
  if (dup) {
    throw httpError(409, 'Documento idêntico já existe nesta base', 'DOCUMENT_DUPLICATE', {
      documentId: dup.id,
    });
  }

  const { doc, job } = await db.transaction(async (trx) => {
    const [created] = await trx(DOC)
      .insert({
        knowledge_base_id: kbId,
        title: resolvedTitle,
        content: file ? null : textContent,
        source_url: sourceUrl || null,
        status: 'uploaded',
        mime_type: mimeType,
        file_size_bytes: fileSizeBytes,
        checksum,
        metadata: {},
      })
      .returning('*');

    if (file) {
      const ext = extFromName(file.originalname) || extFromMime(file.mimetype);
      const storageKey = await storage.save(file.buffer, {
        orgId: organizationId,
        docId: created.id,
        ext,
      });
      await trx(DOC).where({ id: created.id }).update({ storage_key: storageKey });
      created.storage_key = storageKey;
    }

    const [createdJob] = await trx(JOB)
      .insert({ document_id: created.id, status: 'pending' })
      .returning('*');

    return { doc: created, job: createdJob };
  });

  // Enfileira só após o commit (o worker não pode ver o doc antes de existir).
  try {
    await enqueueIngestion({ documentId: doc.id, jobId: job.id });
  } catch (err) {
    await db(JOB)
      .where({ id: job.id })
      .update({ status: 'failed', error: err.message, finished_at: new Date() });
    throw httpError(503, 'Falha ao enfileirar ingestão (Redis indisponível?)', 'INGESTION_ENQUEUE_FAILED');
  }

  return toKnowledgeDocument(doc);
}

async function getDocument(organizationId, documentId) {
  const doc = await assertDocOwned(organizationId, documentId);
  const latestJob = await db(JOB)
    .where({ document_id: documentId })
    .orderBy('created_at', 'desc')
    .first();
  return { ...toKnowledgeDocument(doc), latestJob: toIngestionJob(latestJob) };
}

async function deleteDocument(organizationId, documentId) {
  const doc = await assertDocOwned(organizationId, documentId);
  await db(DOC).where({ id: documentId }).del(); // cascade → chunks + jobs
  await storage.remove(doc.storage_key).catch(() => {});
}

async function reindexDocument(organizationId, documentId) {
  await assertDocOwned(organizationId, documentId);

  const [job] = await db(JOB)
    .insert({ document_id: documentId, status: 'pending' })
    .returning('*');
  await db(DOC).where({ id: documentId }).update({ status: 'indexing', updated_at: db.fn.now() });

  try {
    await enqueueIngestion({ documentId, jobId: job.id });
  } catch (err) {
    await db(JOB)
      .where({ id: job.id })
      .update({ status: 'failed', error: err.message, finished_at: new Date() });
    throw httpError(503, 'Falha ao enfileirar reindexação (Redis indisponível?)', 'INGESTION_ENQUEUE_FAILED');
  }

  return toIngestionJob(job);
}

module.exports = {
  listKbs,
  getKb,
  createKb,
  updateKb,
  deleteKb,
  listDocuments,
  createDocument,
  getDocument,
  deleteDocument,
  reindexDocument,
};
