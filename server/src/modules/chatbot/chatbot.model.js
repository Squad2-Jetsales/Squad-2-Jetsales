const db = require('../../database');

const TABLE = 'chatbots';

// Normaliza dados da API para o formato de colunas do banco SQL
const normalizePayload = (data) => ({
  organization_id: data.organization_id || data.organizationId,
  active_flow_id: data.active_flow_id || data.activeFlowId,
  name: data.name,
  type: data.type,
  is_active: data.is_active ?? data.isActive ?? true,
  inactivity_timeout_ms: data.inactivity_timeout_ms ?? data.inactivityTimeoutMs,
  max_retries: data.max_retries ?? data.maxRetries,
  send_delay_ms: data.send_delay_ms ?? data.sendDelayMs,
  ai_config: data.ai_config ?? data.aiConfig,
});

module.exports = {
  // Cria um chatbot na tabela chatbots e retorna o registro criado
  create: async (data) => {
    const payload = normalizePayload(data);
    const [chatbot] = await db(TABLE).insert(payload).returning('*');
    return chatbot;
  },

  // Retorna todos os chatbots ordenados pela data de criação
  findAll: async () => {
    return await db(TABLE).select('*').orderBy('created_at', 'desc');
  },

  // Busca um chatbot pelo id
  findOne: async (id) => {
    return await db(TABLE).where({ id }).first();
  },

  // Atualiza um chatbot existente e retorna o registro atualizado
  update: async (id, data) => {
    const payload = normalizePayload(data);
    const [chatbot] = await db(TABLE)
      .where({ id })
      .update(payload)
      .returning('*');
    return chatbot;
  },

  // Remove um chatbot pelo id
  remove: async (id) => {
    return await db(TABLE).where({ id }).del();
  },
};
