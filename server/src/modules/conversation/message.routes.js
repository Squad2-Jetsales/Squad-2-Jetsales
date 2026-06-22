// server/src/modules/conversation/message.routes.js
//
// Sub-router aninhado em /conversations/:conversationId/messages. Usa
// mergeParams pra herdar `conversationId` do router pai.

const router = require('express').Router({ mergeParams: true });
const c = require('./message.controller');

router.get('/', c.list);
router.post('/', c.create);

module.exports = router;
