const { Queue } = require('bullmq');

const QUEUE_NAME = 'ingestion';
const REDIS_URL = (process.env.REDIS_URL || '').trim();

let ingestionQueue = null;

function getQueue() {
  if (!REDIS_URL) return null;
  if (!ingestionQueue) {
    ingestionQueue = new Queue(QUEUE_NAME, { connection: { url: REDIS_URL } });
  }
  return ingestionQueue;
}

/**
 * Enfileira o processamento de um documento.
 * @param {{ documentId: string, jobId: string }} payload
 */
async function enqueueIngestion({ documentId, jobId }) {
  const queue = getQueue();
  if (!queue) {
    throw new Error('REDIS_URL nao configurado');
  }

  await queue.add(
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

module.exports = { getQueue, enqueueIngestion, QUEUE_NAME };
