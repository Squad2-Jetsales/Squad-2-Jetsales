// server/src/modules/ai/ai.routes.js
//
// Rotas do módulo de IA. Montado em /api/v1/ai pelo agregador.
// authRequired já é aplicado no router pai (routes/index.js) — não duplicar.
//
// F3.1: healthcheck apenas.
// Próximas fases adicionam: knowledge-bases CRUD, documents, agent preview.

const router = require('express').Router();
const { getHealth } = require('./ai.controller');

router.get('/health', getHealth);

module.exports = router;
