// server/src/modules/chatbot/chatbot.service.js
//
// Camada de serviço de chatbots. Assinatura casa com o que
// chatbot.controller.js chama hoje:
//   - service.VALID_TYPES
//   - service.list(organizationId, { status, type })
//   - service.findById(organizationId, id)
//   - service.create(organizationId, userId, data)
//   - service.update(organizationId, id, patch)
//   - service.remove(organizationId, id) → boolean
//   - service.duplicate(organizationId, userId, id)
//   - service.activate(organizationId, id)
//   - service.deactivate(organizationId, id)
//
// Todas as queries são tenant-scoped por organization_id. O model expõe um
// CRUD agnóstico (sem org); o filtro acontece aqui.

const Chatbot = require('./chatbot.model');
const db = require('../../database');

const TABLE = 'chatbots';
const VALID_TYPES = ['manual', 'ai_generated', 'ai_agent'];

exports.VALID_TYPES = VALID_TYPES;

exports.list = async (organizationId, { status, type } = {}) => {
  const q = db(TABLE).select('*').where({ organization_id: organizationId }).orderBy('created_at', 'desc');
  if (status === 'active')   q.andWhere({ is_active: true });
  if (status === 'inactive') q.andWhere({ is_active: false });
  if (type)                  q.andWhere({ type });
  return q;
};

exports.findById = async (organizationId, id) =>
  db(TABLE).select('*').where({ organization_id: organizationId, id }).first();

// Cria o chatbot já com um flow draft vazio (só com node trigger) e o promove
// como activeFlowId — sem isso o editor cai em "sem fluxo ativo" assim que o
// usuário entra. Tudo numa transação: ou tudo certo, ou nada.
exports.create = async (organizationId, userId, data) => {
  return db.transaction(async (trx) => {
    const [chatbot] = await trx(TABLE)
      .insert({
        organization_id: organizationId,
        created_by:      userId || null,
        name:            data.name,
        description:     data.description || '',
        type:            data.type,
      })
      .returning('*');

    const [flow] = await trx('flows')
      .insert({
        chatbot_id: chatbot.id,
        name:       'Fluxo inicial',
        status:     'draft',
        version:    1,
      })
      .returning('*');

    await trx('flow_nodes').insert({
      flow_id:    flow.id,
      type:       'trigger',
      data:       { label: 'start' },
      position_x: 100,
      position_y: 100,
    });

    const [updated] = await trx(TABLE)
      .where({ id: chatbot.id })
      .update({ active_flow_id: flow.id, updated_at: trx.fn.now() })
      .returning('*');

    return updated;
  });
};

exports.update = async (organizationId, id, patch) => {
  const [row] = await db(TABLE)
    .where({ organization_id: organizationId, id })
    .update({ ...patch, updated_at: db.fn.now() })
    .returning('*');
  return row;
};

exports.remove = async (organizationId, id) => {
  const n = await db(TABLE).where({ organization_id: organizationId, id }).del();
  return n > 0;
};

exports.duplicate = async (organizationId, userId, id) => {
  const original = await exports.findById(organizationId, id);
  if (!original) return null;
  const [row] = await db(TABLE)
    .insert({
      organization_id: organizationId,
      created_by:      userId || null,
      name:            `${original.name} (cópia)`,
      description:     original.description,
      type:            original.type,
      ai_config:       original.ai_config,
    })
    .returning('*');
  return row;
};

exports.activate = async (organizationId, id) => {
  const [row] = await db(TABLE)
    .where({ organization_id: organizationId, id })
    .update({ is_active: true, updated_at: db.fn.now() })
    .returning('*');
  return row;
};

exports.deactivate = async (organizationId, id) => {
  const [row] = await db(TABLE)
    .where({ organization_id: organizationId, id })
    .update({ is_active: false, updated_at: db.fn.now() })
    .returning('*');
  return row;
};

// Mantém os helpers antigos do model para quem ainda os chamar fora do controller.
exports._model = Chatbot;
