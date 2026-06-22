const crypto = require('crypto');

const db = require('../../database');
const { httpError } = require('../../middlewares/error.middleware');
const Evolution = require('../evolution/evolution.client');
const Model = require('./whatsapp.model');
const { mapConnection } = require('./whatsapp.mapper');

const DEFAULT_WEBHOOK_EVENTS = [
  'CONNECTION_UPDATE',
  'QRCODE_UPDATED',
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'MESSAGES_DELETE',
  'SEND_MESSAGE',
];

const VALID_STATUSES = ['connected', 'disconnected', 'pending_qr'];

function normalizePhone(value) {
  return String(value || '')
    .split('@')[0]
    .replace(/\D+/g, '');
}

function mapEvolutionStateToLocal(state) {
  const value = String(state || '').trim().toLowerCase();
  if (['open', 'connected'].includes(value)) return 'connected';
  if (['close', 'closed', 'disconnected', 'logout'].includes(value)) return 'disconnected';
  return 'pending_qr';
}

function sanitizeNameFragment(name) {
  const base = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return base || 'conexao';
}

function buildInstanceName(organizationId, name) {
  return [
    sanitizeNameFragment(name),
    String(organizationId || '').slice(0, 8),
    crypto.randomUUID().slice(0, 8),
  ]
    .filter(Boolean)
    .join('-');
}

function isQrExpired(row) {
  if (!row?.qr_expires_at) return true;
  return new Date(row.qr_expires_at).getTime() <= Date.now();
}

function extractQrCodeValue(payload) {
  if (!payload) return null;
  return (
    payload.code ||
    payload.qrcode ||
    payload.qrCode ||
    payload.base64 ||
    payload.qrcode?.base64 ||
    payload.qrcode?.code ||
    null
  );
}

function buildWebhookUrl(url) {
  const config = Evolution.readConfig();
  const value = (url || config.webhookUrl || '').trim();
  if (!value) return null;

  try {
    const parsed = new URL(value);
    if (config.webhookSecret && !parsed.searchParams.has('secret')) {
      parsed.searchParams.set('secret', config.webhookSecret);
    }
    return parsed.toString();
  } catch {
    throw httpError(400, 'EVOLUTION_WEBHOOK_URL invalida.', 'BAD_REQUEST');
  }
}

async function ensureChatbotBelongsToOrganization(organizationId, chatbotId) {
  if (!chatbotId) return null;
  const row = await db('chatbots')
    .select('id')
    .where({ organization_id: organizationId, id: chatbotId })
    .first();
  if (!row) {
    throw httpError(400, 'chatbotId invalido para a organizacao.', 'BAD_REQUEST');
  }
  return row;
}

async function mapRowsWithMetrics(organizationId, rows, extraById = new Map()) {
  const metricsById = await Model.countTodayByConnectionIds(
    organizationId,
    rows.map((row) => row.id)
  );

  return Promise.all(
    rows.map((row) =>
      mapConnection(row, {
        conversationsToday: metricsById.get(row.id) || 0,
        pairingCode: extraById.get(row.id)?.pairingCode,
      })
    )
  );
}

async function syncStoredRowFromRemote(row, remoteInstance) {
  if (!row || !remoteInstance) return row;

  const patch = {};
  const phone = normalizePhone(remoteInstance.owner);
  const status = mapEvolutionStateToLocal(remoteInstance.state || remoteInstance.status);

  if (phone && phone !== row.phone_number) patch.phone_number = phone;
  if (status && status !== row.status) patch.status = status;
  if (status === 'connected') {
    patch.qr_code = null;
    patch.qr_expires_at = null;
    patch.last_activity_at = new Date();
  }

  if (!Object.keys(patch).length) return row;
  return Model.updateById(row.organization_id, row.id, patch);
}

async function refreshQrForRow(row) {
  Evolution.assertConfigured();

  const payload = await Evolution.getQrCode(row.evolution_instance, row.phone_number || undefined);
  const qrCodeValue = extractQrCodeValue(payload);
  if (!qrCodeValue) {
    throw httpError(502, 'Evolution API nao retornou um QR Code valido.', 'EVOLUTION_QR_MISSING');
  }

  const updated = await Model.updateById(row.organization_id, row.id, {
    status: 'pending_qr',
    qr_code: qrCodeValue,
    qr_expires_at: new Date(Date.now() + 60 * 1000),
  });

  return {
    row: updated,
    pairingCode: payload?.pairingCode || payload?.pairing_code || undefined,
  };
}

async function maybeSyncRow(row, { refreshQrIfNeeded = false } = {}) {
  if (!row || !Evolution.isConfigured()) return { row };

  let remoteInstance = null;
  try {
    remoteInstance = await Evolution.fetchInstance(row.evolution_instance);
  } catch (err) {
    if (err.status !== 404) throw err;
  }

  if (remoteInstance) {
    row = await syncStoredRowFromRemote(row, remoteInstance);
  }

  let connectionState = null;
  try {
    connectionState = await Evolution.getConnectionState(row.evolution_instance);
  } catch (err) {
    if (err.status !== 404) throw err;
  }

  const state = connectionState?.instance?.state || remoteInstance?.state || remoteInstance?.status;
  if (state) {
    const status = mapEvolutionStateToLocal(state);
    const patch = {};
    if (status !== row.status) patch.status = status;
    if (status === 'connected') {
      patch.qr_code = null;
      patch.qr_expires_at = null;
      patch.last_activity_at = new Date();
    }
    if (Object.keys(patch).length) {
      row = await Model.updateById(row.organization_id, row.id, patch);
    }
  }

  let qrMeta = {};
  if (refreshQrIfNeeded && row.status !== 'connected' && isQrExpired(row)) {
    qrMeta = await refreshQrForRow(row);
    row = qrMeta.row;
  }

  return { row, pairingCode: qrMeta.pairingCode };
}

async function resolveInstanceTarget(organizationId, { connectionId, instanceName, allowDefault = true } = {}) {
  if (connectionId) {
    const row = await Model.findById(organizationId, connectionId);
    if (!row) throw httpError(404, 'Conexao WhatsApp nao encontrada.', 'NOT_FOUND');
    return { instanceName: row.evolution_instance, connection: row };
  }

  if (instanceName) {
    const row = await Model.findByOrganizationAndInstance(organizationId, instanceName);
    if (row) return { instanceName, connection: row };

    if (allowDefault && Evolution.readConfig().defaultInstance === instanceName) {
      return { instanceName, connection: null };
    }

    throw httpError(404, 'Instancia WhatsApp nao encontrada para esta organizacao.', 'NOT_FOUND');
  }

  const config = Evolution.readConfig();
  if (allowDefault && config.defaultInstance) {
    return { instanceName: config.defaultInstance, connection: null };
  }

  throw httpError(
    400,
    'Informe connectionId ou instanceName para identificar a instancia.',
    'BAD_REQUEST'
  );
}

exports.VALID_STATUSES = VALID_STATUSES;
exports.DEFAULT_WEBHOOK_EVENTS = DEFAULT_WEBHOOK_EVENTS;

exports.list = async (organizationId) => {
  let rows = await Model.listByOrganization(organizationId);

  if (Evolution.isConfigured()) {
    try {
      const remoteRows = await Evolution.listInstances();
      const byName = new Map(remoteRows.map((row) => [row.instanceName, row]));

      rows = await Promise.all(
        rows.map(async (row) => {
          const remote = byName.get(row.evolution_instance);
          return remote ? syncStoredRowFromRemote(row, remote) : row;
        })
      );
    } catch (err) {
      console.warn(`[whatsapp] falha ao sincronizar instancias: ${err.message}`);
    }
  }

  return mapRowsWithMetrics(organizationId, rows);
};

exports.findById = async (organizationId, id) => {
  const row = await Model.findById(organizationId, id);
  if (!row) return null;

  const { row: syncedRow, pairingCode } = await maybeSyncRow(row, { refreshQrIfNeeded: true });
  const [mapped] = await mapRowsWithMetrics(organizationId, [syncedRow], new Map([[syncedRow.id, { pairingCode }]]));
  return mapped;
};

exports.createConnection = async (organizationId, input = {}) => {
  Evolution.assertConfigured();

  const name = String(input.name || '').trim();
  if (!name) {
    throw httpError(400, 'name e obrigatorio.', 'BAD_REQUEST');
  }

  await ensureChatbotBelongsToOrganization(organizationId, input.chatbotId);

  const instanceName = String(input.instanceName || buildInstanceName(organizationId, name));
  const webhookUrl = buildWebhookUrl(input.webhookUrl);

  await Evolution.createInstance({
    instanceName,
    integration: input.integration || 'WHATSAPP-BAILEYS',
    qrcode: true,
    number: input.number || undefined,
  });

  try {
    if (webhookUrl) {
      await Evolution.setWebhook(
        instanceName,
        webhookUrl,
        Array.isArray(input.webhookEvents) && input.webhookEvents.length
          ? input.webhookEvents
          : DEFAULT_WEBHOOK_EVENTS,
        {
          webhookByEvents: false,
          webhookBase64: false,
        }
      );
    }

    const qrPayload = await Evolution.getQrCode(instanceName, input.number || undefined);
    const qrCodeValue = extractQrCodeValue(qrPayload);

    const row = await Model.create({
      organization_id: organizationId,
      chatbot_id: input.chatbotId || null,
      name,
      phone_number: normalizePhone(input.number),
      evolution_instance: instanceName,
      status: qrCodeValue ? 'pending_qr' : 'disconnected',
      qr_code: qrCodeValue,
      qr_expires_at: qrCodeValue ? new Date(Date.now() + 60 * 1000) : null,
    });

    return mapConnection(row, {
      conversationsToday: 0,
      pairingCode: qrPayload?.pairingCode || qrPayload?.pairing_code || undefined,
    });
  } catch (err) {
    try {
      await Evolution.deleteInstance(instanceName);
    } catch (cleanupErr) {
      console.warn(`[whatsapp] falha ao limpar instancia ${instanceName}: ${cleanupErr.message}`);
    }
    throw err;
  }
};

exports.refreshQr = async (organizationId, id) => {
  const row = await Model.findById(organizationId, id);
  if (!row) throw httpError(404, 'Conexao WhatsApp nao encontrada.', 'NOT_FOUND');

  const { row: updated, pairingCode } = await refreshQrForRow(row);
  return mapConnection(updated, { conversationsToday: 0, pairingCode });
};

exports.remove = async (organizationId, id) => {
  Evolution.assertConfigured();

  const row = await Model.findById(organizationId, id);
  if (!row) return false;

  await Evolution.deleteInstance(row.evolution_instance);
  const removed = await Model.removeById(organizationId, id);
  return removed > 0;
};

exports.getEvolutionStatus = async () => {
  Evolution.assertConfigured();

  const config = Evolution.readConfig();
  const info = await Evolution.getHealthOrInfo();
  let defaultInstance = null;

  if (config.defaultInstance) {
    try {
      const remote = await Evolution.fetchInstance(config.defaultInstance);
      const state = await Evolution.getConnectionState(config.defaultInstance);
      defaultInstance = {
        instanceName: config.defaultInstance,
        status: mapEvolutionStateToLocal(state?.instance?.state || remote?.state || remote?.status),
        phoneNumber: normalizePhone(remote?.owner),
      };
    } catch (err) {
      defaultInstance = {
        instanceName: config.defaultInstance,
        error: err.message,
      };
    }
  }

  return {
    configured: true,
    baseUrl: config.baseUrl,
    webhookUrl: config.webhookUrl || null,
    info,
    defaultInstance,
  };
};

exports.getInstanceStatus = async (organizationId, instanceName) => {
  Evolution.assertConfigured();
  const target = await resolveInstanceTarget(organizationId, { instanceName });
  const state = await Evolution.getConnectionState(target.instanceName);
  const remote = await Evolution.fetchInstance(target.instanceName);

  if (target.connection) {
    await syncStoredRowFromRemote(target.connection, {
      state: state?.instance?.state || remote?.state,
      owner: remote?.owner,
    });
  }

  return {
    instanceName: target.instanceName,
    status: mapEvolutionStateToLocal(state?.instance?.state || remote?.state || remote?.status),
    state: state?.instance?.state || remote?.state || remote?.status || null,
    phoneNumber: normalizePhone(remote?.owner),
  };
};

exports.getInstanceQrCode = async (organizationId, instanceName) => {
  Evolution.assertConfigured();
  const target = await resolveInstanceTarget(organizationId, { instanceName });

  if (target.connection) {
    const { row, pairingCode } = await refreshQrForRow(target.connection);
    return mapConnection(row, { conversationsToday: 0, pairingCode });
  }

  const payload = await Evolution.getQrCode(target.instanceName);
  return {
    instanceName: target.instanceName,
    pairingCode: payload?.pairingCode || payload?.pairing_code || null,
    qrCodeValue: extractQrCodeValue(payload),
  };
};

exports.sendTestMessage = async (organizationId, input = {}) => {
  Evolution.assertConfigured();

  const number = normalizePhone(input.number);
  const text = String(input.text || '').trim();
  if (!number || !text) {
    throw httpError(400, 'number e text sao obrigatorios.', 'BAD_REQUEST');
  }

  const target = await resolveInstanceTarget(organizationId, input);
  const response = await Evolution.sendText(target.instanceName, number, text);

  if (target.connection) {
    await Model.updateById(organizationId, target.connection.id, {
      last_activity_at: new Date(),
    });
  }

  return {
    instanceName: target.instanceName,
    number,
    status: response?.status || null,
    messageId: response?.key?.id || null,
  };
};

exports.configureWebhook = async (organizationId, input = {}) => {
  Evolution.assertConfigured();

  const target = await resolveInstanceTarget(organizationId, input);
  const webhookUrl = buildWebhookUrl(input.url);
  if (!webhookUrl) {
    throw httpError(
      400,
      'Informe EVOLUTION_WEBHOOK_URL ou envie url no corpo da requisicao.',
      'BAD_REQUEST'
    );
  }

  const events = Array.isArray(input.events) && input.events.length
    ? input.events
    : DEFAULT_WEBHOOK_EVENTS;

  await Evolution.setWebhook(target.instanceName, webhookUrl, events, {
    webhookByEvents: Boolean(input.webhookByEvents),
    webhookBase64: Boolean(input.webhookBase64),
  });

  const current = await Evolution.findWebhook(target.instanceName);
  return {
    instanceName: target.instanceName,
    enabled: current?.enabled ?? true,
    url: current?.url || webhookUrl,
    events: current?.events || events,
  };
};
