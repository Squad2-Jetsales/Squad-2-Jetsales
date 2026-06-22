#!/usr/bin/env node
// server/scripts/rag-smoke.js
//
// Smoke test standalone do RAG retrieval (F3.3). Roda fora do servidor HTTP —
// útil pra validar o retrieval + isolamento cross-tenant sem subir o app.
//
// Uso:
//   npm run rag:smoke -- --kb <KB_ID> --query "qual o horário de atendimento?"
// ou via env: RAG_SMOKE_KB_ID, RAG_SMOKE_QUERY
//
// Pré-requisito: a KB precisa ter ao menos um documento indexado (status
// 'indexed') — rode o worker e suba um documento antes (fluxo F3.2).

require('dotenv').config();

const db = require('../src/database');
const rag = require('../src/modules/ai/rag/rag.service');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

(async () => {
  const kbId = arg('kb') || process.env.RAG_SMOKE_KB_ID;
  const query = arg('query') || process.env.RAG_SMOKE_QUERY || 'qual o horário de atendimento?';

  if (!kbId) {
    console.error('Uso: npm run rag:smoke -- --kb <KB_ID> --query "..."');
    process.exit(2);
  }

  try {
    const kb = await db('knowledge_bases').where({ id: kbId }).first();
    if (!kb) {
      console.error(`✗ KB ${kbId} não encontrada no banco.`);
      process.exit(1);
    }

    const orgId = kb.organization_id;
    console.log(`▶ KB: ${kb.name} (${kbId})  org=${orgId}`);
    console.log(`▶ Query: "${query}"\n`);

    const started = Date.now();
    const result = await rag.retrieve(orgId, kbId, query, {});
    const latencyMs = Date.now() - started;

    console.log(
      `─── Citações: ${result.citations.length} de ${result.retrievedCount} candidatos ` +
        `— ${latencyMs}ms — model=${result.model} ───`
    );
    for (const c of result.citations) {
      const snippet = (c.snippet || '').slice(0, 80).replace(/\s+/g, ' ');
      console.log(`  [${c.score}] ${c.title || '(sem título)'} — ${snippet}…`);
    }
    if (result.citations.length === 0) {
      console.log('  (nenhum chunk acima do minSimilarity — a KB tem documentos indexados?)');
    }

    // Prova de isolamento cross-tenant: uma org que não é dona da KB não deve
    // sequer alcançar o retrieval (assertKbOwned barra com KB_NOT_FOUND).
    console.log('\n─── Cross-tenant ───');
    const fakeOrg = '00000000-0000-0000-0000-000000000000';
    try {
      await rag.retrieve(fakeOrg, kbId, query, {});
      console.log('  ✗ FALHA: retrieve com org diferente NÃO foi bloqueado (vazamento cross-tenant!)');
      process.exitCode = 1;
    } catch (err) {
      if (err.code === 'KB_NOT_FOUND' || err.status === 404) {
        console.log('  ✓ org diferente bloqueada (KB_NOT_FOUND) — isolamento OK');
      } else {
        console.log(`  ? erro inesperado no teste cross-tenant: ${err.message}`);
        process.exitCode = 1;
      }
    }
  } catch (err) {
    console.error('✗ erro no smoke:', err.message);
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
})();
