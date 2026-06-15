const db = require('../../../database');

async function retrieve(kbId, queryEmbedding, { topK = 20, minSimilarity = 0.25 } = {}) {
  // pgvector: operador <=> = distância de cosseno (1 - similaridade)
  const rows = await db.raw(`
    SELECT
      c.id, c.document_id, c.chunk_index, c.content, c.metadata,
      d.title AS document_title,
      1 - (c.embedding <=> ?::vector) AS score
    FROM knowledge_chunks c
    JOIN knowledge_documents d ON d.id = c.document_id
    WHERE c.knowledge_base_id = ?
      AND 1 - (c.embedding <=> ?::vector) >= ?
    ORDER BY c.embedding <=> ?::vector
    LIMIT ?
  `, [
    JSON.stringify(queryEmbedding), kbId,
    JSON.stringify(queryEmbedding), minSimilarity,
    JSON.stringify(queryEmbedding), topK,
  ]);

  return rows.rows;
}

// MMR: maximiza relevância e diversidade ao mesmo tempo
function mmrRerank(chunks, { topK = 6, lambda = 0.5 } = {}) {
  if (chunks.length <= topK) return chunks;

  const selected = [];
  const candidates = [...chunks];

  while (selected.length < topK && candidates.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < candidates.length; i++) {
      const relevance = candidates[i].score;
      const maxSim = selected.length === 0 ? 0
        : Math.max(...selected.map(s => cosineSimilarity(candidates[i], s)));
      const mmrScore = lambda * relevance - (1 - lambda) * maxSim;

      if (mmrScore > bestScore) { bestScore = mmrScore; bestIdx = i; }
    }

    selected.push(candidates[bestIdx]);
    candidates.splice(bestIdx, 1);
  }

  return selected;
}

// Similaridade aproximada via score (os embeddings reais não estão em memória)
function cosineSimilarity(a, b) {
  // heurística: chunks com conteúdo parecido têm scores parecidos
  return 1 - Math.abs(a.score - b.score);
}

module.exports = { retrieve, mmrRerank };