// server/src/modules/auth/auth.controller.js
const { z } = require('zod');
const authService = require('./auth.service');

const ACCESS_COOKIE = 'jetgo_at';
const REFRESH_COOKIE = 'jetgo_rt';
const CSRF_COOKIE = 'csrf_token';

const isProd = process.env.NODE_ENV === 'production';
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;

/**
 * Configura o trio de cookies (access + refresh + csrf) na resposta.
 * - access/refresh: httpOnly (front nunca lê)
 * - csrf: legível, mesmo TTL do access
 */
function setAuthCookies(res, tokens) {
  const baseOpts = {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/',
    domain: COOKIE_DOMAIN,
  };

  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...baseOpts,
    maxAge: tokens.accessMaxAge * 1000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...baseOpts,
    maxAge: tokens.refreshMaxAge * 1000,
    path: '/api/v1/auth', // refresh só viaja no caminho de auth
  });
  res.cookie(CSRF_COOKIE, tokens.csrfToken, {
    ...baseOpts,
    httpOnly: false, // PRECISA ser legível pelo JS
    maxAge: tokens.accessMaxAge * 1000,
  });
}

function clearAuthCookies(res) {
  const opts = { path: '/', domain: COOKIE_DOMAIN };
  res.clearCookie(ACCESS_COOKIE, opts);
  res.clearCookie(REFRESH_COOKIE, { ...opts, path: '/api/v1/auth' });
  res.clearCookie(CSRF_COOKIE, opts);
}

/* -------------------- Schemas -------------------- */

const loginSchema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(1, 'Senha obrigatória'),
});

const forgotSchema = z.object({
  email: z.string().email('E-mail inválido'),
});

/* -------------------- Handlers -------------------- */

exports.login = async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const { tokens, session } = await authService.login(body);
    setAuthCookies(res, tokens);
    res.json(session);
  } catch (err) {
    next(err);
  }
};

exports.logout = async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.jetgo_rt;
    await authService.logout(refreshToken);
    clearAuthCookies(res);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};

exports.refresh = async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.jetgo_rt;
    const tokens = await authService.refresh(refreshToken);
    setAuthCookies(res, tokens);
    res.status(204).end();
  } catch (err) {
    clearAuthCookies(res);
    next(err);
  }
};

exports.me = async (req, res, next) => {
  try {
    if (!req.auth) return res.status(401).json({ error: 'Não autenticado' });
    const session = await authService.getSessionForUser(req.auth.userId);
    res.json(session);
  } catch (err) {
    next(err);
  }
};

exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = forgotSchema.parse(req.body);
    await authService.forgotPassword(email);
    // Sempre 204 — não revela se o e-mail existe
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};
