// server/src/modules/ai/rag/rag.service.js
//
// Facade do RAG: a ÚNICA API de retrieval exposta ao resto do sistema (endpoint
// de busca hoje; agent.engine na F3.4). Orquestra: tenancy → embed da query →
// retrieval vetorial (top-K) → MMR (top-K-return) → citações.
//
// Tenancy: assertKbOwned garante que a KB pertence à org do request (defesa em
// profundidade — o SQL do retriever ainda filtra por knowledge_base_id).
// Custo: toda chamada de embed é auditada em ai_usage_logs (usage.logger).

const { resolveEmbeddingProvider } = require('../providers');
const { assertKbOwned } = require('../knowledge/knowledge.guards');
const { logUsage } = require('../observability/usage.logger');
const { retrieve: retrieveChunks, mmrRerank } = require('./retriever');
const { buildCitations } = require('./citation.builder');

// Defaults configuráveis por env (já presentes no .env.example).
const DEFAULT_TOP_K_RETRIEVE = Number(process.env.RAG_TOP_K_RETRIEVE) || 20;
const DEFAULT_TOP_K_RETURN = Number(process.env.RAG_TOP_K_RETURN) || 6;
const DEFAULT_MIN_SIMILARITY = Number(process.env.RAG_MIN_SIMILARITY);

function clampInt(value, fallback, min, max) {
  const n = Number.isFinite(Number(value)) ? Math.floor(Number(value)) : fallback;
  return Math.min(Math.max(n, min), max);
}

function clampNum(value, fallback, min, max) {
  const n = Number.isFinite(Number(value)) ? Number(value) : fallback;
  return Math.min(Math.max(n, min), max);
}

/**
 * Recupera os chunks mais relevantes de uma KB para uma query em linguagem
 * natural. Única API pública do RAG.
 *
 * @param {string} organizationId  org do request (tenancy)
 * @param {string} knowledgeBaseId
 * @param {string} query           texto da pergunta
 * @param {{ topK?: number, topKReturn?: number, minSimilarity?: number }} [opts]
 * @returns {Promise<{ citations: Array, retrievedCount: number, model: string|null }>}
 */
async function retrieve(organizationId, knowledgeBaseId, query, opts = {}) {
  const kb = await assertKbOwned(organizationId, knowledgeBaseId);

  const text = typeof query === 'string' ? query.trim() : '';
  if (!text) {
    return { citations: [], retrievedCount: 0, model: null };
  }

  const minSimDefault = Number.isFinite(DEFAULT_MIN_SIMILARITY) ? DEFAULT_MIN_SIMILARITY : 0.25;
  const topKRetrieve = clampInt(opts.topK, DEFAULT_TOP_K_RETRIEVE, 1, 100);
  const topKReturn = clampInt(opts.topKReturn, DEFAULT_TOP_K_RETURN, 1, topKRetrieve);
  const minSimilarity = clampNum(opts.minSimilarity, minSimDefault, 0, 1);

  // 1. Embed da query. Usa o mesmo modelo da KB para manter o espaço vetorial
  //    coerente com os chunks indexados (provider via factory — nunca direto).
  const embedder = resolveEmbeddingProvider();
  const res = await embedder.embed({
    input: [text],
    model: kb.embedding_model || undefined,
  });
  const queryEmbedding = res.embeddings[0];

  // Auditoria de custo/latência (logUsage nunca lança).
  await logUsage({
    organizationId,
    provider: res.provider,
    model: res.model,
    operation: 'embed',
    promptTokens: res.usage?.totalTokens ?? res.usage?.promptTokens ?? 0,
    latencyMs: res.latencyMs || 0,
    metadata: { knowledgeBaseId, kind: 'rag_query' },
  });

  // 2. Retrieval vetorial (top-K) → 3. MMR (diversifica para top-K-return).
  const candidates = await retrieveChunks(knowledgeBaseId, queryEmbedding, {
    topK: topKRetrieve,
    minSimilarity,
  });
  const reranked = mmrRerank(candidates, { topK: topKReturn });

  // 4. Citações: forma única de saída do RAG (sem expor o vetor `embedding`).
  return {
    citations: buildCitations(reranked),
    retrievedCount: candidates.length,
    model: res.model || kb.embedding_model || null,
  };
}

module.exports = { retrieve };
