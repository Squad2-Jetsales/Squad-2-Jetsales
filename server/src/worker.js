// server/src/worker.js
//
// Entrypoint do worker de ingestão (F3.2). Processo separado da API:
//   npm run worker
// Sobe o consumer da fila BullMQ (ingestion.worker.js se auto-registra ao ser
// importado) e trata shutdown gracioso.

require('dotenv').config();

const worker = require('./modules/ai/ingestion/ingestion.worker');

console.log('🛠️  JetGO ingestion worker iniciado');
console.log(`   Fila: ingestion | Redis: ${process.env.REDIS_URL || 'redis://localhost:6379'}`);
console.log(`   Concorrência: ${process.env.INGESTION_CONCURRENCY || 4}`);

async function shutdown(signal) {
  console.log(`\n[worker] ${signal} recebido, encerrando...`);
  try {
    await worker.close();
  } catch (err) {
    console.error('[worker] erro ao fechar:', err.message);
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
