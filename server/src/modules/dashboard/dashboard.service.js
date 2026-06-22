const Dashboard = require('./dashboard.model');

const DEFAULT_DAYS = 7;
const MAX_DAYS = 90;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

function startOfDay(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function addDays(date, amount) {
  const value = new Date(date);
  value.setDate(value.getDate() + amount);
  return value;
}

function toIso(value) {
  if (!value) return value;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function formatDay(date) {
  return date.toISOString().slice(0, 10);
}

function buildSeries(startAt, days, rows) {
  const counts = new Map(rows.map((row) => [row.day, Number(row.count || 0)]));
  const points = [];

  for (let offset = 0; offset < days; offset += 1) {
    const currentDay = addDays(startAt, offset);
    const day = formatDay(currentDay);
    points.push({
      day,
      count: counts.get(day) || 0,
    });
  }

  return points;
}

async function getSummary(organizationId) {
  const todayStart = startOfDay();
  const tomorrowStart = addDays(todayStart, 1);

  const [
    openTickets,
    activeConnections,
    messagesToday,
    activeChatbots,
    totalChatbots,
  ] = await Promise.all([
    Dashboard.countOpenTickets(organizationId),
    Dashboard.countActiveConnections(organizationId),
    Dashboard.countMessagesBetween(organizationId, todayStart, tomorrowStart),
    Dashboard.countActiveChatbots(organizationId),
    Dashboard.countTotalChatbots(organizationId),
  ]);

  const activeChatbotsPct = totalChatbots > 0
    ? Math.round((activeChatbots / totalChatbots) * 100)
    : 0;

  return {
    openTickets,
    deltaTickets: 0,
    activeConnections,
    deltaConnections: 0,
    messagesToday,
    deltaMessages: 0,
    activeChatbotsPct,
    deltaChatbotsPct: 0,
  };
}

async function getMessagesVolume(organizationId, daysInput) {
  const days = clampInteger(daysInput, DEFAULT_DAYS, 1, MAX_DAYS);
  const todayStart = startOfDay();
  const startAt = addDays(todayStart, -(days - 1));
  const endAt = addDays(todayStart, 1);
  const rows = await Dashboard.listMessageVolumeByDay(organizationId, startAt, endAt);

  return buildSeries(startAt, days, rows);
}

async function getTicketsVolume(organizationId, daysInput) {
  const days = clampInteger(daysInput, DEFAULT_DAYS, 1, MAX_DAYS);
  const todayStart = startOfDay();
  const startAt = addDays(todayStart, -(days - 1));
  const endAt = addDays(todayStart, 1);
  const rows = await Dashboard.listTicketVolumeByDay(organizationId, startAt, endAt);

  return buildSeries(startAt, days, rows);
}

async function getRecentActivity(organizationId, limitInput) {
  const limit = clampInteger(limitInput, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const rows = await Dashboard.listRecentActivity(organizationId, limit);

  return rows.map((row) => ({
    id: row.id,
    contactPhone: row.contact_phone || '',
    status: row.status,
    preview: row.preview || 'Conversa iniciada',
    createdAt: toIso(row.created_at),
  }));
}

module.exports = {
  getSummary,
  getMessagesVolume,
  getTicketsVolume,
  getRecentActivity,
};
