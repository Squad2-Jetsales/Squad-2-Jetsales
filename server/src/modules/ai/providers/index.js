// server/src/modules/ai/providers/index.js
//
// Factory dos adapters. O resto do código (rag, agent, etc.) NUNCA importa
// um adapter direto — sempre passa por aqui. Isso garante que trocar provider
// é só env var.

const anthropic = require('./anthropic.adapter');
const openai = require('./openai.adapter');

const ADAPTERS = {
  anthropic,
  openai,
};

function resolveChatProvider() {
  const name = (process.env.AI_CHAT_PROVIDER || 'anthropic').toLowerCase();
  const adapter = ADAPTERS[name];
  if (!adapter) {
    throw new Error(
      `AI_CHAT_PROVIDER inválido: '${name}'. Use um de: ${Object.keys(ADAPTERS).join(', ')}`
    );
  }
  return adapter;
}

function resolveEmbeddingProvider() {
  const name = (process.env.AI_EMBEDDING_PROVIDER || 'openai').toLowerCase();
  const adapter = ADAPTERS[name];
  if (!adapter) {
    throw new Error(
      `AI_EMBEDDING_PROVIDER inválido: '${name}'. Use um de: ${Object.keys(ADAPTERS).join(', ')}`
    );
  }
  if (typeof adapter.embed !== 'function') {
    throw new Error(`Provider '${name}' não suporta embeddings`);
  }
  return adapter;
}

function getProviderByName(name) {
  const adapter = ADAPTERS[(name || '').toLowerCase()];
  if (!adapter) throw new Error(`Provider desconhecido: ${name}`);
  return adapter;
}

module.exports = {
  ADAPTERS,
  resolveChatProvider,
  resolveEmbeddingProvider,
  getProviderByName,
};
