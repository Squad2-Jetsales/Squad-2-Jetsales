const db = require('../../database');

function toCount(value) {
  return Number(value || 0);
}

async function countOpenTickets(organizationId) {
  const row = await db('tickets')
    .where({ organization_id: organizationId, status: 'open' })
    .count('* as total')
    .first();

  return toCount(row?.total);
}

async function countActiveConnections(organizationId) {
  const row = await db('whatsapp_connections')
    .where({ organization_id: organizationId, status: 'connected' })
    .count('* as total')
    .first();

  return toCount(row?.total);
}

async function countMessagesBetween(organizationId, startAt, endAt) {
  const row = await db('messages as m')
    .join('conversations as c', 'c.id', 'm.conversation_id')
    .where('c.organization_id', organizationId)
    .andWhere('m.created_at', '>=', startAt)
    .andWhere('m.created_at', '<', endAt)
    .count('* as total')
    .first();

  return toCount(row?.total);
}

async function countActiveChatbots(organizationId) {
  const row = await db('chatbots')
    .where({ organization_id: organizationId, is_active: true })
    .count('* as total')
    .first();

  return toCount(row?.total);
}

async function countTotalChatbots(organizationId) {
  const row = await db('chatbots')
    .where({ organization_id: organizationId })
    .count('* as total')
    .first();

  return toCount(row?.total);
}

async function listMessageVolumeByDay(organizationId, startAt, endAt) {
  const rows = await db('messages as m')
    .join('conversations as c', 'c.id', 'm.conversation_id')
    .select(db.raw("TO_CHAR(DATE(m.created_at), 'YYYY-MM-DD') as day"))
    .count('* as count')
    .where('c.organization_id', organizationId)
    .andWhere('m.created_at', '>=', startAt)
    .andWhere('m.created_at', '<', endAt)
    .groupByRaw('DATE(m.created_at)')
    .orderByRaw('DATE(m.created_at) asc');

  return rows.map((row) => ({
    day: row.day,
    count: toCount(row.count),
  }));
}

async function listTicketVolumeByDay(organizationId, startAt, endAt) {
  const rows = await db('tickets')
    .select(db.raw("TO_CHAR(DATE(created_at), 'YYYY-MM-DD') as day"))
    .count('* as count')
    .where({ organization_id: organizationId })
    .andWhere('created_at', '>=', startAt)
    .andWhere('created_at', '<', endAt)
    .groupByRaw('DATE(created_at)')
    .orderByRaw('DATE(created_at) asc');

  return rows.map((row) => ({
    day: row.day,
    count: toCount(row.count),
  }));
}

async function listRecentActivity(organizationId, limit) {
  return db('conversations as c')
    .leftJoin('contacts as ct', 'ct.id', 'c.contact_id')
    .select(
      'c.id',
      'c.status',
      'ct.phone as contact_phone',
      db.raw("COALESCE(NULLIF(c.last_message_preview, ''), ?) as preview", ['Conversa iniciada']),
      db.raw('COALESCE(c.last_message_at, c.updated_at, c.created_at) as created_at')
    )
    .where('c.organization_id', organizationId)
    .orderByRaw('COALESCE(c.last_message_at, c.updated_at, c.created_at) DESC')
    .limit(limit);
}

module.exports = {
  countOpenTickets,
  countActiveConnections,
  countMessagesBetween,
  countActiveChatbots,
  countTotalChatbots,
  listMessageVolumeByDay,
  listTicketVolumeByDay,
  listRecentActivity,
};
