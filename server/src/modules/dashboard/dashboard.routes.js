const router = require('express').Router();
const controller = require('./dashboard.controller');

router.get('/summary', controller.summary);
router.get('/messages-volume', controller.messagesVolume);
router.get('/tickets-volume', controller.ticketsVolume);
router.get('/recent-activity', controller.recentActivity);

module.exports = router;
