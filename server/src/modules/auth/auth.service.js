// server/src/modules/auth/auth.service.js
//
// Regras de autenticação. Mantém esta camada pura — nada de req/res aqui.
// Tokens:
//   - Access: JWT curto (15min) em cookie httpOnly `jetgo_at`
//   - Refresh: JWT longo (30 dias) em cookie httpOnly `jetgo_rt`, com hash em DB
//   - CSRF: token aleatório em cookie LEGÍVEL `csrf_token` (não httpOnly).
//           Front lê o cookie e devolve no header X-CSRF-Token (double-submit).

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('../../database');
const { httpError } = require('../../middlewares/error.middleware');

const ACCESS_TTL_SECONDS = 60 * 15;            // 15 min
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 dias

function getSecrets() {
  const access = process.env.JWT_ACCESS_SECRET;
  const refresh = process.env.JWT_REFRESH_SECRET;
  if (!access || !refresh) {
    throw httpError(500, 'JWT_ACCESS_SECRET / JWT_REFRESH_SECRET não configurados');
  }
  return { access, refresh };
}

/* -------------------- Token helpers -------------------- */

function signAccessToken(user) {
  const { access } = getSecrets();
  return jwt.sign(
    {
      sub: user.id,
      organizationId: user.organization_id,
      role: user.role,
    },
    access,
    { expiresIn: ACCESS_TTL_SECONDS }
  );
}

function signRefreshToken(user, jti) {
  const { refresh } = getSecrets();
  return jwt.sign({ sub: user.id, jti }, refresh, { expiresIn: REFRESH_TTL_SECONDS });
}

function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashRefresh(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/* -------------------- Casos de uso -------------------- */

async function login({ email, password }) {
  // O índice unique de users é (organization_id, email) — o mesmo email pode
  // existir em organizações distintas. Sem escopo por organização (login
  // multi-tenant é evolução futura), ordenamos por created_at pra ser
  // determinístico em vez de devolver linha arbitrária do Postgres.
  const user = await db('users').where({ email }).orderBy('created_at', 'asc').first();
  if (!user) throw httpError(401, 'Credenciais inválidas', 'INVALID_CREDENTIALS');

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw httpError(401, 'Credenciais inválidas', 'INVALID_CREDENTIALS');

  const organization = await db('organizations').where({ id: user.organization_id }).first();
  if (!organization) throw httpError(500, 'Organização não encontrada para o usuário');

  const tokens = await issueTokens(user);

  return {
    tokens,
    session: buildSession(user, organization),
  };
}

async function issueTokens(user) {
  const accessToken = signAccessToken(user);
  const jti = crypto.randomUUID();
  const refreshToken = signRefreshToken(user, jti);

  await db('refresh_tokens').insert({
    user_id: user.id,
    token_hash: hashRefresh(refreshToken),
    jti,
    expires_at: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
  });

  const csrfToken = generateCsrfToken();
  return {
    accessToken,
    refreshToken,
    csrfToken,
    accessMaxAge: ACCESS_TTL_SECONDS,
    refreshMaxAge: REFRESH_TTL_SECONDS,
  };
}

async function refresh(refreshToken) {
  if (!refreshToken) throw httpError(401, 'Refresh token ausente', 'NO_REFRESH');

  const { refresh: secret } = getSecrets();
  let payload;
  try {
    payload = jwt.verify(refreshToken, secret);
  } catch {
    throw httpError(401, 'Refresh token inválido', 'INVALID_REFRESH');
  }

  const row = await db('refresh_tokens').where({ jti: payload.jti }).first();
  if (!row || row.revoked_at || row.token_hash !== hashRefresh(refreshToken)) {
    throw httpError(401, 'Refresh token revogado', 'INVALID_REFRESH');
  }

  const user = await db('users').where({ id: payload.sub }).first();
  if (!user) throw httpError(401, 'Usuário não encontrado', 'INVALID_REFRESH');

  // Rotação: revoga o atual e emite par novo
  await db('refresh_tokens').where({ id: row.id }).update({ revoked_at: new Date() });
  const tokens = await issueTokens(user);
  return tokens;
}

async function logout(refreshToken) {
  if (!refreshToken) return;
  const { refresh: secret } = getSecrets();
  try {
    const payload = jwt.verify(refreshToken, secret);
    await db('refresh_tokens').where({ jti: payload.jti }).update({ revoked_at: new Date() });
  } catch {
    // token já expirado/inválido — nada a revogar
  }
}

async function getSessionForUser(userId) {
  const user = await db('users').where({ id: userId }).first();
  if (!user) throw httpError(404, 'Usuário não encontrado');
  const organization = await db('organizations').where({ id: user.organization_id }).first();
  return buildSession(user, organization);
}

function buildSession(user, organization) {
  return {
    user: {
      id: user.id,
      organizationId: user.organization_id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      plan: organization.plan,
      settings: organization.settings || {},
      createdAt: organization.created_at,
      updatedAt: organization.updated_at,
    },
  };
}

/**
 * Stub de forgot-password — emite o evento e retorna 204 mesmo se o e-mail
 * não existir, para evitar enumeração de contas. A entrega real do e-mail
 * será plugada no integrations/email-provider na Fase 2.
 */
async function forgotPassword(email) {
  const user = await db('users').where({ email }).first();
  if (user) {
    // TODO: enfileirar envio de e-mail com link de reset
    console.log(`[auth] forgot-password solicitado para ${email}`);
  }
  return true;
}

module.exports = {
  login,
  refresh,
  logout,
  getSessionForUser,
  forgotPassword,
  ACCESS_TTL_SECONDS,
  REFRESH_TTL_SECONDS,
};
