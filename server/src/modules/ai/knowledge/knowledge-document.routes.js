// server/src/modules/ai/knowledge/knowledge-document.routes.js
//
// Montado em /api/v1/knowledge-documents (routes/index.js). Operações sobre um
// documento já existente, fora do contexto da KB no path.

const router = require('express').Router();
const c = require('./knowledge.controller');

router.get('/:id', c.getDocument);
router.delete('/:id', c.deleteDocument);
router.post('/:id/reindex', c.reindexDocument);

module.exports = router;
