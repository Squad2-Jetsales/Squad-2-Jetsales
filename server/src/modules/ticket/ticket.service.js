const Ticket = require('./ticket.model');

const VALID_STATUS = ['open', 'in_progress', 'closed'];

function toIso(value) {
  if (!value) return value;
  return value instanceof Date ? value.toISOString() : value;
}

function mapTicket(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    conversationId: row.conversation_id,
    assignedTo: row.assigned_to || undefined,
    status: row.status,
    priority: row.priority,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

exports.VALID_STATUS = VALID_STATUS;

exports.list = async (organizationId, filters = {}) => {
  const rows = await Ticket.listByOrganization(organizationId, filters);
  return rows.map(mapTicket);
};
