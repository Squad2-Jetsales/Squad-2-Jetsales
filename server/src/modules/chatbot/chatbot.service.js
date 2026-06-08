// server/src/modules/chatbot/chatbot.service.js
//
// Camada de serviço de chatbots. Assinatura casa com o que
// chatbot.controller.js chama hoje:
//   - service.VALID_TYPES
//   - service.list(organizationId, { status, type })
//   - service.findById(organizationId, id)
//   - service.create(organizationId, userId, data)
//   - service.update(organizationId, id, patch)
//   - service.remove(organizationId, id) → boolean
//   - service.duplicate(organizationId, userId, id)
//   - service.activate(organizationId, id)
//   - service.deactivate(organizationId, id)
//
// Todas as queries são tenant-scoped por organization_id. O model expõe um
// CRUD agnóstico (sem org); o filtro acontece aqui.

const crypto = require('crypto');
const Chatbot = require('./chatbot.model');
const db = require('../../database');
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
  if (status === 'active')   q.andWhere({ is_active: true });
  if (status === 'inactive') q.andWhere({ is_active: false });
  if (type)                  q.andWhere({ type });
  const rows = await q;
  return attachMetrics(organizationId, await ensureActiveFlows(rows));
};

exports.findById = async (organizationId, id) =>
  {
    const row = await db(TABLE).select('*').where({ organization_id: organizationId, id }).first();
    if (!row) return null;
    const [withMetrics] = await attachMetrics(organizationId, await ensureActiveFlows([row]));
    return withMetrics;
  };

// Cria o chatbot já com um flow draft vazio (só com node trigger) e o promove
// como activeFlowId — sem isso o editor cai em "sem fluxo ativo" assim que o
// usuário entra. Tudo numa transação: ou tudo certo, ou nada.
exports.create = async (organizationId, userId, data) => {
  return db.transaction(async (trx) => {
    const [chatbot] = await trx(TABLE)
      .insert({
        organization_id: organizationId,
        created_by:      userId || null,
        name:            data.name,
        description:     data.description || '',
        type:            data.type,
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
// Sem o clone do flow a cópia caía em "sem fluxo ativo" no editor — mesma classe
// de bug do B-03. Tudo em transação: se algum passo falha, nada é gravado.
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
        created_by:      userId || null,
        name:            `${original.name} (cópia)`,
        description:     original.description,
        type:            original.type,
        ai_config:       original.ai_config,
      })
      .returning('*');

    // Sem flow ativo nada para clonar — devolve só o chatbot (raro: bots
    // legados pré-B-03). Bots criados depois do B-03 sempre têm flow.
    if (!original.active_flow_id) return chatbot;

    const originalFlow = await trx('flows')
      .where({ id: original.active_flow_id })
      .first();
    if (!originalFlow) return chatbot;

    // Cópia vira draft com version=1, independente do status original.
    // Operador pode publicar quando quiser sem afetar o bot original.
    const [newFlow] = await trx('flows')
      .insert({
        chatbot_id: chatbot.id,
        name:       originalFlow.name,
        status:     'draft',
        version:    1,
      })
      .returning('*');

    const originalNodes = await trx('flow_nodes')
      .where({ flow_id: originalFlow.id })
      .orderBy('created_at', 'asc');

    if (originalNodes.length > 0) {
      // Gera UUIDs novos pré-insert para conseguir mapear edges sem
      // precisar de RETURNING + segundo round-trip.
      const idMap = {};
      const nodePayloads = originalNodes.map((n) => {
        const newId = crypto.randomUUID();
        idMap[n.id] = newId;
        return {
          id:         newId,
          flow_id:    newFlow.id,
          type:       n.type,
          data:       n.data,
          position_x: n.position_x,
          position_y: n.position_y,
        };
      });
      await trx('flow_nodes').insert(nodePayloads);

      const originalEdges = await trx('flow_edges').where({ flow_id: originalFlow.id });
      if (originalEdges.length > 0) {
        const edgePayloads = originalEdges.map((e) => ({
          flow_id:         newFlow.id,
          source_node_id:  idMap[e.source_node_id],
          target_node_id:  idMap[e.target_node_id],
          source_handle:   e.source_handle,
          condition_type:  e.condition_type,
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

// Mantém os helpers antigos do model para quem ainda os chamar fora do controller.
exports._model = Chatbot;
