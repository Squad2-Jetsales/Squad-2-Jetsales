// server/src/modules/chatbot/chatbot.service.js
//
// Camada de servico de chatbots. Assinatura casa com o que
// chatbot.controller.js chama hoje:
//   - service.VALID_TYPES
//   - service.list(organizationId, { status, type })
//   - service.findById(organizationId, id)
//   - service.create(organizationId, userId, data)
//   - service.update(organizationId, id, patch)
//   - service.remove(organizationId, id) -> boolean
//   - service.duplicate(organizationId, userId, id)
//   - service.activate(organizationId, id)
//   - service.deactivate(organizationId, id)
//
// Todas as queries sao tenant-scoped por organization_id. O model expoe um
// CRUD agnostico (sem org); o filtro acontece aqui.

const crypto = require('crypto');
const Chatbot = require('./chatbot.model');
const db = require('../../database');
const aiService = require('../ai/ai.service');
const flowService = require('../flow/flow.service');
const { mapFlow } = require('../flow/flow.mapper');
const {
  createInitialFlowForChatbot,
  ensureActiveFlowForChatbot,
} = require('./active-flow.helper');

const TABLE = 'chatbots';
const VALID_TYPES = ['manual', 'ai_generated', 'ai_agent'];

exports.VALID_TYPES = VALID_TYPES;

function asCount(value) {
  return Number(value || 0);
}

function toIso(value) {
  if (!value) return value;
  return value instanceof Date ? value.toISOString() : value;
}

function mapChatbot(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    activeFlowId: row.active_flow_id || null,
    name: row.name,
    description: row.description || '',
    type: row.type,
    isActive: Boolean(row.is_active),
    aiConfig: row.ai_config || undefined,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    metrics: row.metrics,
  };
}

function mapFlowNodeForClient(row) {
  const data = row?.data || {};
  const waitMs =
    typeof data.waitMs === 'number'
      ? data.waitMs
      : typeof data.delay === 'number'
        ? data.delay
        : undefined;

  return {
    id: row.id,
    flowId: row.flow_id,
    type: row.type,
    data: {
      label: data.label,
      text: data.text ?? data.message,
      variable: data.variable,
      options: data.options,
      condition: data.condition,
      waitMs,
      captureField: data.captureField,
    },
    positionX: Number(row.position_x || 0),
    positionY: Number(row.position_y || 0),
  };
}

function mapFlowEdgeForClient(row) {
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

function mapFlowGraphForClient(flow) {
  return {
    flow: mapFlow(flow),
    nodes: (flow?.states || []).map(mapFlowNodeForClient),
    edges: (flow?.edges || []).map(mapFlowEdgeForClient),
  };
}

async function ensureActiveFlows(rows) {
  if (!rows.length) return rows;
  return db.transaction(async (trx) => {
    const ensured = [];
    for (const row of rows) {
      ensured.push(await ensureActiveFlowForChatbot(trx, row));
    }
    return ensured;
  });
}

async function attachMetrics(organizationId, rows) {
  if (!rows.length) return rows;

  const chatbotIds = rows.map((row) => row.id);
  const flowIds = rows.map((row) => row.active_flow_id).filter(Boolean);

  const [nodeCounts, edgeCounts, connectionCounts, messageCounts] = await Promise.all([
    flowIds.length
      ? db('flow_nodes')
          .select('flow_id')
          .count({ total_nodes: '*' })
          .whereIn('flow_id', flowIds)
          .groupBy('flow_id')
      : [],
    flowIds.length
      ? db('flow_edges')
          .select('flow_id')
          .count({ total_edges: '*' })
          .whereIn('flow_id', flowIds)
          .groupBy('flow_id')
      : [],
    db('whatsapp_connections')
      .select('chatbot_id')
      .count({ connections: '*' })
      .where({ organization_id: organizationId })
      .whereIn('chatbot_id', chatbotIds)
      .groupBy('chatbot_id'),
    db('messages')
      .join('conversations', 'conversations.id', 'messages.conversation_id')
      .select('conversations.chatbot_id')
      .count({ messages_processed: 'messages.id' })
      .where('conversations.organization_id', organizationId)
      .whereIn('conversations.chatbot_id', chatbotIds)
      .groupBy('conversations.chatbot_id'),
  ]);

  const nodesByFlow = new Map(nodeCounts.map((row) => [row.flow_id, asCount(row.total_nodes)]));
  const edgesByFlow = new Map(edgeCounts.map((row) => [row.flow_id, asCount(row.total_edges)]));
  const connectionsByChatbot = new Map(connectionCounts.map((row) => [row.chatbot_id, asCount(row.connections)]));
  const messagesByChatbot = new Map(messageCounts.map((row) => [row.chatbot_id, asCount(row.messages_processed)]));

  return rows.map((row) => ({
    ...row,
    metrics: {
      connections: connectionsByChatbot.get(row.id) || 0,
      totalNodes: nodesByFlow.get(row.active_flow_id) || 0,
      totalEdges: edgesByFlow.get(row.active_flow_id) || 0,
      messagesProcessed: messagesByChatbot.get(row.id) || 0,
    },
  }));
}

exports.list = async (organizationId, { status, type } = {}) => {
  const q = db(TABLE).select('*').where({ organization_id: organizationId }).orderBy('created_at', 'desc');
  if (status === 'active') q.andWhere({ is_active: true });
  if (status === 'inactive') q.andWhere({ is_active: false });
  if (type) q.andWhere({ type });
  const rows = await q;
  return attachMetrics(organizationId, await ensureActiveFlows(rows));
};

exports.findById = async (organizationId, id) => {
  const row = await db(TABLE).select('*').where({ organization_id: organizationId, id }).first();
  if (!row) return null;
  const [withMetrics] = await attachMetrics(organizationId, await ensureActiveFlows([row]));
  return withMetrics;
};

// Cria o chatbot ja com um flow draft vazio (so com node trigger) e o promove
// como activeFlowId — sem isso o editor cai em "sem fluxo ativo" assim que o
// usuario entra. Tudo numa transacao: ou tudo certo, ou nada.
exports.create = async (organizationId, userId, data) => {
  return db.transaction(async (trx) => {
    const [chatbot] = await trx(TABLE)
      .insert({
        organization_id: organizationId,
        created_by: userId || null,
        name: data.name,
        description: data.description || '',
        type: data.type,
      })
      .returning('*');

    const flow = await createInitialFlowForChatbot(trx, chatbot.id);

    const [updated] = await trx(TABLE)
      .where({ id: chatbot.id })
      .update({ active_flow_id: flow.id, updated_at: trx.fn.now() })
      .returning('*');

    return updated;
  });
};

exports.update = async (organizationId, id, patch) => {
  const [row] = await db(TABLE)
    .where({ organization_id: organizationId, id })
    .update({ ...patch, updated_at: db.fn.now() })
    .returning('*');
  return row;
};

exports.remove = async (organizationId, id) => {
  const n = await db(TABLE).where({ organization_id: organizationId, id }).del();
  return n > 0;
};

// Duplica o chatbot E todo o seu flow ativo (nodes + edges com IDs remapeados).
// Sem o clone do flow a copia caia em "sem fluxo ativo" no editor — mesma classe
// de bug do B-03. Tudo em transacao: se algum passo falha, nada e gravado.
exports.duplicate = async (organizationId, userId, id) => {
  return db.transaction(async (trx) => {
    let original = await trx(TABLE)
      .where({ organization_id: organizationId, id })
      .first();
    if (!original) return null;
    original = await ensureActiveFlowForChatbot(trx, original);

    const [chatbot] = await trx(TABLE)
      .insert({
        organization_id: organizationId,
        created_by: userId || null,
        name: `${original.name} (copia)`,
        description: original.description,
        type: original.type,
        ai_config: original.ai_config,
      })
      .returning('*');

    if (!original.active_flow_id) return chatbot;

    const originalFlow = await trx('flows')
      .where({ id: original.active_flow_id })
      .first();
    if (!originalFlow) return chatbot;

    const [newFlow] = await trx('flows')
      .insert({
        chatbot_id: chatbot.id,
        name: originalFlow.name,
        status: 'draft',
        version: 1,
      })
      .returning('*');

    const originalNodes = await trx('flow_nodes')
      .where({ flow_id: originalFlow.id })
      .orderBy('created_at', 'asc');

    if (originalNodes.length > 0) {
      const idMap = {};
      const nodePayloads = originalNodes.map((n) => {
        const newId = crypto.randomUUID();
        idMap[n.id] = newId;
        return {
          id: newId,
          flow_id: newFlow.id,
          type: n.type,
          data: n.data,
          position_x: n.position_x,
          position_y: n.position_y,
        };
      });
      await trx('flow_nodes').insert(nodePayloads);

      const originalEdges = await trx('flow_edges').where({ flow_id: originalFlow.id });
      if (originalEdges.length > 0) {
        const edgePayloads = originalEdges.map((e) => ({
          flow_id: newFlow.id,
          source_node_id: idMap[e.source_node_id],
          target_node_id: idMap[e.target_node_id],
          source_handle: e.source_handle,
          condition_type: e.condition_type,
          condition_value: e.condition_value,
        }));
        await trx('flow_edges').insert(edgePayloads);
      }
    }

    const [updated] = await trx(TABLE)
      .where({ id: chatbot.id })
      .update({ active_flow_id: newFlow.id, updated_at: trx.fn.now() })
      .returning('*');

    return updated;
  });
};

exports.activate = async (organizationId, id) => {
  const [row] = await db(TABLE)
    .where({ organization_id: organizationId, id })
    .update({ is_active: true, updated_at: db.fn.now() })
    .returning('*');
  return row;
};

exports.deactivate = async (organizationId, id) => {
  const [row] = await db(TABLE)
    .where({ organization_id: organizationId, id })
    .update({ is_active: false, updated_at: db.fn.now() })
    .returning('*');
  return row;
};

exports.aiGenerate = async (organizationId, userId, { name, description, prompt }) => {
  const suggestion = await aiService.generateInitialFlow({
    organizationId,
    chatbotName: name,
    description,
    prompt,
  });

  const chatbot = await exports.create(organizationId, userId, {
    name,
    description,
    type: 'ai_generated',
  });

  await flowService.replaceGraph(chatbot.active_flow_id, {
    states: suggestion.states,
    edges: suggestion.edges,
  });

  const [freshChatbot, flow] = await Promise.all([
    exports.findById(organizationId, chatbot.id),
    flowService.getFlowWithGraph(chatbot.active_flow_id),
  ]);

  const mappedFlow = mapFlowGraphForClient(flow);

  return {
    chatbot: mapChatbot(freshChatbot),
    flow: mappedFlow.flow,
    nodes: mappedFlow.nodes,
    edges: mappedFlow.edges,
  };
};

exports.aiAdjust = async (organizationId, chatbotId, { instruction }) => {
  const chatbot = await exports.findById(organizationId, chatbotId);
  if (!chatbot) return null;
  if (!chatbot.active_flow_id) return null;

  const flow = await flowService.getFlowWithGraph(chatbot.active_flow_id);
  const suggestion = await aiService.adjustExistingFlow({
    organizationId,
    chatbotId,
    chatbotName: chatbot.name,
    instruction,
    flow,
  });

  const previewFlow = {
    id: flow.id,
    chatbot_id: flow.chatbot_id,
    name: flow.name,
    status: flow.status,
    version: flow.version,
    created_at: flow.created_at,
    updated_at: flow.updated_at,
    states: suggestion.states.map((state) => ({
      id: state.id,
      flow_id: flow.id,
      type: state.type,
      data: state.data || {},
      position_x: state.position_x ?? 0,
      position_y: state.position_y ?? 0,
    })),
    edges: suggestion.edges.map((edge, index) => ({
      id: edge.id || `edge_preview_${index + 1}`,
      flow_id: flow.id,
      source_node_id: edge.from,
      target_node_id: edge.to,
      source_handle: edge.source_handle ?? null,
      condition_type: edge.condition?.operator ?? null,
      condition_value: edge.condition?.value != null ? String(edge.condition.value) : null,
    })),
  };

  const mapped = mapFlowGraphForClient(previewFlow);
  return {
    nodes: mapped.nodes,
    edges: mapped.edges,
  };
};

// Mantem os helpers antigos do model para quem ainda os chamar fora do controller.
exports._model = Chatbot;
