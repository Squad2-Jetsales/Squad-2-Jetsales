// server/src/modules/ai/ai.controller.js
//
// Camada HTTP do módulo de IA.
// F3.1: GET /ai/health.

const aiService = require('./ai.service');

async function getHealth(_req, res, next) {
  try {
    const result = await aiService.health();
    const ok = result.chat?.ok && result.embedding?.ok;
    res.status(ok ? 200 : 503).json({
      ok,
      checkedAt: new Date().toISOString(),
      ...result,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getHealth };
