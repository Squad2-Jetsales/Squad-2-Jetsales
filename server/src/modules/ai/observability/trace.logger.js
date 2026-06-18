// server/src/modules/ai/observability/trace.logger.js
//
// Persiste uma linha em `ai_agent_traces` por turno do agente (F3.4): chunks
// recuperados, tools chamadas, decisão final, confiança e nº de iterações.
// Espelha a filosofia do usage.logger: NUNCA lança — falha de auditoria não
// pode derrubar a resposta ao usuário. Em erro, retorna { id: null }.
//
// Schema em 20260601_003_ai_audit_tables.js. organization_id, conversation_id e
// chatbot_id são NOT NULL; decision usa o enum ai_agent_decision
// ('answered' | 'fallback_flow' | 'transferred_human' | 'errored').

const db = require('../../../database');

const VALID_DECISIONS = ['answered', 'fallback_flow', 'transferred_human', 'errored'];

// Mantém o trace enxuto: guarda só o necessário para auditar o retrieval, sem
// vazar o vetor `embedding` nem repetir o conteúdo cru do chunk.
function compactChunks(citations = []) {
  return (Array.isArray(citations) ? citations : []).map((c) => ({
    chunkId: c.chunkId ?? c.chunk_id ?? null,
    score: c.score ?? null,
    snippet: typeof c.snippet === 'string' ? c.snippet.slice(0, 240) : null,
  }));
}

function clampConfidence(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return Math.min(Math.max(Number(value), 0), 1);
}

/**
 * @param {Object} args
 * @param {string} args.organizationId
 * @param {string} args.conversationId
 * @param {string} args.chatbotId
 * @param {string} [args.messageId]
 * @param {Array} [args.retrievedChunks]  citações no formato do citation.builder
 * @param {Record<string, unknown>} [args.promptSummary]  {systemHash, historyCount, ...}
 * @param {Array<{name:string,args:object,result?:unknown}>} [args.toolsCalled]
 * @param {'answered'|'fallback_flow'|'transferred_human'|'errored'} args.decision
 * @param {number} [args.confidence]
 * @param {number} [args.iterations]
 * @param {string} [args.error]
 * @returns {Promise<{ id: string|null }>}
 */
async function save({
  organizationId,
  conversationId,
  chatbotId,
  messageId = null,
  retrievedChunks = [],
  promptSummary = {},
  toolsCalled = [],
  decision,
  confidence = null,
  iterations = 1,
  error = null,
}) {
  if (!organizationId || !conversationId || !chatbotId) {
    console.warn('[trace.logger] organizationId/conversationId/chatbotId ausente — skip');
    return { id: null };
  }

  const safeDecision = VALID_DECISIONS.includes(decision) ? decision : 'errored';

  try {
    const [row] = await db('ai_agent_traces')
      .insert({
        organization_id: organizationId,
        conversation_id: conversationId,
        chatbot_id: chatbotId,
        message_id: messageId,
        retrieved_chunks: JSON.stringify(compactChunks(retrievedChunks)),
        prompt_summary: JSON.stringify(promptSummary || {}),
        tools_called: JSON.stringify(Array.isArray(toolsCalled) ? toolsCalled : []),
        decision: safeDecision,
        confidence: clampConfidence(confidence),
        iterations: Number.isFinite(Number(iterations)) ? Math.max(1, Math.floor(iterations)) : 1,
        error: error ? String(error).slice(0, 2000) : null,
      })
      .returning(['id']);

    return { id: row.id };
  } catch (err) {
    console.error('[trace.logger] falha ao persistir trace:', err.message);
    return { id: null };
  }
}

module.exports = { save, VALID_DECISIONS };
