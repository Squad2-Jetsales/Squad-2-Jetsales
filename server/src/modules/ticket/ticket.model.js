const db = require('../../database');

const TABLE = 'tickets';

const COLUMNS = [
  'id',
  'organization_id',
  'conversation_id',
  'assigned_to',
  'status',
  'priority',
  'created_at',
  'updated_at',
];

async function listByOrganization(organizationId, { status, limit = 50, offset = 0 } = {}) {
  const query = db(TABLE)
    .select(COLUMNS)
    .where({ organization_id: organizationId })
    .orderBy('created_at', 'desc')
    .limit(Math.min(Math.max(Number(limit) || 50, 1), 200))
    .offset(Math.max(Number(offset) || 0, 0));

  if (status) query.where({ status });

  return query;
}

module.exports = {
  TABLE,
  COLUMNS,
  listByOrganization,
};
