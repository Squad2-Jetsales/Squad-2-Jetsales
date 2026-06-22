// server/src/modules/flow/flow.guards.js
//
// Tenancy guards para o módulo flow. Cada mutation/leitura DB começa
// chamando o guard apropriado — se o registro não existe OU não pertence
// à organização do request, lança 404 (intencionalmente igual a "não
// existe", para evitar enumeração).

const { httpError } = require('../../middlewares/error.middleware');

/**
 * Garante que o flow pertence à org do request.
 * Devolve a linha do flow para evitar SELECT duplicado no caller.
 */
async function assertFlowOwned(trxOrDb, flowId, organizationId) {
  const row = await trxOrDb('flows')
    .join('chatbots', 'chatbots.id', 'flows.chatbot_id')
    .where('flows.id', flowId)
    .andWhere('chatbots.organization_id', organizationId)
    .select('flows.*')
    .first();
  if (!row) throw httpError(404, 'Flow not found', 'NOT_FOUND');
  return row;
}

/**
 * Garante que o node pertence à org do request via JOIN flows -> chatbots.
 * Devolve a linha do node.
 */
async function assertNodeOwned(trxOrDb, nodeId, organizationId) {
  const row = await trxOrDb('flow_nodes')
    .join('flows', 'flows.id', 'flow_nodes.flow_id')
    .join('chatbots', 'chatbots.id', 'flows.chatbot_id')
    .where('flow_nodes.id', nodeId)
    .andWhere('chatbots.organization_id', organizationId)
    .select('flow_nodes.*')
    .first();
  if (!row) throw httpError(404, 'Node not found', 'NOT_FOUND');
  return row;
}

/**
 * Garante que o edge pertence à org do request via JOIN flows -> chatbots.
 * Devolve a linha do edge.
 */
async function assertEdgeOwned(trxOrDb, edgeId, organizationId) {
  const row = await trxOrDb('flow_edges')
    .join('flows', 'flows.id', 'flow_edges.flow_id')
    .join('chatbots', 'chatbots.id', 'flows.chatbot_id')
    .where('flow_edges.id', edgeId)
    .andWhere('chatbots.organization_id', organizationId)
    .select('flow_edges.*')
    .first();
  if (!row) throw httpError(404, 'Edge not found', 'NOT_FOUND');
  return row;
}

module.exports = { assertFlowOwned, assertNodeOwned, assertEdgeOwned };
