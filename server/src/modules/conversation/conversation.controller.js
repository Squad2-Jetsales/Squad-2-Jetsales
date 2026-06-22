// server/src/modules/conversation/conversation.controller.js
//
// Camada fina sobre conversation.service. authRequired já roda em
// routes/index.js, então aqui só lemos req.auth.organizationId, validamos
// input e delegamos.

const service = require('./conversation.service');

exports.findAll = async (req, res, next) => {
  try {
    const { organizationId } = req.auth;
    const { contactId, chatbotId, status, limit, offset } = req.query;
    if (status !== undefined && !service.VALID_STATUS.includes(status)) {
      return res.status(400).json({ error: 'status inválido', code: 'BAD_REQUEST' });
    }
    const rows = await service.list(organizationId, { contactId, chatbotId, status, limit, offset });
    res.json(rows);
  } catch (err) {
    next(err);
  }
};

exports.findOne = async (req, res, next) => {
  try {
    const row = await service.findById(req.auth.organizationId, req.params.id);
    if (!row) {
      return res.status(404).json({ error: 'Conversa não encontrada', code: 'NOT_FOUND' });
    }
    res.json(row);
  } catch (err) {
    next(err);
  }
};
