// server/src/modules/conversation/conversation.routes.js
//
// Montado em /api/v1/conversations pelo routes/index.js (authRequired já
// aplicado um nível acima). As rotas de mensagem ficam aninhadas em
// /conversations/:conversationId/messages.

const router = require('express').Router();
const c = require('./conversation.controller');
const messageRoutes = require('./message.routes');

router.get('/', c.findAll);
router.get('/:id', c.findOne);

router.use('/:conversationId/messages', messageRoutes);

module.exports = router;
