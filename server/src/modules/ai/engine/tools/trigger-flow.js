// server/src/modules/ai/engine/tools/trigger-flow.js
//
// Tool `trigger_flow`: sinaliza handoff para um fluxo tradicional (FlowEngine).
// Decisão terminal — encerra o loop tool-use. Nesta fase (F3.4) o engine apenas
// resolve o flowId e devolve a decisão; o handoff real (dirigir o FlowEngine e
// enviar via Evolution) é a F3.5 (fallback.bridge + webhook). Não toca o banco.

const definition = {
  name: 'trigger_flow',
  description:
    'Encaminha a conversa para um fluxo tradicional (determinístico) quando a tarefa exige ' +
    'passos estruturados que o agente não deve conduzir livremente.',
  parameters: {
    type: 'object',
    properties: {
      flowId: {
        type: 'string',
        description: 'ID do fluxo a disparar. Opcional — default é o fallbackFlowId do chatbot.',
      },
      startNodeId: {
        type: 'string',
        description: 'Nó inicial opcional dentro do fluxo.',
      },
    },
    required: [],
  },
};

async function execute(args, ctx) {
  const { aiConfig } = ctx;

  const flowId =
    typeof args?.flowId === 'string' && args.flowId.trim()
      ? args.flowId.trim()
      : aiConfig?.fallbackFlowId || null;

  const startNodeId =
    typeof args?.startNodeId === 'string' && args.startNodeId.trim()
      ? args.startNodeId.trim()
      : null;

  return {
    result: {
      flowId,
      startNodeId,
      note: flowId ? 'fallback sinalizado' : 'nenhum fallbackFlowId configurado',
    },
    decision: flowId ? 'fallback_flow' : undefined,
  };
}

module.exports = { definition, execute };
