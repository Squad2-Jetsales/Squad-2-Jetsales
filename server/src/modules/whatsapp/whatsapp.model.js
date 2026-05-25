const db = require('../../database');

const TABLE = 'whatsapp_connections';

const COLUMNS = [
  'id',
  'organization_id',
  'chatbot_id',
  'name',
  'phone_number',
  'evolution_instance',
  'status',
  'qr_code',
  'qr_expires_at',
  'last_activity_at',
  'created_at',
  'updated_at',
];

async function listByOrganization(organizationId) {
  return db(TABLE)
    .select(COLUMNS)
    .where({ organization_id: organizationId })
    .orderBy('created_at', 'desc');
}

async function findById(organizationId, id) {
  return db(TABLE)
    .select(COLUMNS)
    .where({ organization_id: organizationId, id })
    .first();
}

async function findByInstanceName(instanceName) {
  return db(TABLE)
    .select(COLUMNS)
    .where({ evolution_instance: instanceName })
    .first();
}

async function findByOrganizationAndInstance(organizationId, instanceName) {
  return db(TABLE)
    .select(COLUMNS)
    .where({ organization_id: organizationId, evolution_instance: instanceName })
    .first();
}

async function create(payload) {
  const [row] = await db(TABLE)
    .insert(payload)
    .returning(COLUMNS);
  return row;
}

async function updateById(organizationId, id, patch) {
  const [row] = await db(TABLE)
    .where({ organization_id: organizationId, id })
    .update({ ...patch, updated_at: db.fn.now() })
    .returning(COLUMNS);
  return row;
}

async function updateByInstanceName(instanceName, patch) {
  const [row] = await db(TABLE)
    .where({ evolution_instance: instanceName })
    .update({ ...patch, updated_at: db.fn.now() })
    .returning(COLUMNS);
  return row;
}

async function removeById(organizationId, id) {
  return db(TABLE)
    .where({ organization_id: organizationId, id })
    .del();
}

async function countTodayByConnectionIds(organizationId, connectionIds) {
  if (!connectionIds.length) return new Map();

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const rows = await db('conversations')
    .select('whatsapp_connection_id')
    .count('* as total')
    .where({ organization_id: organizationId })
    .whereIn('whatsapp_connection_id', connectionIds)
    .andWhere('created_at', '>=', startOfDay)
    .groupBy('whatsapp_connection_id');

  return new Map(
    rows.map((row) => [row.whatsapp_connection_id, Number(row.total || 0)])
  );
}

module.exports = {
  TABLE,
  COLUMNS,
  listByOrganization,
  findById,
  findByInstanceName,
  findByOrganizationAndInstance,
  create,
  updateById,
  updateByInstanceName,
  removeById,
  countTodayByConnectionIds,
};
