const db = require('../../database');
const Model = require('../whatsapp/whatsapp.model');

function readWebhookSecret() {
  return (
    process.env.EVOLUTION_WEBHOOK_SECRET ||
    process.env.EVOLUTION_WEBHOOK_TOKEN ||
    ''
  ).trim();
}

function normalizeEvolutionEvent(event) {
  if (!event || typeof event !== 'string') return '';
  return event.trim().replace(/\./g, '_').toUpperCase();
}

function resolveEventName(payloadEvent, slugEvent) {
  if (payloadEvent) return normalizeEvolutionEvent(payloadEvent);
  if (!slugEvent) return 'UNKNOWN';
  return normalizeEvolutionEvent(String(slugEvent).replace(/-/g, '_'));
}

function resolveInstanceName(payload = {}) {
  return (
    payload.instance ||
    payload.instanceName ||
    payload.instance_name ||
    payload.data?.instance ||
    payload.data?.instanceName ||
    payload.sender ||
    null
  );
}

function normalizePhone(remoteJid) {
  return String(remoteJid || '')
    .split('@')[0]
    .replace(/\D+/g, '');
}

function normalizeContent(message) {
  if (!message || typeof message !== 'object') return null;
  if (typeof message.conversation === 'string' && message.conversation.trim()) {
    return message.conversation.trim();
  }
  if (typeof message.extendedTextMessage?.text === 'string' && message.extendedTextMessage.text.trim()) {
    return message.extendedTextMessage.text.trim();
  }
  if (typeof message.imageMessage?.caption === 'string' && message.imageMessage.caption.trim()) {
    return message.imageMessage.caption.trim();
  }
  if (typeof message.videoMessage?.caption === 'string' && message.videoMessage.caption.trim()) {
    return message.videoMessage.caption.trim();
  }
  if (typeof message.documentMessage?.caption === 'string' && message.documentMessage.caption.trim()) {
    return message.documentMessage.caption.trim();
  }
  if (typeof message.buttonsResponseMessage?.selectedDisplayText === 'string') {
    return message.buttonsResponseMessage.selectedDisplayText.trim();
  }
  if (typeof message.listResponseMessage?.title === 'string') {
    return message.listResponseMessage.title.trim();
  }

  const messageType = Object.keys(message)[0];
  return messageType ? `[${messageType}]` : null;
}

function inferMessageType(message) {
  if (!message || typeof message !== 'object') return null;
  return Object.keys(message)[0] || null;
}

function extractMessageEntries(payload = {}) {
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.messages)) return payload.messages;
  if (payload.data && typeof payload.data === 'object') return [payload.data];
  return [];
}

function extractQrCodeValue(payload = {}) {
  const candidate =
    payload.data?.qrcode?.base64 ||
    payload.data?.qrcode ||
    payload.data?.base64 ||
    payload.qrcode?.base64 ||
    payload.qrcode ||
    payload.base64 ||
    null;

  if (!candidate) return null;
  if (/^data:image\//i.test(candidate)) return candidate;
  if (/^[A-Za-z0-9+/=]+$/.test(candidate)) {
    return `data:image/png;base64,${candidate}`;
  }
  return candidate;
}

async function upsertMessageForConnection(connection, eventName, item, payload) {
  const remoteJid = item?.key?.remoteJid || item?.key?.participant || null;
  if (!remoteJid || remoteJid.endsWith('@g.us')) return false;

  const phone = normalizePhone(remoteJid);
  if (!phone) return false;

  const fromMe = Boolean(item?.key?.fromMe);
  const content = normalizeContent(item?.message) || '[mensagem sem texto]';
  const externalMessageId = item?.key?.id || null;

  await db.transaction(async (trx) => {
    let contact = await trx('contacts')
      .where({ organization_id: connection.organization_id, phone })
      .first();

    if (!contact) {
      [contact] = await trx('contacts')
        .insert({
          organization_id: connection.organization_id,
          phone,
          name: phone,
        })
        .returning('*');
    }

    let conversation = await trx('conversations')
      .where({
        organization_id: connection.organization_id,
        contact_id: contact.id,
        chatbot_id: connection.chatbot_id,
        whatsapp_connection_id: connection.id,
      })
      .whereIn('status', ['open', 'waiting'])
      .orderBy('updated_at', 'desc')
      .first();

    if (!conversation) {
      [conversation] = await trx('conversations')
        .insert({
          organization_id: connection.organization_id,
          contact_id: contact.id,
          chatbot_id: connection.chatbot_id,
          whatsapp_connection_id: connection.id,
          status: 'open',
          unread_count: fromMe ? 0 : 1,
          last_message_preview: content.slice(0, 400),
          last_message_at: new Date(),
        })
        .returning('*');
    } else {
      const nextUnread = fromMe ? conversation.unread_count : Number(conversation.unread_count || 0) + 1;
      await trx('conversations')
        .where({ id: conversation.id })
        .update({
          unread_count: nextUnread,
          last_message_preview: content.slice(0, 400),
          last_message_at: new Date(),
          updated_at: trx.fn.now(),
        });
    }

    if (externalMessageId) {
      const existing = await trx('messages')
        .where({ conversation_id: conversation.id })
        .whereRaw("metadata->'evolution'->>'messageId' = ?", [externalMessageId])
        .first();

      if (existing) return;
    }

    await trx('messages').insert({
      conversation_id: conversation.id,
      direction: fromMe ? 'out' : 'in',
      content,
      metadata: {
        evolution: {
          event: eventName,
          instanceName: connection.evolution_instance,
          remoteJid,
          messageId: externalMessageId,
          fromMe,
          messageType: inferMessageType(item?.message),
          timestamp: item?.messageTimestamp || payload?.date_time || null,
        },
      },
    });
  });

  return true;
}

async function handleMessagesUpsert(connection, eventName, payload) {
  if (!connection?.chatbot_id) {
    return { handled: false, reason: 'connection_without_chatbot' };
  }

  let persisted = 0;
  for (const item of extractMessageEntries(payload)) {
    const saved = await upsertMessageForConnection(connection, eventName, item, payload);
    if (saved) persisted += 1;
  }

  await Model.updateByInstanceName(connection.evolution_instance, {
    last_activity_at: new Date(),
  });

  return { handled: persisted > 0, persisted };
}

async function handleConnectionUpdate(connection, payload) {
  const state =
    payload?.data?.state ||
    payload?.data?.instance?.state ||
    payload?.instance?.state ||
    null;

  const normalizedState = String(state || '').trim().toLowerCase();
  const status = normalizedState === 'open'
    ? 'connected'
    : ['close', 'closed', 'logout'].includes(normalizedState)
      ? 'disconnected'
      : 'pending_qr';

  await Model.updateByInstanceName(connection.evolution_instance, {
    status,
    qr_code: status === 'connected' ? null : connection.qr_code,
    qr_expires_at: status === 'connected' ? null : connection.qr_expires_at,
    phone_number: normalizePhone(payload?.data?.owner || payload?.data?.phone || connection.phone_number),
    last_activity_at: new Date(),
  });

  return { handled: true };
}

async function handleQrUpdated(connection, payload) {
  const qrCodeValue = extractQrCodeValue(payload);
  await Model.updateByInstanceName(connection.evolution_instance, {
    status: 'pending_qr',
    qr_code: qrCodeValue || connection.qr_code,
    qr_expires_at: qrCodeValue ? new Date(Date.now() + 60 * 1000) : connection.qr_expires_at,
    last_activity_at: new Date(),
  });

  return { handled: Boolean(qrCodeValue) };
}

async function handleEvolutionWebhook(payload = {}, slugEvent) {
  const eventName = resolveEventName(payload.event, slugEvent);
  const instanceName = resolveInstanceName(payload);

  if (!instanceName) {
    console.warn(`[evolution-webhook] evento ${eventName} sem instancia identificavel`);
    return { event: eventName, handled: false };
  }

  const connection = await Model.findByInstanceName(instanceName);
  if (!connection) {
    console.warn(`[evolution-webhook] instancia ${instanceName} nao vinculada localmente`);
    return { event: eventName, handled: false };
  }

  switch (eventName) {
    case 'MESSAGES_UPSERT':
    case 'MESSAGES_SET':
      return { event: eventName, ...(await handleMessagesUpsert(connection, eventName, payload)) };

    case 'CONNECTION_UPDATE':
      return { event: eventName, ...(await handleConnectionUpdate(connection, payload)) };

    case 'QRCODE_UPDATED':
      return { event: eventName, ...(await handleQrUpdated(connection, payload)) };

    case 'MESSAGES_UPDATE':
    case 'MESSAGES_DELETE':
    case 'SEND_MESSAGE':
      await Model.updateByInstanceName(connection.evolution_instance, {
        last_activity_at: new Date(),
      });
      return { event: eventName, handled: true };

    default:
      return { event: eventName, handled: false };
  }
}

function isSecretValid(req) {
  const expected = readWebhookSecret();
  if (!expected) return true;
  const provided =
    req.get('x-evolution-webhook-secret') ||
    req.query?.secret ||
    null;
  return provided === expected;
}

module.exports = {
  readWebhookSecret,
  isSecretValid,
  handleEvolutionWebhook,
};
