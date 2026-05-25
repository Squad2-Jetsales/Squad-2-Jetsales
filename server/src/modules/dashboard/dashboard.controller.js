const service = require('./dashboard.service');

exports.summary = async (req, res, next) => {
  try {
    const data = await service.getSummary(req.auth.organizationId);
    res.json(data);
  } catch (err) {
    next(err);
  }
};

exports.messagesVolume = async (req, res, next) => {
  try {
    const data = await service.getMessagesVolume(req.auth.organizationId, req.query.days);
    res.json(data);
  } catch (err) {
    next(err);
  }
};

exports.ticketsVolume = async (req, res, next) => {
  try {
    const data = await service.getTicketsVolume(req.auth.organizationId, req.query.days);
    res.json(data);
  } catch (err) {
    next(err);
  }
};

exports.recentActivity = async (req, res, next) => {
  try {
    const data = await service.getRecentActivity(req.auth.organizationId, req.query.limit);
    res.json(data);
  } catch (err) {
    next(err);
  }
};
