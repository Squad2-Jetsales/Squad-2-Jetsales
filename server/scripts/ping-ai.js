#!/usr/bin/env node
// server/scripts/ping-ai.js
//
// Smoke test standalone dos providers de IA.
// Roda fora do servidor HTTP — útil pra validar credenciais e latência
// antes de subir o app, ou em CI.
//
// Uso: node scripts/ping-ai.js

require('dotenv').config();

const {
  resolveChatProvider,
  resolveEmbeddingProvider,
} = require('../src/modules/ai/providers');

function fmt(ms) {
  return `${ms.toString().padStart(5, ' ')}ms`;
}

(async () => {
  const results = [];

  // Chat
  console.log('▶ Testando chat provider...');
  try {
    const chat = resolveChatProvider();
    const ping = await chat.ping();
    results.push({ kind: 'chat', provider: chat.name, ...ping });
  } catch (err) {
    results.push({ kind: 'chat', ok: false, error: err.message });
  }

  // Embedding
  console.log('▶ Testando embedding provider...');
  try {
    const embed = resolveEmbeddingProvider();
    const ping = await embed.ping();
    results.push({ kind: 'embedding', provider: embed.name, ...ping });
  } catch (err) {
    results.push({ kind: 'embedding', ok: false, error: err.message });
  }

  console.log('\n─── Resultado ───');
  for (const r of results) {
    const tag = r.ok ? '✓' : '✗';
    const where = `${r.kind.padEnd(10)} (${r.provider || '?'})`;
    if (r.ok) {
      console.log(`${tag} ${where} ${fmt(r.latencyMs)} model=${r.model || '?'}`);
    } else {
      console.log(`${tag} ${where} error=${r.error}`);
    }
  }

  const allOk = results.every((r) => r.ok);
  process.exit(allOk ? 0 : 1);
})();
