// server/src/routes/index.js
//
// Agregador de rotas do JetGO. Tudo aqui é montado pelo app.js sob /api/v1.
// Mantemos os módulos isolados por domínio para que cada subgrupo (auth, flows,
// chatbots, etc.) possa evoluir sem tocar nos outros.

const router = require('express').Router();
const { authRequired } = require('../middlewares/auth.middleware');

/* -------------------- Helpers -------------------- */

/**
 * Tenta carregar um router. Se o módulo ainda não existe (ex.: módulos das
 * próximas fases), devolve um router stub que responde 501 Not Implemented —
 * assim o front não recebe 404 silencioso e a equipe vê o que falta no log.
 */
function loadOrStub(modulePath, label) {
  try {
    const mod = require(modulePath);
    if (typeof mod !== 'function' && typeof mod?.handle !== 'function') {
      console.warn(`⚠️  [${label}] export não é um router Express — usando stub`);
      return makeStub(label);
    }
    return mod;
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      // O Node empilha o require stack na message, então um simples
      // `message.includes('whatsapp.routes')` false-positiva quando uma
      // dep npm transitiva está faltando (ex.: `qrcode` ausente
      // mascarava o whatsapp.routes como "não implementado"). Extraímos o
      // PRIMEIRO "Cannot find module 'X'" e comparamos com o nosso path.
      const missing = /Cannot find module '([^']+)'/.exec(err.message)?.[1] || '';
      const baseName = modulePath.split('/').pop();
      const isOwnModule =
        missing === modulePath ||
        missing.endsWith(`/${baseName}`) ||
        missing === baseName;

      if (isOwnModule) {
        console.warn(`⚠️  [${label}] módulo ainda não implementado — usando stub 501`);
        return makeStub(label, 'NOT_IMPLEMENTED');
      }
      console.error(`❌ [${label}] dependência ausente: '${missing}' — rode \`npm install\` no server`);
      return makeStub(label, 'MODULE_BROKEN', 503);
    }
    // Bug no módulo (sintaxe, etc.): degradamos pra stub pra não derrubar o
    // backend inteiro. Log loud pra equipe não ignorar.
    console.error(`❌ [${label}] falha ao carregar módulo (${err.code || err.name}): ${err.message} — usando stub 503`);
    return makeStub(label, 'MODULE_BROKEN', 503);
  }
}

function makeStub(label, code = 'NOT_IMPLEMENTED', status = 501) {
  const stub = require('express').Router();
  stub.all('*', (req, res) => {
    res.status(status).json({
      error: code === 'MODULE_BROKEN'
        ? `Endpoint indisponível: módulo ${label} com erro de carregamento`
        : `Endpoint não implementado: ${label}`,
      code,
      path: req.originalUrl,
    });
  });
  return stub;
}

/* -------------------- Rotas públicas -------------------- */

// Auth — login, logout, refresh, me, forgot-password
router.use('/auth', loadOrStub('../modules/auth/auth.routes', 'auth'));

/* -------------------- Rotas autenticadas -------------------- */
//
// A partir daqui tudo exige cookie httpOnly válido + CSRF double-submit em
// métodos state-changing. Os módulos individuais NÃO precisam aplicar
// authRequired novamente — é aplicado uma vez aqui.

router.use(authRequired);

router.use('/chatbots', loadOrStub('../modules/chatbot/chatbot.routes', 'chatbots'));
router.use('/flows', loadOrStub('../modules/flow/flow.routes', 'flows'));
router.use(
  '/whatsapp-connections',
  loadOrStub('../modules/whatsapp/whatsapp.routes', 'whatsapp-connections')
);
router.use(
  '/conversations',
  loadOrStub('../modules/conversation/conversation.routes', 'conversations')
);
router.use('/tickets', loadOrStub('../modules/ticket/ticket.routes', 'tickets'));
router.use('/dashboard', loadOrStub('../modules/dashboard/dashboard.routes', 'dashboard'));
router.use('/ai', loadOrStub('../modules/ai/ai.routes', 'ai'));
router.use(
  '/knowledge-bases',
  loadOrStub('../modules/ai/knowledge/knowledge-base.routes', 'knowledge-bases')
);
router.use(
  '/knowledge-documents',
  loadOrStub('../modules/ai/knowledge/knowledge-document.routes', 'knowledge-documents')
);

module.exports = router;
