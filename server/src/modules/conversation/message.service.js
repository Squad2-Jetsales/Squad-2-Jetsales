// server/src/modules/conversation/message.service.js
//
// Regras de negócio para mensagens. Antes de qualquer operação, valida que a
// conversa existe E pertence à organização do caller — garantia de tenant
// isolation mesmo se o controller esquecer.

const db = require('../../database');
const { httpError } = require('../../middlewares/error.middleware');
const Message = require('./message.model');
const Conversation = require('../conversation/conversation.model');
const Evolution = require('../evolution/evolution.client');

const VALID_DIRECTIONS = ['in', 'out'];

exports.VALID_DIRECTIONS = VALID_DIRECTIONS;

function normalizePhone(value) {
  return String(value || '')
    .split('@')[0]
    .replace(/\D+/g, '');
}

function normalizeRequestedDirection(value) {
  if (value == null || value === '') return null;

  if (typeof value === 'boolean') {
    return value ? 'out' : 'in';
  }

  const normalized = String(value).trim().toLowerCase();
  if (['out', 'outbound', 'sent', 'fromme'].includes(normalized)) return 'out';
  if (['in', 'inbound', 'received'].includes(normalized)) return 'in';
  return null;
}

async function findConversationContact(organizationId, contactId) {
  return db('contacts')
    .select('id', 'phone', 'name')
    .where({ organization_id: organizationId, id: contactId })
    .first();
}

async function resolveConversationConnection(organizationId, conversation) {
  if (conversation.whatsapp_connection_id) {
    const byId = await db('whatsapp_connections')
      .select('id', 'organization_id', 'chatbot_id', 'evolution_instance', 'status')
      .where({ organization_id: organizationId, id: conversation.whatsapp_connection_id })
      .first();

    if (byId) return byId;
  }

  if (conversation.chatbot_id) {
    const byChatbot = await db('whatsapp_connections')
      .select('id', 'organization_id', 'chatbot_id', 'evolution_instance', 'status')
      .where({ organization_id: organizationId, chatbot_id: conversation.chatbot_id })
      .orderByRaw("CASE WHEN status = 'connected' THEN 0 ELSE 1 END")
      .orderBy('updated_at', 'desc')
      .first();

    if (byChatbot) return byChatbot;
  }

  return db('whatsapp_connections')
    .select('id', 'organization_id', 'chatbot_id', 'evolution_instance', 'status')
    .where({ organization_id: organizationId })
    .orderByRaw("CASE WHEN status = 'connected' THEN 0 ELSE 1 END")
    .orderBy('updated_at', 'desc')
    .first();
}

/**
 * Garante que a conversa existe na organização. Retorna a conversa ou null.
 */
async function assertConversationOwned(organizationId, conversationId) {
  return Conversation.findById(organizationId, conversationId);
}

exports.listByConversation = async (organizationId, conversationId, pagination) => {
  const conv = await assertConversationOwned(organizationId, conversationId);
  if (!conv) return null;
  const rows = await Message.listByConversation(conversationId, pagination);
  return { conversation: conv, messages: rows };
};

exports.createInConversation = async (organizationId, conversationId, { direction, content, flowNodeId, metadata }) => {
  const conv = await assertConversationOwned(organizationId, conversationId);
  if (!conv) return null;
  const row = await Message.create({
    conversationId,
    flowNodeId,
    direction,
    content,
    metadata,
  });
  return row;
};

exports.sendOutboundInConversation = async (
  organizationId,
  conversationId,
  { content, flowNodeId, metadata, requestedDirection }
) => {
  const conv = await assertConversationOwned(organizationId, conversationId);
  if (!conv) return null;

  const normalizedDirection = normalizeRequestedDirection(requestedDirection);
  if (normalizedDirection === 'in') {
    throw httpError(
      400,
      'Este endpoint aceita apenas mensagens de saida.',
      'BAD_REQUEST'
    );
  }
  if (requestedDirection != null && normalizedDirection == null) {
    throw httpError(
      400,
      `direction invalido (use ${VALID_DIRECTIONS.join(' ou ')})`,
      'BAD_REQUEST'
    );
  }

  const contact = await findConversationContact(organizationId, conv.contact_id);
  if (!contact?.phone) {
    throw httpError(400, 'Contato da conversa sem telefone valido.', 'BAD_REQUEST');
  }

  const connection = await resolveConversationConnection(organizationId, conv);
  if (!connection?.evolution_instance) {
    throw httpError(
      400,
      'Nenhuma conexao WhatsApp vinculada foi encontrada para esta conversa.',
      'BAD_REQUEST'
    );
  }

  Evolution.assertConfigured();

  const number = normalizePhone(contact.phone);
  if (!number) {
    throw httpError(400, 'Telefone do contato invalido para envio.', 'BAD_REQUEST');
  }

  const response = await Evolution.sendText(connection.evolution_instance, number, content);
  const externalMessageId = response?.key?.id || response?.messageId || null;

  const row = await db.transaction(async (trx) => {
    const baseMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? { ...metadata }
      : {};

    const [inserted] = await trx('messages')
      .insert({
        conversation_id: conversationId,
        flow_node_id: flowNodeId || null,
        direction: 'out',
        content,
        metadata: {
          ...baseMetadata,
          evolution: {
            ...(baseMetadata.evolution && typeof baseMetadata.evolution === 'object'
              ? baseMetadata.evolution
              : {}),
            instanceName: connection.evolution_instance,
            messageId: externalMessageId,
            status: response?.status || null,
            remoteJid: `${number}@s.whatsapp.net`,
            fromMe: true,
          },
        },
      })
      .returning([
        'id',
        'conversation_id',
        'flow_node_id',
        'direction',
        'content',
        'metadata',
        'created_at',
      ]);

    await trx('conversations')
      .where({ id: conversationId })
      .update({
        whatsapp_connection_id: conv.whatsapp_connection_id || connection.id,
        last_message_preview: content.slice(0, 400),
        last_message_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });

    await trx('whatsapp_connections')
      .where({ id: connection.id, organization_id: organizationId })
      .update({
        last_activity_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });

    return inserted;
  });

  return row;
};
