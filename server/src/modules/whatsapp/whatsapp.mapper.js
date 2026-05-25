const QRCode = require('qrcode');

function toIso(value) {
  if (!value) return value;
  return value instanceof Date ? value.toISOString() : value;
}

async function toQrDataUrl(qrCodeValue) {
  if (!qrCodeValue) return undefined;
  if (/^data:image\//i.test(qrCodeValue)) return qrCodeValue;
  return QRCode.toDataURL(qrCodeValue, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 240,
  });
}

async function mapConnection(row, extra = {}) {
  if (!row) return null;

  return {
    id: row.id,
    organizationId: row.organization_id,
    chatbotId: row.chatbot_id,
    name: row.name,
    phoneNumber: row.phone_number,
    evolutionInstance: row.evolution_instance,
    status: row.status,
    qrCode: await toQrDataUrl(row.qr_code),
    qrCodeValue: row.qr_code || undefined,
    qrExpiresAt: toIso(row.qr_expires_at),
    lastActivityAt: toIso(row.last_activity_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    metricsToday: typeof extra.conversationsToday === 'number'
      ? { conversations: extra.conversationsToday }
      : undefined,
    pairingCode: extra.pairingCode || undefined,
  };
}

module.exports = { mapConnection, toIso };
