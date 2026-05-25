const service = require('./whatsapp.service');

exports.findAll = async (req, res, next) => {
  try {
    const rows = await service.list(req.auth.organizationId);
    res.json(rows);
  } catch (err) {
    next(err);
  }
};

exports.findOne = async (req, res, next) => {
  try {
    const row = await service.findById(req.auth.organizationId, req.params.id);
    if (!row) {
      return res.status(404).json({ error: 'Conexao WhatsApp nao encontrada', code: 'NOT_FOUND' });
    }
    res.json(row);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const row = await service.createConnection(req.auth.organizationId, req.body || {});
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
};

exports.refreshQr = async (req, res, next) => {
  try {
    const row = await service.refreshQr(req.auth.organizationId, req.params.id);
    res.json(row);
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const ok = await service.remove(req.auth.organizationId, req.params.id);
    if (!ok) {
      return res.status(404).json({ error: 'Conexao WhatsApp nao encontrada', code: 'NOT_FOUND' });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};

exports.getEvolutionStatus = async (_req, res, next) => {
  try {
    const status = await service.getEvolutionStatus();
    res.json(status);
  } catch (err) {
    next(err);
  }
};

exports.createInstance = async (req, res, next) => {
  try {
    const row = await service.createConnection(req.auth.organizationId, req.body || {});
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
};

exports.getInstanceStatus = async (req, res, next) => {
  try {
    const row = await service.getInstanceStatus(req.auth.organizationId, req.params.instanceName);
    res.json(row);
  } catch (err) {
    next(err);
  }
};

exports.getInstanceQrCode = async (req, res, next) => {
  try {
    const row = await service.getInstanceQrCode(req.auth.organizationId, req.params.instanceName);
    res.json(row);
  } catch (err) {
    next(err);
  }
};

exports.sendTestMessage = async (req, res, next) => {
  try {
    const row = await service.sendTestMessage(req.auth.organizationId, req.body || {});
    res.json(row);
  } catch (err) {
    next(err);
  }
};

exports.configureWebhook = async (req, res, next) => {
  try {
    const row = await service.configureWebhook(req.auth.organizationId, req.body || {});
    res.json(row);
  } catch (err) {
    next(err);
  }
};
