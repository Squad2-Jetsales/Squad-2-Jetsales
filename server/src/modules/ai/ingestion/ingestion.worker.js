// server/src/modules/ai/ingestion/ingestion.worker.js
//
// Consumer da fila de ingestão. Para cada documento:
//   parse → chunk → embed (batches de 50) → upsert em knowledge_chunks.
// Atualiza knowledge_documents.status e knowledge_ingestion_jobs ao longo do
// ciclo de vida. Roda como processo separado (`npm run worker`) para que o
// upload nunca bloqueie a request HTTP.
//
// Tenancy: o worker opera por documentId/jobId já validados (a posse pela org
// é checada no momento do upload, em knowledge.guards). A org usada na
// auditoria de custo vem de knowledge_bases.organization_id.

const { Worker } = require('bullmq');
const db = require('../../../database');
const { resolveEmbeddingProvider } = require('../providers');
const { logUsage } = require('../observability/usage.logger');
const { parseDocument } = require('./parsers');
const { chunkText } = require('./chunker');

const QUEUE_NAME = 'ingestion';
const BATCH_SIZE = 50; // chunks por chamada de embed
const connection = { url: process.env.REDIS_URL || 'redis://localhost:6379' };
const concurrency = Number(process.env.INGESTION_CONCURRENCY) || 4;

async function processIngestion(job) {
  const { documentId, jobId } = job.data;

  // 1. Marca início do processamento (job + documento).
  if (jobId) {
    await db('knowledge_ingestion_jobs').where({ id: jobId }).update({
      status: 'processing',
      started_at: new Date(),
      attempts: job.attemptsMade + 1,
      error: null,
    });
  }
  await db('knowledge_documents').where({ id: documentId }).update({ status: 'indexing' });

  const doc = await db('knowledge_documents').where({ id: documentId }).first();
  if (!doc) throw new Error(`Documento ${documentId} não encontrado`);
  const kb = await db('knowledge_bases').where({ id: doc.knowledge_base_id }).first();
  if (!kb) throw new Error(`Knowledge base ${doc.knowledge_base_id} não encontrada`);

  // 2. Parse → texto bruto.
  const rawText = await parseDocument(doc);

  // 3. Chunk (parâmetros vêm da KB).
  const chunks = chunkText(rawText, {
    chunkSize: kb.chunk_size || 1000,
    overlap: kb.chunk_overlap || 150,
  });

  // 3b. Sem texto extraível → falha determinística (não adianta re-tentar).
  // Marca 'failed' direto e retorna (sem throw) para não gastar os 3 retries.
  // Caso típico: PDF escaneado/só-imagem, ou arquivo realmente vazio.
  if (chunks.length === 0) {
    await db.transaction(async (trx) => {
      await trx('knowledge_documents').where({ id: documentId }).update({
        status: 'failed',
        chunk_count: 0,
        updated_at: trx.fn.now(),
      });
      if (jobId) {
        await trx('knowledge_ingestion_jobs').where({ id: jobId }).update({
          status: 'failed',
          error: 'Nenhum texto extraível (arquivo vazio ou sem camada de texto, ex.: PDF escaneado)',
          finished_at: new Date(),
        });
      }
    });
    return { chunkCount: 0, tokensUsed: 0, empty: true };
  }

  // 4. Embed em batches; acumula vetores + tokens; loga uso por batch.
  const embedder = resolveEmbeddingProvider();
  const embeddings = [];
  let tokensUsed = 0;
  let embeddingModel = kb.embedding_model || null;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const res = await embedder.embed({
      input: batch.map((c) => c.content),
      model: kb.embedding_model || undefined,
    });
    embeddings.push(...res.embeddings);

    const batchTokens = res.usage?.totalTokens ?? res.usage?.promptTokens ?? 0;
    tokensUsed += batchTokens;
    embeddingModel = res.model || embeddingModel;

    // Auditoria de custo/latência (nunca lança — falha de log não quebra o job).
    await logUsage({
      organizationId: kb.organization_id,
      provider: res.provider,
      model: res.model,
      operation: 'embed',
      promptTokens: batchTokens,
      latencyMs: res.latencyMs || 0,
      metadata: { documentId, knowledgeBaseId: kb.id, batchSize: batch.length },
    });
  }

  // 5. Upsert transacional: troca os chunks antigos pelos novos e fecha o job.
  await db.transaction(async (trx) => {
    await trx('knowledge_chunks').where({ document_id: documentId }).del();

    for (let i = 0; i < chunks.length; i++) {
      await trx.raw(
        `INSERT INTO knowledge_chunks
           (document_id, knowledge_base_id, chunk_index, content, token_count, embedding, embedding_model, metadata)
         VALUES (?, ?, ?, ?, ?, ?::vector, ?, ?)`,
        [
          documentId,
          doc.knowledge_base_id,
          i,
          chunks[i].content,
          chunks[i].tokenCount,
          JSON.stringify(embeddings[i]),
          embeddingModel,
          JSON.stringify(chunks[i].metadata || {}),
        ]
      );
    }

    await trx('knowledge_documents').where({ id: documentId }).update({
      status: 'indexed',
      chunk_count: chunks.length,
      tokens_used: tokensUsed,
      indexed_at: new Date(),
      updated_at: trx.fn.now(),
    });

    if (jobId) {
      await trx('knowledge_ingestion_jobs').where({ id: jobId }).update({
        status: 'succeeded',
        chunk_count: chunks.length,
        tokens_used: tokensUsed,
        finished_at: new Date(),
        error: null,
      });
    }
  });

  return { chunkCount: chunks.length, tokensUsed };
}

const worker = new Worker(QUEUE_NAME, processIngestion, { connection, concurrency });

// Só marca 'failed' definitivo quando esgotaram as tentativas; senão o BullMQ
// re-tenta (backoff exponencial configurado no producer) e o documento segue
// 'indexing'. Assim uma falha transiente (provider, rede) não vira dead letter.
worker.on('failed', async (job, err) => {
  if (!job) return;
  const { documentId, jobId } = job.data || {};
  const maxAttempts = job.opts?.attempts || 1;
  const isFinal = job.attemptsMade >= maxAttempts;

  try {
    if (jobId) {
      await db('knowledge_ingestion_jobs').where({ id: jobId }).update({
        status: isFinal ? 'failed' : 'processing',
        error: err.message,
        attempts: job.attemptsMade,
        ...(isFinal ? { finished_at: new Date() } : {}),
      });
    }
    if (isFinal && documentId) {
      await db('knowledge_documents').where({ id: documentId }).update({ status: 'failed' });
    }
  } catch (e) {
    console.error('[ingestion.worker] erro ao registrar falha:', e.message);
  }

  console.error(
    `[ingestion.worker] job ${job.id} falhou (tentativa ${job.attemptsMade}/${maxAttempts}): ${err.message}`
  );
});

worker.on('completed', (job, result) => {
  console.log(`[ingestion.worker] job ${job.id} concluído: ${result?.chunkCount ?? 0} chunks`);
});

module.exports = worker;
