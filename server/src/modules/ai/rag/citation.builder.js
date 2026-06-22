// server/src/modules/ai/rag/citation.builder.js
//
// Monta as citações expostas pelo RAG a partir das linhas cruas de
// knowledge_chunks (snake_case do DB) → formato camelCase do contrato
// (roadmap §7, AgentPreviewResponse.citations). Mantido separado do retriever
// para que a forma da citação seja a fonte única de verdade do que sai do RAG:
// o `embedding` (vetor grande, uso interno do MMR) NUNCA aparece aqui.

const SNIPPET_MAX_CHARS = 300;

function buildSnippet(content, maxChars = SNIPPET_MAX_CHARS) {
  if (!content) return '';
  const text = String(content).trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()}…`;
}

function buildCitation(row) {
  const score = Number(row.score);
  return {
    chunkId: row.id,
    documentId: row.document_id,
    title: row.document_title ?? null,
    snippet: buildSnippet(row.content),
    score: Number.isFinite(score) ? Number(score.toFixed(4)) : null,
  };
}

function buildCitations(rows) {
  return (rows || []).map(buildCitation);
}

module.exports = { buildCitation, buildCitations, buildSnippet, SNIPPET_MAX_CHARS };
