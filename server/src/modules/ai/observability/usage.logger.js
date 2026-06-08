// server/src/modules/ai/observability/usage.logger.js
//
// Persiste uma linha em `ai_usage_logs` por chamada ao provider.
// É chamado pelo agent.engine / rag.service / ingestion.worker.
// Nunca lança — falha de log NÃO deve quebrar a resposta ao usuário.

const db = require('../../../database');
const { calcCostUsd } = require('../providers/pricing');

/**
 * @param {Object} args
 * @param {string} args.organizationId
 * @param {string} [args.chatbotId]
 * @param {string} [args.conversationId]
 * @param {'openai' | 'anthropic'} args.provider
 * @param {string} args.model
 * @param {'embed' | 'chat' | 'rerank'} args.operation
 * @param {number} args.promptTokens
 * @param {number} [args.completionTokens]
 * @param {number} [args.latencyMs]
 * @param {Record<string, unknown>} [args.metadata]
 * @returns {Promise<{ id: string, costUsd: number } | null>}
 */
async function logUsage({
  organizationId,
  chatbotId = null,
  conversationId = null,
  provider,
  model,
  operation,
  promptTokens = 0,
  completionTokens = 0,
  latencyMs = 0,
  metadata = {},
}) {
  if (!organizationId) {
    console.warn('[usage.logger] organizationId ausente — skip');
    return null;
  }

  const costUsd = calcCostUsd({ provider, operation, promptTokens, completionTokens });
  const totalTokens = (promptTokens || 0) + (completionTokens || 0);

  try {
    const [row] = await db('ai_usage_logs')
      .insert({
        organization_id: organizationId,
        chatbot_id: chatbotId,
        conversation_id: conversationId,
        provider,
        model,
        operation,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        cost_usd: costUsd,
        latency_ms: latencyMs,
        metadata,
      })
      .returning(['id']);

    return { id: row.id, costUsd };
  } catch (err) {
    console.error('[usage.logger] falha ao persistir uso:', err.message);
    return null;
  }
}

module.exports = { logUsage };
