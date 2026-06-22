const router = require('express').Router();
const flowController = require('./flow.controller');

// ── Rotas fixas (sem parâmetro dinâmico) — DEVEM vir primeiro ────────
router.post('/validate', (req, res) => flowController.validateFlow(req, res));
router.post('/', (req, res) => flowController.createFlow(req, res));
router.get('/', (req, res) => flowController.listFlows(req, res));

// ── Sessões (prefixo /sessions) — antes de /:flowId ──────────────────
router.post('/sessions/:sessionId/input', (req, res) => flowController.processInput(req, res));
router.post('/sessions/:sessionId/end',   (req, res) => flowController.endSession(req, res));
router.get('/sessions/:sessionId/stats',  (req, res) => flowController.getSessionStats(req, res));
router.get('/sessions/:sessionId',        (req, res) => flowController.getSession(req, res));

// ── Flows com parâmetro dinâmico — por último ─────────────────────────
router.get('/:flowId',           (req, res) => flowController.getFlow(req, res));
router.put('/:flowId',           (req, res) => flowController.updateFlow(req, res));
router.put('/:flowId/graph',     (req, res) => flowController.replaceGraph(req, res));
router.post('/:flowId/publish',  (req, res) => flowController.publishFlow(req, res));
router.post('/:flowId/sessions', (req, res) => flowController.startSession(req, res));
router.delete('/:flowId',        (req, res) => flowController.deleteFlow(req, res));

module.exports = router;
