// server/src/modules/flow/flow.mapper.js
//
// Mapeia linhas snake_case do Postgres para o contrato camelCase consumido
// pelo front em client/src/types/domain.ts. Toda resposta dos endpoints DB
// passa por aqui — NUNCA devolva linha crua.

function toIso(value) {
  if (!value) return value;
  return value instanceof Date ? value.toISOString() : value;
}

function mapFlow(row) {
  if (!row) return null;
  return {
    id: row.id,
    chatbotId: row.chatbot_id,
    name: row.name,
    status: row.status,
    version: row.version,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapNode(row) {
  if (!row) return null;
  return {
    id: row.id,
    flowId: row.flow_id,
    type: row.type,
    data: row.data ?? {},
    positionX: Number(row.position_x),
    positionY: Number(row.position_y),
  };
}

function mapEdge(row) {
  if (!row) return null;
  return {
    id: row.id,
    flowId: row.flow_id,
    sourceNodeId: row.source_node_id,
    targetNodeId: row.target_node_id,
    sourceHandle: row.source_handle ?? null,
    conditionType: row.condition_type ?? undefined,
    conditionValue: row.condition_value ?? undefined,
  };
}

module.exports = { mapFlow, mapNode, mapEdge };
