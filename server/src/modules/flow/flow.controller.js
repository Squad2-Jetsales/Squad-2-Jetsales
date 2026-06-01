const db = require('../../database');
const flowService = require('./flow.service');
const { assertFlowOwned } = require('./flow.guards');

// Confere que o chatbot referenciado é da org do request. Devolve a linha
// (útil para alguns handlers) ou null. Igual aos guards de flow — 404 para
// evitar enumeração entre orgs.
async function assertChatbotOwned(chatbotId, organizationId) {
  if (!chatbotId) return null;
  return db('chatbots')
    .where({ id: chatbotId, organization_id: organizationId })
    .first();
}

class FlowController {
  // POST /api/flows
  async createFlow(req, res) {
    try {
      const { name, description, states, edges } = req.body;
      const chatbotId = req.body.chatbotId || req.body.chatbot_id;

      if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Nome do fluxo é obrigatório' });
      }
      if (!chatbotId) {
        return res.status(400).json({ error: 'chatbotId é obrigatório' });
      }

      const chatbot = await assertChatbotOwned(chatbotId, req.auth.organizationId);
      if (!chatbot) {
        return res.status(404).json({ error: 'Chatbot não encontrado', code: 'NOT_FOUND' });
      }

      const validation = flowService.validateFlow({
        name,
        states: states || [],
        edges: edges || [],
      });

      if (!validation.valid) {
        return res.status(400).json({ error: 'Fluxo inválido', details: validation.errors });
      }

      const flow = await flowService.createFlow({ name, description, chatbotId, states, edges });
      res.status(201).json({ success: true, data: flow });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // GET /api/flows
  async listFlows(req, res) {
    try {
      const { chatbotId } = req.query;
      if (chatbotId) {
        const chatbot = await assertChatbotOwned(chatbotId, req.auth.organizationId);
        if (!chatbot) {
          return res.status(404).json({ error: 'Chatbot não encontrado', code: 'NOT_FOUND' });
        }
      }
      // Sem chatbotId vamos restringir à org via JOIN — caso contrário um
      // operador lista flows de outras organizações.
      const flows = chatbotId
        ? await flowService.listFlows({ chatbotId })
        : await db('flows')
            .join('chatbots', 'chatbots.id', 'flows.chatbot_id')
            .where('chatbots.organization_id', req.auth.organizationId)
            .select('flows.*')
            .orderBy('flows.created_at', 'desc');

      res.json({ success: true, data: flows, count: flows.length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // GET /api/flows/:flowId
  async getFlow(req, res) {
    try {
      await assertFlowOwned(db, req.params.flowId, req.auth.organizationId);
      const flow = await flowService.getFlowWithGraph(req.params.flowId);
      res.json({ success: true, data: flow });
    } catch (error) {
      res.status(error.status || 404).json({ error: error.message, code: error.code });
    }
  }

  // PUT /api/flows/:flowId
  async updateFlow(req, res) {
    try {
      await assertFlowOwned(db, req.params.flowId, req.auth.organizationId);
      const { name, description, status, chatbotId } = req.body;
      const flow = await flowService.updateFlow(req.params.flowId, {
        name, description, status, chatbot_id: chatbotId,
      });
      res.json({ success: true, data: flow });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message, code: error.code });
    }
  }

  // PUT /api/flows/:flowId/graph — substitui nodes + edges inteiros
  async replaceGraph(req, res) {
    try {
      await assertFlowOwned(db, req.params.flowId, req.auth.organizationId);
      const { states, edges } = req.body;

      const validation = flowService.validateFlow({
        name: 'graph-replace',
        states: states || [],
        edges: edges || [],
      });

      if (!validation.valid) {
        return res.status(400).json({ error: 'Grafo inválido', details: validation.errors });
      }

      const flow = await flowService.replaceGraph(req.params.flowId, { states, edges });
      res.json({ success: true, data: flow });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message, code: error.code });
    }
  }

  // POST /api/flows/:flowId/publish
  async publishFlow(req, res) {
    try {
      await assertFlowOwned(db, req.params.flowId, req.auth.organizationId);
      const flow = await flowService.publishFlow(req.params.flowId);
      res.json({ success: true, data: flow });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message, code: error.code });
    }
  }

  // DELETE /api/flows/:flowId
  async deleteFlow(req, res) {
    try {
      await assertFlowOwned(db, req.params.flowId, req.auth.organizationId);
      await flowService.deleteFlow(req.params.flowId);
      res.json({ success: true, message: 'Fluxo deletado com sucesso' });
    } catch (error) {
      res.status(error.status || 404).json({ error: error.message, code: error.code });
    }
  }

  // POST /api/flows/validate
  async validateFlow(req, res) {
    try {
      const { name, states, edges } = req.body;
      const validation = flowService.validateFlow({ name, states, edges });
      res.json({ success: true, data: validation });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // ── Sessões ──────────────────────────────────────

  // POST /api/flows/:flowId/sessions
  async startSession(req, res) {
    try {
      await assertFlowOwned(db, req.params.flowId, req.auth.organizationId);
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: 'ID do usuário é obrigatório' });

      const session = await flowService.startFlowSession(
        req.auth.organizationId,
        req.params.flowId,
        userId,
      );
      res.status(201).json({ success: true, data: session });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message, code: error.code });
    }
  }

  // POST /api/flows/sessions/:sessionId/input
  // Sem assertFlowOwned aqui: o guard da sessão é feito dentro do service via
  // getOwnedSession (compara session.organizationId). Sessão de outra org
  // resulta em 404 — mesma resposta de sessionId inexistente, sem vazar
  // existência cross-tenant (B-14, B-11 sessões).
  async processInput(req, res) {
    try {
      const { input } = req.body;
      if (input === undefined || input === null) {
        return res.status(400).json({ error: 'Input do usuário é obrigatório' });
      }
      const result = await flowService.processFlowInput(
        req.auth.organizationId,
        req.params.sessionId,
        input,
      );
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message, code: error.code });
    }
  }

  // GET /api/flows/sessions/:sessionId
  async getSession(req, res) {
    try {
      const session = await flowService.getFlowSession(
        req.auth.organizationId,
        req.params.sessionId,
      );
      res.json({ success: true, data: session });
    } catch (error) {
      res.status(error.status || 404).json({ error: error.message, code: error.code });
    }
  }

  // GET /api/flows/sessions/:sessionId/stats
  async getSessionStats(req, res) {
    try {
      const stats = await flowService.getSessionStats(
        req.auth.organizationId,
        req.params.sessionId,
      );
      res.json({ success: true, data: stats });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message, code: error.code });
    }
  }

  // POST /api/flows/sessions/:sessionId/end
  async endSession(req, res) {
    try {
      const session = await flowService.endFlowSession(
        req.auth.organizationId,
        req.params.sessionId,
      );
      res.json({ success: true, data: session });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message, code: error.code });
    }
  }
}

module.exports = new FlowController();
