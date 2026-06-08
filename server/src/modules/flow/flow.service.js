const db = require('../../database');
const { FlowEngine } = require('./flow.engine');
const FlowModel = require('./flow.model');
const { httpError } = require('../../middlewares/error.middleware');
const {
  getEdgeSource,
  getEdgeTarget,
  sanitizeFlowGraph,
  validateFlowGraph,
} = require('./flow.graph');
const { ensureActiveFlowForChatbot } = require('../chatbot/active-flow.helper');

// Map global: sessionId → session. Cada session carrega organizationId
// para evitar que org A leia/escreva sessão criada por org B (B-14).
const flowSessions = new Map();

// 404 igual a "não existe" também quando a sessão pertence a outra org —
// evita enumeração entre tenants. Caller passa sempre o organizationId do
// req.auth, nunca do payload.
function getOwnedSession(organizationId, sessionId) {
  const session = flowSessions.get(sessionId);
  if (!session || session.organizationId !== organizationId) {
    throw httpError(404, 'Sessão não encontrada', 'NOT_FOUND');
  }
  return session;
}

const NODE_TYPE_TO_DB = {
  message:     'message',
  input:       'capture',
  capture:     'capture',
  choice:      'menu',
  menu:        'menu',
  api:         'integration',
  integration: 'integration',
  condition:   'condition',
  wait:        'wait',
  trigger:     'trigger',
  end:         'end',
};

const DB_TYPE_TO_ENGINE = {
  capture:     'input',
  menu:        'choice',
  integration: 'api',
  message:     'message',
  condition:   'condition',
  wait:        'wait',
  trigger:     'trigger',
  end:         'end',
};

const toDbType     = (type) => NODE_TYPE_TO_DB[type]    || type;
const toEngineType = (type) => DB_TYPE_TO_ENGINE[type]  || type;

function normalizeEdgeCondition(edge) {
  if (edge?.condition && edge.condition.operator && edge.condition.value != null) {
    return edge.condition;
  }

  const operator =
    edge?.conditionType ??
    edge?.condition_type ??
    null;

  const value =
    edge?.conditionValue ??
    edge?.condition_value ??
    null;

  if (!operator || value == null) return null;
  return { operator, value };
}

function buildConditionEvaluator(rawCondition) {
  if (!rawCondition || !rawCondition.operator) return null;

  const operator = String(rawCondition.operator).trim().toLowerCase();
  const value = rawCondition.value;

  return (input) => {
    if (input == null) return false;

    const normalizedInput = String(input).trim().toLowerCase();
    const normalizedValue = String(value).trim().toLowerCase();

    switch (operator) {
      case '==':
      case 'equals':
        return normalizedInput === normalizedValue;
      case '!=':
      case 'not_equals':
        return normalizedInput !== normalizedValue;
      case 'contains':
        return normalizedInput.includes(normalizedValue);
      case '>':
      case 'gt':
        return Number(input) > Number(value);
      case '<':
      case 'lt':
        return Number(input) < Number(value);
      default:
        return normalizedInput.includes(normalizedValue);
    }
  };
}

function getStateLabel(state) {
  return state?.label || state?.data?.label || state?.id;
}

function getStateDataValue(state, key, fallback = null) {
  return state?.[key] ?? state?.data?.[key] ?? fallback;
}

function mapInsertedNodeRefs(nodeIdMap, sourceState, insertedNode) {
  const refs = [
    sourceState?.id,
    sourceState?.label,
    sourceState?.data?.label,
    insertedNode?.data?.label,
  ].filter(Boolean);

  for (const ref of refs) {
    nodeIdMap[ref] = insertedNode.id;
  }
}

class FlowService {

  async createFlow(flowData) {
    const validation = validateFlowGraph(
      {
        name: flowData.name,
        states: flowData.states || [],
        edges: flowData.edges || [],
      },
      { requireName: true },
    );
    if (!validation.valid) {
      throw httpError(400, validation.errors[0] || 'Fluxo invalido', 'INVALID_FLOW', {
        details: validation.errors.join('\n'),
      });
    }

    return await db.transaction(async (trx) => {
      const [flow] = await trx('flows')
        .insert({
          chatbot_id: flowData.chatbotId || flowData.chatbot_id || null,
          name:       flowData.name,
          version:    flowData.version || 1,
          ...(flowData.status ? { status: flowData.status } : {}),
        })
        .returning('*');

      const states     = validation.sanitized.states;
      const edges      = validation.sanitized.edges;
      const nodeIdMap  = {};
      let insertedNodes = [];   // declarado fora do if para ficar no escopo do return

      if (states.length > 0) {
        const nodePayloads = states.map((s) => ({
          flow_id:    flow.id,
          type:       toDbType(s.type),
          data: {
            label:    getStateLabel(s),
            message:  getStateDataValue(s, 'message', getStateDataValue(s, 'text')) || null,
            variable: getStateDataValue(s, 'variable') || null,
            options:  getStateDataValue(s, 'options') || null,
            url:      getStateDataValue(s, 'url') || null,
            saveAs:   getStateDataValue(s, 'saveAs') || null,
            key:      getStateDataValue(s, 'key') || null,
            value:    getStateDataValue(s, 'value') || null,
            condition:getStateDataValue(s, 'condition') || null,
            delay:    getStateDataValue(s, 'delay', 0) || 0,
          },
          position_x: s.position_x ?? 0,
          position_y: s.position_y ?? 0,
        }));

        insertedNodes = await trx('flow_nodes').insert(nodePayloads).returning('*');
        insertedNodes.forEach((n, index) => {
          mapInsertedNodeRefs(nodeIdMap, states[index], n);
        });
      }

      if (edges.length > 0) {
        const edgePayloads = edges.map((e) => ({
          flow_id:         flow.id,
          source_node_id:  nodeIdMap[getEdgeSource(e)] || getEdgeSource(e),
          target_node_id:  nodeIdMap[getEdgeTarget(e)] || getEdgeTarget(e),
          source_handle:   e.source_handle   || null,
          condition_type:  e.condition?.operator || null,
          condition_value: e.condition?.value != null ? String(e.condition.value) : null,
        }));
        await trx('flow_edges').insert(edgePayloads);
      }

      // lê dentro da trx para não depender do commit
      const insertedEdges = await trx('flow_edges').where({ flow_id: flow.id });
      return { ...flow, states: insertedNodes, edges: insertedEdges };
    });
  }

  async getFlow(flowId) {
    const flow = await FlowModel.findOne(flowId);
    if (!flow) throw new Error(`Fluxo com ID ${flowId} não encontrado`);
    return flow;
  }

  async getFlowWithGraph(flowId) {
    const flow = await FlowModel.findWithGraph(flowId);
    if (!flow) throw new Error(`Fluxo com ID ${flowId} não encontrado`);
    return flow;
  }

  async listFlows({ chatbotId } = {}) {
    return await FlowModel.findAll({ chatbotId });
  }

  async updateFlow(flowId, updates) {
    await this.getFlow(flowId);
    return await FlowModel.update(flowId, updates);
  }

  async replaceGraph(flowId, { states = [], edges = [] }) {
    await this.getFlow(flowId);
    if (!Array.isArray(states) || !Array.isArray(edges)) {
      throw httpError(400, 'States e edges devem ser arrays.', 'INVALID_FLOW');
    }

    const sanitized = sanitizeFlowGraph({ states, edges });
    if (sanitized.states.length === 0) {
      throw httpError(400, 'Fluxo deve ter pelo menos um estado.', 'INVALID_FLOW');
    }

    return await db.transaction(async (trx) => {
      await trx('flow_edges').where({ flow_id: flowId }).del();
      await trx('flow_nodes').where({ flow_id: flowId }).del();

      const nodeIdMap   = {};
      let insertedNodes = [];   // declarado fora do if

      if (sanitized.states.length > 0) {
        const nodePayloads = sanitized.states.map((s) => ({
          flow_id:    flowId,
          type:       toDbType(s.type),
          data: {
            label:    getStateLabel(s),
            message:  getStateDataValue(s, 'message', getStateDataValue(s, 'text')) || null,
            variable: getStateDataValue(s, 'variable') || null,
            options:  getStateDataValue(s, 'options') || null,
            url:      getStateDataValue(s, 'url') || null,
            saveAs:   getStateDataValue(s, 'saveAs') || null,
            key:      getStateDataValue(s, 'key') || null,
            value:    getStateDataValue(s, 'value') || null,
            condition:getStateDataValue(s, 'condition') || null,
            delay:    getStateDataValue(s, 'delay', 0) || 0,
          },
          position_x: s.position_x ?? 0,
          position_y: s.position_y ?? 0,
        }));

        insertedNodes = await trx('flow_nodes').insert(nodePayloads).returning('*');
        insertedNodes.forEach((n, index) => {
          mapInsertedNodeRefs(nodeIdMap, sanitized.states[index], n);
        });
      }

      if (sanitized.edges.length > 0) {
        const edgePayloads = sanitized.edges.map((e) => ({
          flow_id:         flowId,
          source_node_id:  nodeIdMap[getEdgeSource(e)] || getEdgeSource(e),
          target_node_id:  nodeIdMap[getEdgeTarget(e)] || getEdgeTarget(e),
          source_handle:   e.source_handle   || null,
          condition_type:  e.condition?.operator || null,
          condition_value: e.condition?.value != null ? String(e.condition.value) : null,
        }));
        await trx('flow_edges').insert(edgePayloads);
      }

      await trx('flows').where({ id: flowId }).update({ updated_at: db.fn.now() });
      const updatedFlow   = await trx('flows').where({ id: flowId }).first();
      const insertedEdges = await trx('flow_edges').where({ flow_id: flowId });
      return { ...updatedFlow, states: insertedNodes, edges: insertedEdges, warnings: sanitized.warnings };
    });
  }

  // Publica = status 'published' + promove o flow como activeFlowId do
  // chatbot dono. Sem o segundo passo, a UI publicava mas o bot continuava
  // apontando para outro draft (ou nulo, no caso de bot recém-criado).
  async publishFlow(flowId) {
    const flow = await this.getFlowWithGraph(flowId);
    const validation = validateFlowGraph(
      {
        name: flow.name,
        states: flow.states || [],
        edges: flow.edges || [],
      },
      {
        requireName: true,
        requireTrigger: true,
        requireOutgoing: true,
        validateContent: true,
      },
    );
    if (!validation.valid) {
      throw httpError(400, validation.errors[0] || 'Fluxo invalido para publicacao.', 'INVALID_FLOW', {
        details: validation.errors.join('\n'),
      });
    }

    return db.transaction(async (trx) => {
      const [published] = await trx('flows')
        .where({ id: flowId })
        .update({ status: 'published', updated_at: trx.fn.now() })
        .returning('*');

      if (flow.chatbot_id) {
        await trx('chatbots')
          .where({ id: flow.chatbot_id })
          .update({ active_flow_id: flowId, updated_at: trx.fn.now() });
      }

      return published;
    });
  }

  async deleteFlow(flowId) {
    await this.getFlow(flowId);
    await FlowModel.remove(flowId);
    return true;
  }

  // ── Sessões ──────────────────────────────────
  //
  // Todos os métodos abaixo recebem organizationId como primeiro parâmetro.
  // O controller passa req.auth.organizationId (nunca do payload do user).
  // Sessão criada por org A é invisível para org B: getOwnedSession lança
  // 404 quando o organizationId não bate (B-14, B-11 sessões).

  async startFlowSession(organizationId, flowId, userId) {
    const flow        = await this.getFlowWithGraph(flowId);
    const engineFlow  = this._toEngineFormat(flow);
    const startNodeId = (engineFlow.states.find((state) => state.type === 'trigger') || engineFlow.states[0])?.id;
    if (!startNodeId) throw new Error('Fluxo não tem nenhum node');

    const sessionId = this._generateId();
    const engine    = new FlowEngine(engineFlow);
    const result    = await engine.run({
      currentNodeId: startNodeId,
      data:    null,
      context: { userId, sessionId },
    });

    const session = {
      id:             sessionId,
      organizationId,
      flowId,
      userId,
      currentNodeId:  result.nextNodeId,
      context:        result.context,
      startedAt:      new Date(),
      messages:       result.responses || [],
    };
    flowSessions.set(sessionId, session);
    return { sessionId, responses: result.responses, context: result.context };
  }

  async processFlowInput(organizationId, sessionId, userInput) {
    const session = getOwnedSession(organizationId, sessionId);

    const flow       = await this.getFlowWithGraph(session.flowId);
    const engineFlow = this._toEngineFormat(flow);
    const engine     = new FlowEngine(engineFlow);

    const result = await engine.run({
      currentNodeId: session.currentNodeId,
      data:    userInput,
      context: session.context,
    });

    session.currentNodeId = result.nextNodeId;
    session.context       = result.context;
    session.messages.push(...result.responses);
    session.updatedAt     = new Date();
    flowSessions.set(sessionId, session);

    return {
      sessionId,
      responses:  result.responses,
      context:    result.context,
      isComplete: this._isFlowComplete(engineFlow, result.nextNodeId),
    };
  }

  async getFlowSession(organizationId, sessionId) {
    return getOwnedSession(organizationId, sessionId);
  }

  async endFlowSession(organizationId, sessionId) {
    const session = getOwnedSession(organizationId, sessionId);
    session.endedAt = new Date();
    flowSessions.set(sessionId, session);
    return session;
  }

  async getSessionStats(organizationId, sessionId) {
    const session = getOwnedSession(organizationId, sessionId);
    return {
      sessionId,
      flowId:        session.flowId,
      userId:        session.userId,
      duration:      session.endedAt
        ? (session.endedAt  - session.startedAt) / 1000 + 's'
        : (new Date()       - session.startedAt) / 1000 + 's',
      messagesCount: session.messages.length,
      currentNode:   session.currentNodeId,
      startedAt:     session.startedAt,
      endedAt:       session.endedAt || null,
    };
  }

  // ── Validação ────────────────────────────────

  validateFlow(flowData) {
    return validateFlowGraph(flowData, { requireName: true });
  }

  // ── Helpers privados ─────────────────────────

  _toEngineFormat(flow) {
    const nodes = flow.states || [];

    // Monta mapa UUID → label para resolver as edges do banco
    const uuidToLabel = {};
    nodes.forEach((n) => {
      const label = n.data?.label;
      if (label) uuidToLabel[n.id] = label;
    });

    const states = nodes.map((n) => ({
      id:   n.data?.label || n.id,
      type: toEngineType(n.type),
      ...(n.data || {}),
    }));

    const engineStateIds = new Set(states.map((state) => state.id));
    const edges = (flow.edges || []).map((e) => {
      // Resolve source/target: se for UUID, converte para label
      const fromRaw = getEdgeSource(e);
      const toRaw   = getEdgeTarget(e);
      const from    = uuidToLabel[fromRaw] || fromRaw;
      const to      = uuidToLabel[toRaw]   || toRaw;

      // Converte condition objeto → função que o engine entende
      const raw = normalizeEdgeCondition(e);
      const condition = buildConditionEvaluator(raw);

      // Preserva sourceHandle para o engine decidir o caminho em Condition
      // node (handles 'true' / 'false') — sem isso o engine ignora o
      // desenho do editor (B-05).
      const sourceHandle = e.source_handle ?? e.sourceHandle ?? null;

      return { from, to, condition, sourceHandle };
    }).filter((edge) => {
      const valid = engineStateIds.has(edge.from) && engineStateIds.has(edge.to);
      if (!valid) {
        console.warn(`[flow] edge orfa ignorada no engine: ${edge.from} -> ${edge.to}`);
      }
      return valid;
    });

    return { ...flow, states, edges };
  }
















  // Boundary entre o webhook do WhatsApp e o FlowEngine. Recebe ponteiros
  // do banco (UUID do node atual, jsonb do contexto) e devolve respostas
  // prontas pra Evolution.sendText. Engine internamente usa `data.label`
  // como id, então traduzimos nos dois sentidos aqui.
  async runChatbotMessage({ chatbotId, currentNodeId, flowContext, userInput }) {
    let chatbot = await db('chatbots').where({ id: chatbotId }).first();
    if (!chatbot) return null;
    chatbot = await ensureActiveFlowForChatbot(db, chatbot);
    if (!chatbot?.active_flow_id) return null;

    const flow = await this.getFlowWithGraph(chatbot.active_flow_id);
    if (!flow?.states?.length) return null;

    const engineFlow = this._toEngineFormat(flow);

    const labelToUuid = {};
    const uuidToLabel = {};
    for (const n of flow.states) {
      const label = n.data?.label;
      if (label) {
        labelToUuid[label] = n.id;
        uuidToLabel[n.id] = label;
      }
    }

    let startEngineId;
    if (currentNodeId && uuidToLabel[currentNodeId]) {
      startEngineId = uuidToLabel[currentNodeId];
    } else {
      const trigger = engineFlow.states.find((s) => s.type === 'trigger') || engineFlow.states[0];
      startEngineId = trigger?.id;
    }
    if (!startEngineId) return null;

    const engine = new FlowEngine(engineFlow);
    const result = await engine.run({
      currentNodeId: startEngineId,
      data: userInput ?? null,
      context: { ...(flowContext || {}) },
    });

    const nextEngineId = result.nextNodeId;
    const nextNodeUuid = labelToUuid[nextEngineId]
      || (uuidToLabel[nextEngineId] ? nextEngineId : null);

    return {
      responses: (result.responses || [])
        .filter((r) => r.message && String(r.message).trim().length > 0),
      nextNodeUuid,
      context: result.context || {},
      isComplete: this._isFlowComplete(engineFlow, nextEngineId),
    };
  }

  _isFlowComplete(flow, nodeId) {
    const node = flow.states.find((s) => s.id === nodeId);
    return node?.type === 'end' || !node;
  }

  _generateId() {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = new FlowService();
