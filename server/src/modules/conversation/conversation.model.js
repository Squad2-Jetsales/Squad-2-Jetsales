// server/src/modules/conversation/conversation.model.js
//
// Acesso direto à tabela `conversations`. Schema definido em
// 20260504_001_initial_schema.js. TODAS as queries filtram por
// organization_id — multi-tenant é regra do projeto.

const db = require('../../database');

const TABLE = 'conversations';

/* Colunas que existem na tabela (defensivo: limita SELECT pra não vazar nada
   inesperado se alguém alterar o schema sem cuidado). */
const COLUMNS = [
  'id',
  'organization_id',
  'contact_id',
  'chatbot_id',
  'whatsapp_connection_id',
  'status',
  'current_flow_path',
  'flow_context',
  'current_node_id',
  'unread_count',
  'last_message_preview',
  'last_message_at',
  'closed_at',
  'created_at',
  'updated_at',
];

/**
 * Lista conversas da organização, com paginação opcional.
 * Filtros aceitos: contact_id, chatbot_id, status.
 */
async function listByOrganization(organizationId, { contactId, chatbotId, status, limit = 50, offset = 0 } = {}) {
  const query = db(TABLE)
    .select(COLUMNS)
    .where({ organization_id: organizationId })
    .orderByRaw('COALESCE(last_message_at, created_at) desc')
    .limit(Math.min(Math.max(Number(limit) || 50, 1), 200))
    .offset(Math.max(Number(offset) || 0, 0));

  if (contactId) query.where({ contact_id: contactId });
  if (chatbotId) query.where({ chatbot_id: chatbotId });
  if (status) query.where({ status });

  return query;
}

async function findById(organizationId, id) {
  return db(TABLE)
    .select(COLUMNS)
    .where({ organization_id: organizationId, id })
    .first();
}

/* -------------------------------------------------------------------------
 * Variantes com contato/mensagens para a tela de Tickets.
 *
 * As funções acima (listByOrganization / findById) seguem retornando a linha
 * crua e NÃO foram alteradas — outros consumidores (ex.: message.service)
 * dependem delas. As funções abaixo fazem JOIN com contacts e devolvem o
 * formato camelCase com contact aninhado que o frontend espera, sem quebrar
 * com lista vazia.
 * ---------------------------------------------------------------------- */

const CONTACT_SELECT = [
  ...COLUMNS.map((col) => `${TABLE}.${col}`),
  'contacts.name as contact_name',
  'contacts.phone as contact_phone',
];

function shapeConversation(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    contactId: row.contact_id,
    chatbotId: row.chatbot_id,
    whatsappConnectionId: row.whatsapp_connection_id,
    status: row.status,
    currentFlowPath: row.current_flow_path,
    unreadCount: row.unread_count ?? 0,
    lastMessagePreview: row.last_message_preview ?? null,
    lastMessageAt: row.last_message_at ?? null,
    closedAt: row.closed_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    contact: {
      id: row.contact_id,
      name: row.contact_name || '',
      phone: row.contact_phone || '',
    },
  };
}

function shapeMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    direction: row.direction,
    content: row.content,
    createdAt: row.created_at,
  };
}

async function listWithContact(organizationId, { contactId, chatbotId, status, limit = 50, offset = 0 } = {}) {
  const query = db(TABLE)
    .select(CONTACT_SELECT)
    .leftJoin('contacts', 'contacts.id', `${TABLE}.contact_id`)
    .where(`${TABLE}.organization_id`, organizationId)
    .orderByRaw(`COALESCE(${TABLE}.last_message_at, ${TABLE}.created_at) desc`)
    .limit(Math.min(Math.max(Number(limit) || 50, 1), 200))
    .offset(Math.max(Number(offset) || 0, 0));

  if (contactId) query.where(`${TABLE}.contact_id`, contactId);
  if (chatbotId) query.where(`${TABLE}.chatbot_id`, chatbotId);
  if (status) query.where(`${TABLE}.status`, status);

  const rows = await query;
  return rows.map(shapeConversation);
}

async function findByIdWithDetail(organizationId, id) {
  const row = await db(TABLE)
    .select(CONTACT_SELECT)
    .leftJoin('contacts', 'contacts.id', `${TABLE}.contact_id`)
    .where(`${TABLE}.organization_id`, organizationId)
    .where(`${TABLE}.id`, id)
    .first();

  if (!row) return null;

  const conversation = shapeConversation(row);
  const messages = await db('messages')
    .select('id', 'conversation_id', 'direction', 'content', 'created_at')
    .where('conversation_id', id)
    .orderBy('created_at', 'asc')
    .limit(500);
  conversation.messages = messages.map(shapeMessage);
  return conversation;
}

module.exports = { listByOrganization, findById, listWithContact, findByIdWithDetail };
