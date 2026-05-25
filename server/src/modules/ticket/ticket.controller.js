const service = require('./ticket.service');

exports.findAll = async (req, res, next) => {
  try {
    const { status, limit, offset } = req.query;
    if (status !== undefined && !service.VALID_STATUS.includes(status)) {
      return res.status(400).json({ error: 'status invalido', code: 'BAD_REQUEST' });
    }

    const rows = await service.list(req.auth.organizationId, { status, limit, offset });
    res.json(rows);
  } catch (err) {
    next(err);
  }
};
