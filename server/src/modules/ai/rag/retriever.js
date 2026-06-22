// server/src/modules/ai/rag/retriever.js
//
// Camada de retrieval vetorial sobre pgvector. Duas responsabilidades:
//   1. retrieve()   — top-K por similaridade de cosseno, filtrado por KB (tenant).
//   2. mmrRerank()  — diversifica o top-K via MMR (Maximal Marginal Relevance)
//                     usando os EMBEDDINGS REAIS dos candidatos (não heurística).
//
// O filtro por `knowledge_base_id` é o ponto de tenancy no SQL; a posse da KB
// pela org é garantida antes, no rag.service (assertKbOwned).

const db = require('../../../database');

/**
 * Top-K chunks de uma KB por similaridade de cosseno com o embedding da query.
 * Traz a coluna `embedding` porque o MMR precisa dos vetores reais em memória.
 *
 * @param {string} kbId
 * @param {number[]} queryEmbedding
 * @param {{ topK?: number, minSimilarity?: number }} [opts]
 * @returns {Promise<Array>} linhas cruas (snake_case) incluindo `embedding` e `score`
 */
async function retrieve(kbId, queryEmbedding, { topK = 20, minSimilarity = 0.25 } = {}) {
  // pgvector: operador <=> = distância de cosseno (0 = idêntico). score = 1 - dist.
  const vec = JSON.stringify(queryEmbedding);
  const rows = await db.raw(
    `
    SELECT
      c.id, c.document_id, c.chunk_index, c.content, c.metadata, c.embedding,
      d.title AS document_title,
      1 - (c.embedding <=> ?::vector) AS score
    FROM knowledge_chunks c
    JOIN knowledge_documents d ON d.id = c.document_id
    WHERE c.knowledge_base_id = ?
      AND 1 - (c.embedding <=> ?::vector) >= ?
    ORDER BY c.embedding <=> ?::vector
    LIMIT ?
  `,
    [vec, kbId, vec, minSimilarity, vec, topK]
  );

  return rows.rows;
}

/* ----------------------------- Álgebra vetorial ---------------------------- */

// pgvector serializa o vetor como texto "[0.1,0.2,...]". Converte para number[].
function parseVector(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || value.length === 0) return null;
  const inner = value.replace(/^\[/, '').replace(/\]$/, '');
  if (!inner) return null;
  const out = inner.split(',').map(Number);
  return out.some(Number.isNaN) ? null : out;
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * MMR: equilibra relevância (similaridade com a query, já no `score` do pgvector)
 * e diversidade (penaliza candidatos parecidos com os já escolhidos). Usa os
 * embeddings reais dos candidatos — se algum vier sem embedding parseável, a
 * similaridade contra ele é tratada como 0 (degrada para relevância pura).
 *
 * @param {Array} chunks  linhas de retrieve() (precisam ter `embedding` e `score`)
 * @param {{ topK?: number, lambda?: number }} [opts]
 * @returns {Array} subconjunto reordenado (sem mutar a entrada)
 */
function mmrRerank(chunks, { topK = 6, lambda = 0.5 } = {}) {
  if (!Array.isArray(chunks) || chunks.length <= topK) return chunks || [];

  const vectors = chunks.map((c) => parseVector(c.embedding));

  const selected = [];
  const selectedIdx = [];
  const remaining = chunks.map((_, i) => i);

  while (selected.length < topK && remaining.length > 0) {
    let bestPos = 0;
    let bestScore = -Infinity;

    for (let p = 0; p < remaining.length; p++) {
      const i = remaining[p];
      const relevance = Number(chunks[i].score) || 0;

      let maxSim = 0;
      for (const j of selectedIdx) {
        const sim = cosineSimilarity(vectors[i], vectors[j]);
        if (sim > maxSim) maxSim = sim;
      }

      const mmr = lambda * relevance - (1 - lambda) * maxSim;
      if (mmr > bestScore) {
        bestScore = mmr;
        bestPos = p;
      }
    }

    const chosen = remaining.splice(bestPos, 1)[0];
    selectedIdx.push(chosen);
    selected.push(chunks[chosen]);
  }

  return selected;
}

module.exports = { retrieve, mmrRerank, cosineSimilarity, parseVector };
