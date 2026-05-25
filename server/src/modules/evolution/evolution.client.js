const { httpError } = require('../../middlewares/error.middleware');

const DEFAULT_TIMEOUT_MS = 15000;

function readConfig() {
  const baseUrl = (
    process.env.EVOLUTION_API_BASE_URL ||
    process.env.EVOLUTION_API_URL ||
    ''
  ).trim().replace(/\/+$/, '');

  return {
    baseUrl,
    apiKey: (process.env.EVOLUTION_API_KEY || '').trim(),
    defaultInstance: (process.env.EVOLUTION_API_INSTANCE || '').trim(),
    webhookSecret: (
      process.env.EVOLUTION_WEBHOOK_SECRET ||
      process.env.EVOLUTION_WEBHOOK_TOKEN ||
      ''
    ).trim(),
    webhookUrl: (process.env.EVOLUTION_WEBHOOK_URL || '').trim(),
    timeoutMs: Number(process.env.EVOLUTION_API_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  };
}

function isConfigured() {
  const config = readConfig();
  return Boolean(config.baseUrl && config.apiKey);
}

function assertConfigured() {
  if (!isConfigured()) {
    throw httpError(
      503,
      'Evolution API nao configurada. Defina EVOLUTION_API_BASE_URL e EVOLUTION_API_KEY.',
      'EVOLUTION_NOT_CONFIGURED'
    );
  }
}

function buildUrl(pathname, query) {
  const { baseUrl } = readConfig();
  const url = new URL(`${baseUrl}${pathname.startsWith('/') ? pathname : `/${pathname}`}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

function inferErrorMessage(payload, fallback) {
  if (!payload) return fallback;
  if (typeof payload === 'string') return payload;
  if (payload.error && typeof payload.error === 'string') return payload.error;
  if (payload.message && typeof payload.message === 'string') return payload.message;
  if (payload.response?.message && typeof payload.response.message === 'string') {
    return payload.response.message;
  }
  if (payload.instance?.message && typeof payload.instance.message === 'string') {
    return payload.instance.message;
  }
  return fallback;
}

function mapUpstreamStatus(status) {
  if (status === 400 || status === 404 || status === 409) return status;
  if (status === 401 || status === 403) return 502;
  if (status >= 500) return 502;
  return 502;
}

async function request(method, pathname, { query, body } = {}) {
  assertConfigured();

  const config = readConfig();
  const url = buildUrl(pathname, query);
  const controller = new AbortController();
  const timeout = Number.isFinite(config.timeoutMs) && config.timeoutMs > 0
    ? config.timeoutMs
    : DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        apikey: config.apiKey,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (!res.ok) {
      throw httpError(
        mapUpstreamStatus(res.status),
        inferErrorMessage(payload, `Evolution API retornou ${res.status}`),
        'EVOLUTION_API_ERROR'
      );
    }

    return payload;
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw httpError(504, 'Timeout ao conectar com a Evolution API.', 'EVOLUTION_TIMEOUT');
    }
    if (err?.status) throw err;
    throw httpError(502, `Falha ao conectar com a Evolution API: ${err.message}`, 'EVOLUTION_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }
}

function normalizeInstanceEntry(entry) {
  const row = entry?.instance || entry?.response?.instance || entry;
  if (!row || typeof row !== 'object') return null;

  return {
    instanceName: row.instanceName || row.instance_name || null,
    instanceId: row.instanceId || row.instance_id || null,
    status: row.status || row.state || null,
    state: row.state || row.status || null,
    owner: row.owner || row.ownerJid || row.owner_jid || null,
    profileName: row.profileName || row.profile_name || null,
    profilePictureUrl: row.profilePictureUrl || row.profile_picture_url || null,
    profileStatus: row.profileStatus || row.profile_status || null,
    serverUrl: row.serverUrl || row.server_url || null,
    integration: row.integration?.integration || row.integration || null,
    webhookUrl:
      row.integration?.webhook_wa_business ||
      row.webhook_wa_business ||
      row.webhookUrl ||
      null,
  };
}

function unwrapInstances(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.response)) return payload.response;
  if (Array.isArray(payload?.response?.instances)) return payload.response.instances;
  if (payload?.instance) return [payload];
  return [];
}

async function getHealthOrInfo() {
  assertConfigured();
  const config = readConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs || DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(config.baseUrl || '/', {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        apikey: config.apiKey,
      },
      signal: controller.signal,
    });

    const text = await res.text();
    const payload = text ? JSON.parse(text) : {};
    if (!res.ok) {
      throw httpError(
        mapUpstreamStatus(res.status),
        inferErrorMessage(payload, `Evolution API retornou ${res.status}`),
        'EVOLUTION_API_ERROR'
      );
    }
    return payload;
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw httpError(504, 'Timeout ao consultar a Evolution API.', 'EVOLUTION_TIMEOUT');
    }
    if (err?.status) throw err;
    throw httpError(502, `Falha ao consultar a Evolution API: ${err.message}`, 'EVOLUTION_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }
}

async function listInstances(filters = {}) {
  const payload = await request('GET', '/instance/fetchInstances', { query: filters });
  return unwrapInstances(payload).map(normalizeInstanceEntry).filter(Boolean);
}

async function fetchInstance(instanceName) {
  const rows = await listInstances({ instanceName });
  return rows.find((row) => row.instanceName === instanceName) || null;
}

async function createInstance(payload) {
  return request('POST', '/instance/create', { body: payload });
}

async function getConnectionState(instanceName) {
  return request('GET', `/instance/connectionState/${encodeURIComponent(instanceName)}`);
}

async function getQrCode(instanceName, number) {
  return request('GET', `/instance/connect/${encodeURIComponent(instanceName)}`, {
    query: number ? { number } : undefined,
  });
}

async function sendText(instanceName, number, text) {
  return request('POST', `/message/sendText/${encodeURIComponent(instanceName)}`, {
    body: { number, text },
  });
}

async function setWebhook(instanceName, webhookUrl, events, options = {}) {
  return request('POST', `/webhook/set/${encodeURIComponent(instanceName)}`, {
    body: {
      enabled: true,
      url: webhookUrl,
      webhookByEvents: Boolean(options.webhookByEvents),
      webhookBase64: Boolean(options.webhookBase64),
      events,
    },
  });
}

async function findWebhook(instanceName) {
  return request('GET', `/webhook/find/${encodeURIComponent(instanceName)}`);
}

async function deleteInstance(instanceName) {
  return request('DELETE', `/instance/delete/${encodeURIComponent(instanceName)}`);
}

module.exports = {
  readConfig,
  isConfigured,
  assertConfigured,
  getHealthOrInfo,
  listInstances,
  fetchInstance,
  createInstance,
  getConnectionState,
  getQrCode,
  sendText,
  setWebhook,
  findWebhook,
  deleteInstance,
};
