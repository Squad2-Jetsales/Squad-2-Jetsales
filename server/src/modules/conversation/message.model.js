// server/src/modules/conversation/message.model.js
//
// Acesso direto à tabela `messages`. Schema definido em
// 20260504_001_initial_schema.js — colunas reais:
//   id, conversation_id, flow_node_id, direction ('in'|'out'),
//   content, metadata, created_at.
//
// Multi-tenancy é garantida pelo join em conversations (queries do
// service nunca recebem conversation_id sem antes confirmar a posse via
// guard).

const db = require('../../database');

const TABLE = 'messages';

const COLUMNS = [
  'id',
  'conversation_id',
  'flow_node_id',
  'direction',
  'content',
  'metadata',
  'created_at',
];

async function listByConversation(conversationId, { limit = 100, offset = 0 } = {}) {
  return db(TABLE)
    .select(COLUMNS)
    .where({ conversation_id: conversationId })
    .orderBy('created_at', 'asc')
    .limit(Math.min(Math.max(Number(limit) || 100, 1), 500))
    .offset(Math.max(Number(offset) || 0, 0));
}

async function create({ conversationId, flowNodeId = null, direction, content, metadata }) {
  const [row] = await db(TABLE)
    .insert({
      conversation_id: conversationId,
      flow_node_id: flowNodeId,
      direction,
      content,
      metadata: metadata ?? {},
    })
    .returning(COLUMNS);
  return row;
}

module.exports = { listByConversation, create };
