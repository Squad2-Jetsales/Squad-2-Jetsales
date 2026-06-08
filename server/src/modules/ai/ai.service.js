// server/src/modules/ai/ai.service.js
//
// Camada de orquestração de IA.
// F3.1: só healthcheck. Próximas fases adicionam: ingest, retrieve, agent.

const { resolveChatProvider, resolveEmbeddingProvider } = require('./providers');

/**
 * Healthcheck dos providers de IA.
 * - Tenta resolver o adapter (valida env vars).
 * - Faz ping (chamada barata) em paralelo.
 * - Retorna shape: { chat: {...}, embedding: {...} }
 */
async function health() {
  const result = { chat: null, embedding: null };

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
      ok: false,
      latencyMs: 0,
      error: err.message,
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
      ok: false,
      latencyMs: 0,
      error: err.message,
    };
  }

  return result;
}

module.exports = { health };
