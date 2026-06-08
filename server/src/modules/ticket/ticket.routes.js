const router = require('express').Router();
const controller = require('./ticket.controller');

router.get('/', controller.findAll);

module.exports = router;
