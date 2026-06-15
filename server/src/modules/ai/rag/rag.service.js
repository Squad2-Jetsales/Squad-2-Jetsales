const { resolveEmbeddingProvider } = require('../providers');
const { retrieve, mmrRerank } = require('./retriever');

async function retrieve_rag(kbId, query, opts = {}) {
  const embedder = resolveEmbeddingProvider();
  const { embeddings } = await embedder.embed({ input: [query] });
  const queryEmbedding = embeddings[0];

  const candidates = await retrieve(kbId, queryEmbedding, {
    topK: opts.topK || 20,
    minSimilarity: opts.minSimilarity || 0.25,
  });

  const results = mmrRerank(candidates, { topK: opts.topKReturn || 6 });

  return results.map(r => ({
    chunkId: r.id,
    documentId: r.document_id,
    title: r.document_title,
    snippet: r.content.slice(0, 300),
    score: parseFloat(r.score.toFixed(4)),
  }));
}

module.exports = { retrieve: retrieve_rag };