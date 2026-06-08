const router = require('express').Router();
const controller = require('./webhook.controller');

router.post('/evolution', controller.handleEvolution);
router.post('/evolution/:eventSlug', controller.handleEvolution);

module.exports = router;
