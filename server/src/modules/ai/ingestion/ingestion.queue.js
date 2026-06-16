// server/src/modules/ai/ingestion/ingestion.queue.js
//
// Producer da fila de ingestão (BullMQ). É chamado pelo knowledge.service ao
// criar/reindexar um documento. O consumer é ingestion.worker.js (processo
// separado, `npm run worker`).

const { Queue } = require('bullmq');

const QUEUE_NAME = 'ingestion';
const connection = { url: process.env.REDIS_URL || 'redis://localhost:6379' };

const ingestionQueue = new Queue(QUEUE_NAME, { connection });

/**
 * Enfileira o processamento de um documento.
 * @param {{ documentId: string, jobId: string }} payload
 *   documentId → linha em knowledge_documents
 *   jobId      → linha em knowledge_ingestion_jobs (rastreio do ciclo de vida)
 */
async function enqueueIngestion({ documentId, jobId }) {
  await ingestionQueue.add(
    'process',
    { documentId, jobId },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    }
  );
}

module.exports = { ingestionQueue, enqueueIngestion, QUEUE_NAME };
