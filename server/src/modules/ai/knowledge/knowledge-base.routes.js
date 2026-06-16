// server/src/modules/ai/knowledge/knowledge-base.routes.js
//
// Montado em /api/v1/knowledge-bases (routes/index.js). authRequired + CSRF já
// aplicados no router pai. Cobre CRUD de KB + documentos aninhados.

const router = require('express').Router();
const c = require('./knowledge.controller');
const { handleUpload } = require('./upload.middleware');

// Knowledge bases
router.get('/', c.listKbs);
router.post('/', c.createKb);
router.get('/:id', c.getKb);
router.patch('/:id', c.updateKb);
router.delete('/:id', c.deleteKb);

// Documentos de uma KB
router.get('/:id/documents', c.listDocuments);
router.post('/:id/documents', handleUpload, c.createDocument);

module.exports = router;
