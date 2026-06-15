const { Queue } = require('bullmq');
const connection = { url: process.env.REDIS_URL || 'redis://localhost:6379' };

const ingestionQueue = new Queue('ingestion', { connection });

async function enqueueIngestion(documentId) {
  await ingestionQueue.add('process', { documentId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });
}

module.exports = { ingestionQueue, enqueueIngestion };  