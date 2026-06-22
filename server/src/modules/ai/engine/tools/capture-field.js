// server/src/modules/ai/engine/tools/capture-field.js
//
// Tool `capture_field`: grava um dado informado pelo contato em
// conversations.flow_context, para o fluxo tradicional reaproveitar depois.
// Multi-tenant: todo acesso filtra por { id, organization_id }.

const db = require('../../../../database');

const definition = {
  name: 'capture_field',
  description:
    'Registra um dado informado pelo contato (ex.: nome, e-mail, CNPJ) no contexto ' +
    'da conversa para uso posterior pelo fluxo. Não use para conteúdo livre — só dados estruturados.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Nome do campo (ex.: "email", "nome").' },
      value: { type: 'string', description: 'Valor informado pelo contato.' },
    },
    required: ['name', 'value'],
  },
};

async function execute(args, ctx) {
  const { conversation, organizationId } = ctx;
  const name = typeof args?.name === 'string' ? args.name.trim() : '';
  const value = args?.value;

  if (!name) {
    return { result: { captured: false, reason: 'name vazio' } };
  }

  const flowContext = await db.transaction(async (trx) => {
    const row = await trx('conversations')
      .where({ id: conversation.id, organization_id: organizationId })
      .first();
    if (!row) return null;

    const next = { ...(row.flow_context || {}), [name]: value };
    await trx('conversations')
      .where({ id: conversation.id, organization_id: organizationId })
      .update({ flow_context: next, updated_at: trx.fn.now() });
    return next;
  });

  // Mantém o objeto conversation em memória coerente para tools seguintes.
  if (flowContext) conversation.flow_context = flowContext;

  return { result: { captured: Boolean(flowContext), field: name } };
}

module.exports = { definition, execute };
