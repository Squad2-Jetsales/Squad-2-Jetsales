const db = require('../../database');

const TABLE = 'flows';

const normalizePayload = (data) => {
  const payload = {
    chatbot_id: data.chatbot_id || data.chatbotId || null,
    name: data.name,
    version: data.version || 1,
  };
  // status é um enum no banco — só inclui se vier explícito
  if (data.status) payload.status = data.status;
  return payload;
};

module.exports = {
  create: async (data) => {
    const payload = normalizePayload(data);
    const [flow] = await db(TABLE).insert(payload).returning('*');
    return flow;
  },

  findAll: async ({ chatbotId } = {}) => {
    const query = db(TABLE).select('*').orderBy('created_at', 'desc');
    if (chatbotId) query.where({ chatbot_id: chatbotId });
    return await query;
  },

  findOne: async (id) => {
    return await db(TABLE).where({ id }).first();
  },

  findWithGraph: async (id) => {
    const flow = await db(TABLE).where({ id }).first();
    if (!flow) return null;

    const [nodes, edges] = await Promise.all([
      db('flow_nodes').where({ flow_id: id }).orderBy('created_at', 'asc'),
      db('flow_edges').where({ flow_id: id }),
    ]);

    return { ...flow, states: nodes, edges };
  },

  update: async (id, data) => {
    // Update parcial: só inclui colunas que vieram explicitamente, pra não
    // sobrescrever chatbot_id (NOT NULL) com null quando o caller manda só name.
    const payload = {};
    if (data.name !== undefined)                                payload.name        = data.name;
    if (data.version !== undefined)                             payload.version     = data.version;
    if (data.status !== undefined)                              payload.status      = data.status;
    if (data.chatbot_id !== undefined || data.chatbotId !== undefined) {
      payload.chatbot_id = data.chatbot_id || data.chatbotId;
    }
    if (Object.keys(payload).length === 0) return await db(TABLE).where({ id }).first();
    const [flow] = await db(TABLE)
      .where({ id })
      .update({ ...payload, updated_at: db.fn.now() })
      .returning('*');
    return flow;
  },

  // Publica: muda status para 'published' (valor deve existir no enum)
  publish: async (id) => {
    const [flow] = await db(TABLE)
      .where({ id })
      .update({ status: 'published', updated_at: db.fn.now() })
      .returning('*');
    return flow;
  },

  remove: async (id) => {
    return await db(TABLE).where({ id }).del();
  },
};
