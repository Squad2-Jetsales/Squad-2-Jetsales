const { resolveChatProvider, resolveEmbeddingProvider } = require('./providers');
const { logUsage } = require('./observability/usage.logger');
const db = require('../../database');

async function health() {
  const result = { chat: null, embedding: null, usageLogs: null };

  // Chat
  try {
    const chat = resolveChatProvider();
    const ping = await chat.ping();
    result.chat = {
      provider: chat.name,
      configuredModel: process.env.AI_CHAT_MODEL || null,
      ...ping,
    };
  } catch (err) {
    result.chat = {
      provider: process.env.AI_CHAT_PROVIDER || 'anthropic',
      ok: false, latencyMs: 0, error: err.message,
    };
  }

  // Embedding
  try {
    const embed = resolveEmbeddingProvider();
    const ping = await embed.ping();
    result.embedding = {
      provider: embed.name,
      configuredModel: process.env.AI_EMBEDDING_MODEL || null,
      dim: Number(process.env.AI_EMBEDDING_DIM || 1536),
      ...ping,
    };
  } catch (err) {
    result.embedding = {
      provider: process.env.AI_EMBEDDING_PROVIDER || 'openai',
      ok: false, latencyMs: 0, error: err.message,
    };
  }

  // Verifica acesso à tabela ai_usage_logs (prova que a migration rodou)
  try {
    const { count } = await db('ai_usage_logs').count('id as count').first();
    result.usageLogs = { ok: true, totalRows: Number(count) };
  } catch (err) {
    result.usageLogs = { ok: false, error: err.message };
  }

  return result;
}

module.exports = { health };