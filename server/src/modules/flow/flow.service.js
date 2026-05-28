const db = require('../../database');
const { FlowEngine } = require('./flow.engine');
const FlowModel = require('./flow.model');

const flowSessions = new Map();

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

class FlowService {

  async createFlow(flowData) {
    return await db.transaction(async (trx) => {
      const [flow] = await trx('flows')
        .insert({
          chatbot_id: flowData.chatbotId || flowData.chatbot_id || null,
          name:       flowData.name,
          version:    flowData.version || 1,
          ...(flowData.status ? { status: flowData.status } : {}),
        })
        .returning('*');

      const states     = flowData.states || [];
      const edges      = flowData.edges  || [];
      const nodeIdMap  = {};
      let insertedNodes = [];   // declarado fora do if para ficar no escopo do return

      if (states.length > 0) {
        const nodePayloads = states.map((s) => ({
          flow_id:    flow.id,
          type:       toDbType(s.type),
          data: {
            label:    s.id,
            message:  s.message   || null,
            variable: s.variable  || null,
            options:  s.options   || null,
            url:      s.url       || null,
            saveAs:   s.saveAs    || null,
            key:      s.key       || null,
            value:    s.value     || null,
            condition:s.condition || null,
            delay:    s.delay     || 0,
          },
          position_x: s.position_x ?? 0,
          position_y: s.position_y ?? 0,
        }));

        insertedNodes = await trx('flow_nodes').insert(nodePayloads).returning('*');
        insertedNodes.forEach((n) => {
          if (n.data?.label) nodeIdMap[n.data.label] = n.id;
        });
      }

      if (edges.length > 0) {
        const edgePayloads = edges.map((e) => ({
          flow_id:         flow.id,
          source_node_id:  nodeIdMap[e.from] || e.from,
          target_node_id:  nodeIdMap[e.to]   || e.to,
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

    return await db.transaction(async (trx) => {
      await trx('flow_edges').where({ flow_id: flowId }).del();
      await trx('flow_nodes').where({ flow_id: flowId }).del();

      const nodeIdMap   = {};
      let insertedNodes = [];   // declarado fora do if

      if (states.length > 0) {
        const nodePayloads = states.map((s) => ({
          flow_id:    flowId,
          type:       toDbType(s.type),
          data: {
            label:    s.id,
            message:  s.message   || null,
            variable: s.variable  || null,
            options:  s.options   || null,
            url:      s.url       || null,
            saveAs:   s.saveAs    || null,
            key:      s.key       || null,
            value:    s.value     || null,
            condition:s.condition || null,
            delay:    s.delay     || 0,
          },
          position_x: s.position_x ?? 0,
          position_y: s.position_y ?? 0,
        }));

        insertedNodes = await trx('flow_nodes').insert(nodePayloads).returning('*');
        insertedNodes.forEach((n) => {
          if (n.data?.label) nodeIdMap[n.data.label] = n.id;
        });
      }

      if (edges.length > 0) {
        const edgePayloads = edges.map((e) => ({
          flow_id:         flowId,
          source_node_id:  nodeIdMap[e.from] || e.from,
          target_node_id:  nodeIdMap[e.to]   || e.to,
          source_handle:   e.source_handle   || null,
          condition_type:  e.condition?.operator || null,
          condition_value: e.condition?.value != null ? String(e.condition.value) : null,
        }));
        await trx('flow_edges').insert(edgePayloads);
      }

      await trx('flows').where({ id: flowId }).update({ updated_at: db.fn.now() });
      const updatedFlow   = await trx('flows').where({ id: flowId }).first();
      const insertedEdges = await trx('flow_edges').where({ flow_id: flowId });
      return { ...updatedFlow, states: insertedNodes, edges: insertedEdges };
    });
  }

  // Publica = status 'published' + promove o flow como activeFlowId do
  // chatbot dono. Sem o segundo passo, a UI publicava mas o bot continuava
  // apontando para outro draft (ou nulo, no caso de bot recém-criado).
  async publishFlow(flowId) {
    const flow = await this.getFlow(flowId);
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

  async startFlowSession(flowId, userId) {
    const flow        = await this.getFlowWithGraph(flowId);
    const engineFlow  = this._toEngineFormat(flow);
    const startNodeId = engineFlow.states[0]?.id;
    if (!startNodeId) throw new Error('Fluxo não tem nenhum node');

    const sessionId = this._generateId();
    const engine    = new FlowEngine(engineFlow);
    const result    = await engine.run({
      currentNodeId: startNodeId,
      data:    null,
      context: { userId, sessionId },
    });

    const session = {
      id:            sessionId,
      flowId,
      userId,
      currentNodeId: result.nextNodeId,
      context:       result.context,
      startedAt:     new Date(),
      messages:      result.responses || [],
    };
    flowSessions.set(sessionId, session);
    return { sessionId, responses: result.responses, context: result.context };
  }

  async processFlowInput(sessionId, userInput) {
    const session = flowSessions.get(sessionId);
    if (!session) throw new Error(`Sessão com ID ${sessionId} não encontrada`);

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

  async getFlowSession(sessionId) {
    const session = flowSessions.get(sessionId);
    if (!session) throw new Error(`Sessão com ID ${sessionId} não encontrada`);
    return session;
  }

  async endFlowSession(sessionId) {
    const session  = await this.getFlowSession(sessionId);
    session.endedAt = new Date();
    flowSessions.set(sessionId, session);
    return session;
  }

  async getSessionStats(sessionId) {
    const session = await this.getFlowSession(sessionId);
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
    const errors = [];
    if (!flowData.name || flowData.name.trim() === '')
      errors.push('Nome do fluxo é obrigatório');
    if (!Array.isArray(flowData.states) || flowData.states.length === 0)
      errors.push('Fluxo deve ter pelo menos um estado');
    if (!Array.isArray(flowData.edges))
      errors.push('Edges deve ser um array');

    const stateIds = (flowData.states || []).map((s) => s.id);
    for (const edge of flowData.edges || []) {
      if (!stateIds.includes(edge.from))
        errors.push(`Edge referencia nó inexistente: ${edge.from}`);
      if (!stateIds.includes(edge.to))
        errors.push(`Edge referencia nó inexistente: ${edge.to}`);
    }
    return { valid: errors.length === 0, errors };
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

    const edges = (flow.edges || []).map((e) => {
      // Resolve source/target: se for UUID, converte para label
      const fromRaw = e.from || e.source_node_id;
      const toRaw   = e.to   || e.target_node_id;
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
    });

    return { ...flow, states, edges };
  }
















  // Boundary entre o webhook do WhatsApp e o FlowEngine. Recebe ponteiros
  // do banco (UUID do node atual, jsonb do contexto) e devolve respostas
  // prontas pra Evolution.sendText. Engine internamente usa `data.label`
  // como id, então traduzimos nos dois sentidos aqui.
  async runChatbotMessage({ chatbotId, currentNodeId, flowContext, userInput }) {
    const chatbot = await db('chatbots').where({ id: chatbotId }).first();
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
