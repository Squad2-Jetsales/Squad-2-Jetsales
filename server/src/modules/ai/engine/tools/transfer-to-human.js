// server/src/modules/ai/engine/tools/transfer-to-human.js
//
// Tool `transfer_to_human`: abre um ticket e coloca a conversa em espera quando
// o agente não pode resolver ou o contato pede um humano. Decisão terminal —
// encerra o loop tool-use. Multi-tenant: filtra por { id, organization_id }.
// (A tabela `tickets` não tem coluna de motivo; o `reason` fica no trace.)

const db = require('../../../../database');

const definition = {
  name: 'transfer_to_human',
  description:
    'Transfere o atendimento para um atendente humano quando o agente não pode resolver ' +
    'ou o contato pede explicitamente. Cria um ticket e coloca a conversa em espera.',
  parameters: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'Motivo resumido da transferência.' },
    },
    required: ['reason'],
  },
};

async function execute(args, ctx) {
  const { conversation, organizationId } = ctx;
  const reason = typeof args?.reason === 'string' ? args.reason.trim() : '';

  const ticketId = await db.transaction(async (trx) => {
    const conv = await trx('conversations')
      .where({ id: conversation.id, organization_id: organizationId })
      .first();
    if (!conv) return null;

    const [ticket] = await trx('tickets')
      .insert({
        organization_id: organizationId,
        conversation_id: conversation.id,
        status: 'open',
        priority: 'medium',
      })
      .returning(['id']);

    await trx('conversations')
      .where({ id: conversation.id, organization_id: organizationId })
      .update({ status: 'waiting', updated_at: trx.fn.now() });

    return ticket.id;
  });

  if (ticketId) conversation.status = 'waiting';

  return {
    result: { transferred: Boolean(ticketId), ticketId, reason },
    decision: ticketId ? 'transferred_human' : undefined,
  };
}

module.exports = { definition, execute };
