// server/src/middlewares/auth.middleware.js
const jwt = require('jsonwebtoken');

const ACCESS_COOKIE = 'jetgo_at';
const CSRF_COOKIE = 'csrf_token';

/**
 * Garante que a request tem um access token válido em cookie httpOnly.
 * Em rotas state-changing, valida também o double-submit CSRF (header X-CSRF-Token == cookie csrf_token).
 *
 * Anexa em req.auth: { userId, organizationId, role }
 */
function authRequired(req, res, next) {
  try {
    const token = req.cookies?.[ACCESS_COOKIE];
    if (!token) {
      return res.status(401).json({ error: 'Não autenticado', code: 'UNAUTHORIZED' });
    }

    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) {
      return res
        .status(500)
        .json({ error: 'JWT_ACCESS_SECRET não configurado no servidor' });
    }

    let payload;
    try {
      payload = jwt.verify(token, secret);
    } catch (err) {
      return res.status(401).json({ error: 'Token inválido ou expirado', code: 'UNAUTHORIZED' });
    }

    // CSRF double-submit em métodos state-changing
    const stateChanging = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method);
    if (stateChanging) {
      const cookieCsrf = req.cookies?.[CSRF_COOKIE];
      const headerCsrf = req.get('x-csrf-token');
      if (!cookieCsrf || !headerCsrf || cookieCsrf !== headerCsrf) {
        return res.status(403).json({ error: 'CSRF token inválido', code: 'CSRF_FAILED' });
      }
    }

    req.auth = {
      userId: payload.sub,
      organizationId: payload.organizationId,
      role: payload.role,
    };
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Restringe a rota a determinados roles (ex.: apenas admin).
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth) {
      return res.status(401).json({ error: 'Não autenticado', code: 'UNAUTHORIZED' });
    }
    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({ error: 'Acesso negado', code: 'FORBIDDEN' });
    }
    next();
  };
}

module.exports = { authRequired, requireRole };
