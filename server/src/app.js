// server/src/app.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const errorMiddleware = require('./middlewares/error.middleware');

const app = express();

// Atrás de proxy (Render, Fly, Heroku, Nginx) precisamos confiar no
// X-Forwarded-* para que `req.secure` seja true em HTTPS e cookies com
// `Secure: true` cheguem ao navegador.
app.set('trust proxy', 1);

/* -------------------------------------------------------------------------- */
/*  Middlewares globais                                                       */
/* -------------------------------------------------------------------------- */

const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGINS || 'http://localhost:8080,http://localhost:5173,http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      // Permite ferramentas server-to-server (curl, healthchecks) sem Origin
      if (!origin) return cb(null, true);
      if (FRONTEND_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error(`Origin não permitida pelo CORS: ${origin}`));
    },
    credentials: true,
    exposedHeaders: ['X-CSRF-Token'],
  })
);

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

/* -------------------------------------------------------------------------- */
/*  Health check                                                              */
/* -------------------------------------------------------------------------- */

app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'jetgo-api', version: 'v1' });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

/* -------------------------------------------------------------------------- */
/*  Webhooks públicos (não passam por authRequired)                           */
/* -------------------------------------------------------------------------- */

try {
  const webhookRoutes = require('./modules/webhook/webhook.routes');
  app.use('/api/v1/webhooks', webhookRoutes);
} catch (err) {
  if (err.code === 'MODULE_NOT_FOUND') {
    console.warn('⚠️  webhooks ainda não implementados');
  } else {
    throw err;
  }
}

/* -------------------------------------------------------------------------- */
/*  Rotas de domínio (todas montadas em /api/v1 — contrato com o front)       */
/* -------------------------------------------------------------------------- */

// Rota de setup pública (protegida por header X-Setup-Token) — útil para
// criar o admin dev em deploys remotos (Render, etc.). Montada antes do
// agregador para não passar por authRequired.
app.use('/api/v1/setup', require('./modules/setup/setup.routes'));
app.use('/api/v1', require('./routes'));

/* -------------------------------------------------------------------------- */
/*  Erro 404 + handler global                                                 */
/* -------------------------------------------------------------------------- */

app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada', path: req.originalUrl });
});

app.use(errorMiddleware);

/* -------------------------------------------------------------------------- */
/*  Bootstrap                                                                 */
/* -------------------------------------------------------------------------- */

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => {
  console.log(`🚀 JetGO API rodando em http://localhost:${PORT}`);
  console.log(`   Prefixo: /api/v1`);
  console.log(`   Origins permitidos: ${FRONTEND_ORIGINS.join(', ')}`);
});

module.exports = app;
