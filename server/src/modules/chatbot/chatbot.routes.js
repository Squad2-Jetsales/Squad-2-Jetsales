// server/src/modules/chatbot/chatbot.routes.js
//
// Rotas batem 1:1 com o contrato consumido pelo front em
// client/src/lib/api/chatbots.ts.

const router = require('express').Router();
const c = require('./chatbot.controller');

// Listagem aceita ?status=active|inactive&type=manual|ai_generated|ai_agent
router.get('/', c.findAll);
router.post('/', c.create);

// IA
router.post('/ai-generate', c.aiGenerate);

// Item
router.get('/:id', c.findOne);
router.patch('/:id', c.update);
router.delete('/:id', c.remove);

router.post('/:id/duplicate', c.duplicate);
router.post('/:id/activate', c.activate);
router.post('/:id/deactivate', c.deactivate);
router.post('/:id/ai-adjust', c.aiAdjust);

module.exports = router;
