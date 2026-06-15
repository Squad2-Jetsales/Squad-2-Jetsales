const crypto = require('crypto');
const { resolveChatProvider, resolveEmbeddingProvider } = require('./providers');
const { logUsage } = require('./observability/usage.logger');
const { httpError } = require('../../middlewares/error.middleware');
const { sanitizeFlowGraph } = require('../flow/flow.graph');
const db = require('../../database');

const SUPPORTED_NODE_TYPES = new Set([
  'trigger',
  'message',
  'menu',
  'condition',
  'wait',
  'capture',
  'integration',
  'end',
]);

function buildAiNotConfiguredError() {
  return httpError(503, 'IA não configurada neste ambiente', 'AI_NOT_CONFIGURED');
}

function isChatConfigurationError(err) {
  const message = String(err?.message || '');
  return (
    message.includes('API_KEY não configurada')
    || message.includes('AI_CHAT_PROVIDER inválido')
    || message.includes('Provider desconhecido')
  );
}

function requireChatProvider() {
  try {
    return resolveChatProvider();
  } catch (err) {
    if (isChatConfigurationError(err)) {
      throw buildAiNotConfiguredError();
    }
    throw err;
  }
}

function extractJsonString(content) {
  if (!content || typeof content !== 'string') {
    throw httpError(502, 'Resposta inválida do provedor de IA', 'AI_INVALID_RESPONSE');
  }

  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return content.slice(start, end + 1).trim();
  }

  return content.trim();
}

function parseGraphPayload(content) {
  try {
    return JSON.parse(extractJsonString(content));
  } catch (_err) {
    throw httpError(502, 'Resposta inválida do provedor de IA', 'AI_INVALID_RESPONSE');
  }
}

function normalizeNodeType(type) {
  const normalized = String(type || '').trim().toLowerCase();
  if (normalized === 'choice') return 'menu';
  if (normalized === 'input') return 'capture';
  if (normalized === 'api') return 'integration';
  return SUPPORTED_NODE_TYPES.has(normalized) ? normalized : 'message';
}

function normalizeMenuOptions(options) {
  if (!Array.isArray(options)) return [];

  return options
    .map((option, index) => {
      if (typeof option === 'string') {
        const label = option.trim();
        if (!label) return null;
        return {
          id: crypto.randomUUID(),
          label,
          value: String(index + 1),
        };
      }

      if (!option || typeof option !== 'object') return null;

      const label = String(option.label || option.text || option.value || '').trim();
      if (!label) return null;

      return {
        id: String(option.id || crypto.randomUUID()),
        label,
        value: String(option.value || label),
      };
    })
    .filter(Boolean);
}

function normalizeCondition(condition) {
  if (!condition || typeof condition !== 'object') return undefined;

  const field = String(condition.field || condition.variable || 'input').trim() || 'input';
  const operator = String(condition.operator || 'contains').trim() || 'contains';
  const value = String(condition.value || '').trim();

  if (!value) return undefined;
  return { field, operator, value };
}

function normalizeNodeData(type, raw) {
  const text = String(
    raw?.text
    ?? raw?.message
    ?? raw?.prompt
    ?? raw?.data?.text
    ?? raw?.data?.message
    ?? '',
  ).trim();

  const base = {};

  if (type === 'message' || type === 'capture') {
    base.text = text || (type === 'capture' ? 'Qual informação você precisa coletar?' : 'Mensagem gerada pela IA');
  }

  if (type === 'capture') {
    base.variable = String(
      raw?.variable
      ?? raw?.captureField
      ?? raw?.data?.variable
      ?? raw?.data?.captureField
      ?? 'resposta',
    ).trim() || 'resposta';
  }

  if (type === 'menu') {
    const options = normalizeMenuOptions(raw?.options ?? raw?.data?.options);
    base.options = options.length > 0
      ? options
      : [{ id: crypto.randomUUID(), label: 'Continuar', value: '1' }];
  }

  if (type === 'condition') {
    base.condition = normalizeCondition(raw?.condition ?? raw?.data?.condition)
      || { field: 'input', operator: 'contains', value: 'sim' };
  }

  if (type === 'wait') {
    const waitMs = Number(raw?.waitMs ?? raw?.delay ?? raw?.data?.waitMs ?? raw?.data?.delay ?? 1000);
    base.waitMs = Number.isFinite(waitMs) && waitMs >= 0 ? waitMs : 1000;
  }

  if (raw?.label || raw?.data?.label) {
    base.label = String(raw.label ?? raw.data.label).trim();
  }

  return base;
}

function buildFallbackId(type, index) {
  return `${type}_${index + 1}`;
}

function normalizeNodes(rawNodes) {
  const nodes = Array.isArray(rawNodes) ? rawNodes : [];

  return nodes.map((raw, index) => {
    const type = normalizeNodeType(raw?.type);
    return {
      id: String(raw?.id || raw?.label || raw?.data?.label || buildFallbackId(type, index)).trim(),
      type,
      data: normalizeNodeData(type, raw),
      position_x: Number(raw?.position_x ?? raw?.positionX ?? raw?.x ?? ((index % 3) * 280 + 120)),
      position_y: Number(raw?.position_y ?? raw?.positionY ?? raw?.y ?? (Math.floor(index / 3) * 180 + 80)),
    };
  });
}

function ensureTriggerNode(nodes) {
  const triggers = nodes.filter((node) => node.type === 'trigger');
  if (triggers.length > 0) return nodes;

  return [
    {
      id: 'start',
      type: 'trigger',
      data: { label: 'start' },
      position_x: 120,
      position_y: 80,
    },
    ...nodes,
  ];
}

function ensureEndNode(nodes) {
  if (nodes.some((node) => node.type === 'end')) return nodes;

  return [
    ...nodes,
    {
      id: 'end',
      type: 'end',
      data: { label: 'end' },
      position_x: 720,
      position_y: 80,
    },
  ];
}

function buildNodeRefMap(nodes) {
  const refMap = new Map();
  for (const node of nodes) {
    refMap.set(node.id, node.id);
    if (node.data?.label) refMap.set(node.data.label, node.id);
  }
  return refMap;
}

function normalizeEdges(rawEdges, nodes) {
  const edges = Array.isArray(rawEdges) ? rawEdges : [];
  const refMap = buildNodeRefMap(nodes);

  return edges.map((raw, index) => ({
    id: String(raw?.id || `edge_${index + 1}`),
    from: refMap.get(String(raw?.from ?? raw?.source ?? raw?.sourceNodeId ?? raw?.source_node_id ?? '').trim()) || '',
    to: refMap.get(String(raw?.to ?? raw?.target ?? raw?.targetNodeId ?? raw?.target_node_id ?? '').trim()) || '',
    source_handle: raw?.source_handle ?? raw?.sourceHandle ?? null,
    condition:
      raw?.condition && typeof raw.condition === 'object'
        ? {
            operator: String(raw.condition.operator || '').trim(),
            value: raw.condition.value != null ? String(raw.condition.value) : '',
          }
        : undefined,
  }));
}

function buildSequentialEdges(nodes) {
  const edges = [];
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const current = nodes[index];
    const next = nodes[index + 1];
    if (current.type === 'end') continue;
    edges.push({
      id: `edge_auto_${index + 1}`,
      from: current.id,
      to: next.id,
      source_handle: null,
    });
  }
  return edges;
}

function ensureTerminalEdges(nodes, edges) {
  const endNode = nodes.find((node) => node.type === 'end');
  if (!endNode) return edges;

  const outgoing = new Set(edges.map((edge) => edge.from));
  const additions = nodes
    .filter((node) => node.type !== 'end' && !outgoing.has(node.id))
    .map((node, index) => ({
      id: `edge_finish_${index + 1}_${node.id}`,
      from: node.id,
      to: endNode.id,
      source_handle: null,
    }));

  return [...edges, ...additions];
}

function normalizeGraphPayload(payload) {
  let nodes = normalizeNodes(payload?.states ?? payload?.nodes);
  nodes = ensureTriggerNode(nodes);
  nodes = ensureEndNode(nodes);

  let edges = normalizeEdges(payload?.edges, nodes);
  if (edges.length === 0) {
    edges = buildSequentialEdges(nodes);
  }
  edges = ensureTerminalEdges(nodes, edges);

  const sanitized = sanitizeFlowGraph({ states: nodes, edges });
  if (sanitized.states.length === 0) {
    throw httpError(502, 'Resposta inválida do provedor de IA', 'AI_INVALID_RESPONSE');
  }

  return {
    states: sanitized.states,
    edges: sanitized.edges,
    warnings: sanitized.warnings || [],
  };
}

async function chatForGraph({ organizationId, chatbotId = null, messages, metadata }) {
  const provider = requireChatProvider();

  let response;
  try {
    response = await provider.chat({
      messages,
      temperature: 0.2,
      maxTokens: Number(process.env.AI_MAX_OUTPUT_TOKENS || 1400),
    });
  } catch (err) {
    if (isChatConfigurationError(err)) {
      throw buildAiNotConfiguredError();
    }
    throw httpError(502, 'Falha ao consultar o provedor de IA', 'AI_PROVIDER_ERROR');
  }

  await logUsage({
    organizationId,
    chatbotId,
    provider: response.provider || provider.name,
    model: response.model || process.env.AI_CHAT_MODEL || null,
    operation: 'chat',
    promptTokens: response.usage?.promptTokens || 0,
    completionTokens: response.usage?.completionTokens || 0,
    latencyMs: response.latencyMs || 0,
    metadata,
  });

  const payload = parseGraphPayload(response.content);
  const graph = normalizeGraphPayload(payload);

  return {
    ...graph,
    provider: response.provider || provider.name,
    model: response.model || process.env.AI_CHAT_MODEL || null,
  };
}

function buildGenerateMessages({ name, description, prompt }) {
  return [
    {
      role: 'system',
      content: [
        'Você gera fluxos de chatbot para o editor visual do JetSales.',
        'Responda somente JSON válido, sem markdown, sem explicações.',
        'Formato obrigatório:',
        '{"nodes":[{"id":"start","type":"trigger","data":{"label":"start"},"position_x":120,"position_y":80}],"edges":[{"from":"start","to":"node_1"}]}',
        'Tipos permitidos: trigger, message, menu, condition, wait, capture, integration, end.',
        'Para message/capture use data.text.',
        'Para capture use data.variable.',
        'Para menu use data.options=[{id,label,value}].',
        'Para condition use data.condition={field,operator,value}.',
        'Sempre devolva o fluxo completo, incluindo início e fim.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Nome do chatbot: ${name}`,
        description ? `Descrição: ${description}` : null,
        `Objetivo do fluxo: ${prompt}`,
        'Crie um fluxo inicial coerente e enxuto, pronto para edição humana.',
      ].filter(Boolean).join('\n'),
    },
  ];
}

function serializeExistingFlow(flow) {
  return JSON.stringify({
    nodes: (flow?.states || []).map((node) => ({
      id: node.id,
      type: node.type,
      data: {
        label: node.data?.label,
        text: node.data?.text ?? node.data?.message,
        variable: node.data?.variable,
        options: node.data?.options,
        condition: node.data?.condition,
        waitMs: node.data?.waitMs ?? node.data?.delay,
      },
      position_x: node.position_x ?? node.positionX ?? 0,
      position_y: node.position_y ?? node.positionY ?? 0,
    })),
    edges: (flow?.edges || []).map((edge) => ({
      from: edge.source_node_id ?? edge.sourceNodeId ?? edge.from,
      to: edge.target_node_id ?? edge.targetNodeId ?? edge.to,
      source_handle: edge.source_handle ?? edge.sourceHandle ?? null,
      condition:
        edge.condition_type || edge.condition?.operator
          ? {
              operator: edge.condition_type ?? edge.condition?.operator,
              value: edge.condition_value ?? edge.condition?.value ?? '',
            }
          : undefined,
    })),
  });
}

function buildAdjustMessages({ chatbotName, instruction, flow }) {
  return [
    {
      role: 'system',
      content: [
        'Você ajusta fluxos de chatbot para o editor visual do JetSales.',
        'Responda somente JSON válido, sem markdown, sem explicações.',
        'Devolva o fluxo inteiro atualizado em {"nodes":[...],"edges":[...]}.',
        'Mantenha os tipos suportados: trigger, message, menu, condition, wait, capture, integration, end.',
        'Mantenha somente um trigger.',
        'Não remova etapas úteis sem necessidade; aplique a instrução do usuário com a menor mudança destrutiva possível.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Chatbot: ${chatbotName}`,
        `Instrução de ajuste: ${instruction}`,
        'Fluxo atual:',
        serializeExistingFlow(flow),
      ].join('\n'),
    },
  ];
}

async function generateInitialFlow({ organizationId, chatbotName, description, prompt }) {
  return chatForGraph({
    organizationId,
    messages: buildGenerateMessages({
      name: chatbotName,
      description,
      prompt,
    }),
    metadata: {
      feature: 'chatbot.ai-generate',
      chatbotName,
    },
  });
}

async function adjustExistingFlow({ organizationId, chatbotId, chatbotName, instruction, flow }) {
  return chatForGraph({
    organizationId,
    chatbotId,
    messages: buildAdjustMessages({
      chatbotName,
      instruction,
      flow,
    }),
    metadata: {
      feature: 'chatbot.ai-adjust',
      chatbotId,
    },
  });
}

async function health() {
  const result = { chat: null, embedding: null, usageLogs: null };

  try {
    const chat = resolveChatProvider();
    const ping = await chat.ping();
    result.chat = {
      provider: chat.name,
      configuredModel: process.env.AI_CHAT_MODEL || null,
      ...ping,
    };
  } catch (err) {
    result.chat = {
      provider: process.env.AI_CHAT_PROVIDER || 'anthropic',
      ok: false,
      latencyMs: 0,
      error: err.message,
    };
  }

  try {
    const embed = resolveEmbeddingProvider();
    const ping = await embed.ping();
    result.embedding = {
      provider: embed.name,
      configuredModel: process.env.AI_EMBEDDING_MODEL || null,
      dim: Number(process.env.AI_EMBEDDING_DIM || 1536),
      ...ping,
    };
  } catch (err) {
    result.embedding = {
      provider: process.env.AI_EMBEDDING_PROVIDER || 'openai',
      ok: false,
      latencyMs: 0,
      error: err.message,
    };
  }

  try {
    const { count } = await db('ai_usage_logs').count('id as count').first();
    result.usageLogs = { ok: true, totalRows: Number(count) };
  } catch (err) {
    result.usageLogs = { ok: false, error: err.message };
  }

  return result;
}

module.exports = {
  adjustExistingFlow,
  buildAiNotConfiguredError,
  generateInitialFlow,
  health,
};
