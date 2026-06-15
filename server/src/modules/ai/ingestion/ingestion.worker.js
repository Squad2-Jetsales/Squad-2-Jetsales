const { Worker } = require('bullmq');
const db = require('../../../database');
const { resolveEmbeddingProvider } = require('../providers');
const { parseDocument } = require('./parsers');
const { chunkText } = require('./chunker');
const crypto = require('crypto');

const BATCH_SIZE = 50; // chunks por chamada de embed

const worker = new Worker('ingestion', async (job) => {
  const { documentId } = job.data;

  // 1. Atualiza status para 'indexing'
  await db('knowledge_ingestion_jobs').where({ document_id: documentId })
    .update({ status: 'processing', started_at: new Date(), attempts: db.raw('attempts + 1') });

  await db('knowledge_documents').where({ id: documentId })
    .update({ status: 'indexing' });

  const doc = await db('knowledge_documents').where({ id: documentId }).first();
  const kb = await db('knowledge_bases').where({ id: doc.knowledge_base_id }).first();

  // 2. Parse → texto bruto
  const rawText = await parseDocument(doc);

  // 3. Chunk
  const chunks = chunkText(rawText, {
    chunkSize: kb.chunk_size || 1000,
    overlap: kb.chunk_overlap || 150,
  });

  // 4. Embed em batches de 50
  const embedder = resolveEmbeddingProvider();
  let allEmbeddings = [];
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const res = await embedder.embed({ input: batch.map(c => c.content) });
    allEmbeddings = allEmbeddings.concat(res.embeddings);
  }

  // 5. Upsert em knowledge_chunks
  await db('knowledge_chunks').where({ document_id: documentId }).delete();

  for (let i = 0; i < chunks.length; i++) {
    await db.raw(`
      INSERT INTO knowledge_chunks
        (document_id, knowledge_base_id, chunk_index, content, token_count, embedding, metadata)
      VALUES (?, ?, ?, ?, ?, ?::vector, ?)
    `, [
      documentId, doc.knowledge_base_id, i,
      chunks[i].content, chunks[i].tokenCount,
      JSON.stringify(allEmbeddings[i]),
      JSON.stringify({ page: chunks[i].page }),
    ]);
  }

  // 6. Atualiza status final
  await db('knowledge_documents').where({ id: documentId })
    .update({ status: 'indexed', chunk_count: chunks.length, indexed_at: new Date() });

  await db('knowledge_ingestion_jobs').where({ document_id: documentId })
    .update({ status: 'succeeded', chunk_count: chunks.length, finished_at: new Date() });

}, { connection: { url: process.env.REDIS_URL } });

worker.on('failed', async (job, err) => {
  await db('knowledge_documents').where({ id: job.data.documentId })
    .update({ status: 'failed' });
  await db('knowledge_ingestion_jobs').where({ document_id: job.data.documentId })
    .update({ status: 'failed', error: err.message, finished_at: new Date() });
});

module.exports = worker;