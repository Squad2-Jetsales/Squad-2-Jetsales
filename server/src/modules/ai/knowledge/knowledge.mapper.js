// server/src/modules/ai/knowledge/knowledge.mapper.js
//
// snake_case (DB) → camelCase (resposta JSON). Base bate com
// client/src/types/domain.ts (KnowledgeBase, KnowledgeDocument); os campos
// extras (status, chunkCount, tokensUsed, ...) são aditivos.

function toIso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function toKnowledgeBase(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    chatbotId: row.chatbot_id,
    name: row.name,
    embeddingModel: row.embedding_model,
    chunkSize: row.chunk_size,
    chunkOverlap: row.chunk_overlap,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toKnowledgeDocument(row) {
  if (!row) return null;
  return {
    id: row.id,
    knowledgeBaseId: row.knowledge_base_id,
    title: row.title,
    content: row.content ?? undefined,
    sourceUrl: row.source_url ?? undefined,
    status: row.status,
    mimeType: row.mime_type ?? undefined,
    fileSizeBytes: row.file_size_bytes != null ? Number(row.file_size_bytes) : undefined,
    chunkCount: row.chunk_count ?? 0,
    tokensUsed: row.tokens_used ?? 0,
    checksum: row.checksum ?? undefined,
    metadata: row.metadata ?? undefined,
    indexedAt: toIso(row.indexed_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toIngestionJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    documentId: row.document_id,
    status: row.status,
    error: row.error ?? undefined,
    tokensUsed: row.tokens_used ?? 0,
    chunkCount: row.chunk_count ?? 0,
    attempts: row.attempts ?? 0,
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
    createdAt: toIso(row.created_at),
  };
}

module.exports = { toKnowledgeBase, toKnowledgeDocument, toIngestionJob };
