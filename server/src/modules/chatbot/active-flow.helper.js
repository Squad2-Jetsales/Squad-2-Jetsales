async function createInitialFlowForChatbot(dbOrTrx, chatbotId) {
  const [flow] = await dbOrTrx('flows')
    .insert({
      chatbot_id: chatbotId,
      name: 'Fluxo inicial',
      status: 'draft',
      version: 1,
    })
    .returning('*');

  await dbOrTrx('flow_nodes').insert({
    flow_id: flow.id,
    type: 'trigger',
    data: { label: 'start' },
    position_x: 100,
    position_y: 100,
  });

  return flow;
}

async function findReusableFlow(dbOrTrx, chatbotId) {
  const published = await dbOrTrx('flows')
    .where({ chatbot_id: chatbotId, status: 'published' })
    .orderBy('updated_at', 'desc')
    .first();
  if (published) return published;

  return dbOrTrx('flows')
    .where({ chatbot_id: chatbotId })
    .orderBy('updated_at', 'desc')
    .first();
}

async function ensureActiveFlowForChatbot(dbOrTrx, chatbot) {
  if (!chatbot) return null;
  if (chatbot.active_flow_id) return chatbot;

  const flow = await findReusableFlow(dbOrTrx, chatbot.id)
    || await createInitialFlowForChatbot(dbOrTrx, chatbot.id);

  const [updated] = await dbOrTrx('chatbots')
    .where({ id: chatbot.id })
    .update({ active_flow_id: flow.id, updated_at: dbOrTrx.fn.now() })
    .returning('*');

  return updated || { ...chatbot, active_flow_id: flow.id };
}

module.exports = {
  createInitialFlowForChatbot,
  ensureActiveFlowForChatbot,
  findReusableFlow,
};
