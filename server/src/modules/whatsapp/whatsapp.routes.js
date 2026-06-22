const router = require('express').Router();
const controller = require('./whatsapp.controller');

router.get('/status', controller.getEvolutionStatus);
router.post('/instances', controller.createInstance);
router.get('/instances/:instanceName/status', controller.getInstanceStatus);
router.get('/instances/:instanceName/qrcode', controller.getInstanceQrCode);
router.post('/send-test', controller.sendTestMessage);
router.post('/webhook-config', controller.configureWebhook);

router.get('/', controller.findAll);
router.post('/', controller.create);
router.get('/:id', controller.findOne);
router.post('/:id/refresh-qr', controller.refreshQr);
router.delete('/:id', controller.remove);

module.exports = router;
