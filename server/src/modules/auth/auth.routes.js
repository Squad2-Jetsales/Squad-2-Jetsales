// server/src/modules/auth/auth.routes.js
//
// Rotas de autenticação. As 4 primeiras são públicas (sem cookie ainda) e
// /me é a única que exige authRequired — aplicado pontualmente porque o
// agregador em routes/index.js NÃO aplica authRequired neste sub-router
// (ele é montado antes do middleware global).

const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const controller = require('./auth.controller');
const { authRequired } = require('../../middlewares/auth.middleware');

// Limita brute-force de senha. `trust proxy` no app.js garante que req.ip
// pega o cliente real via X-Forwarded-For do Render/Vercel.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 10,                  // 10 tentativas por IP por janela
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Muitas tentativas de login. Tente novamente em alguns minutos.',
    code: 'RATE_LIMITED',
  },
});

// Evita spam de envio de e-mail e enumeração de contas via /forgot-password.
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Muitas solicitações. Tente novamente em alguns minutos.',
    code: 'RATE_LIMITED',
  },
});

router.post('/login', loginLimiter, controller.login);
router.post('/logout', controller.logout);
router.post('/refresh', controller.refresh);
router.post('/forgot-password', forgotPasswordLimiter, controller.forgotPassword);
router.get('/me', authRequired, controller.me);

module.exports = router;
