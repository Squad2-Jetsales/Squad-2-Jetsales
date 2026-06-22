// server/src/middlewares/error.middleware.js
const { ZodError } = require('zod');

/**
 * Handler de erro global. Sempre devolve JSON no contrato esperado pelo front:
 *   { error: string, code?: string, fields?: { [key]: message } }
 */
// eslint-disable-next-line no-unused-vars
function errorMiddleware(err, req, res, _next) {
  // Validação Zod
  if (err instanceof ZodError) {
    const fields = {};
    for (const issue of err.issues) {
      const path = issue.path.join('.') || '_';
      fields[path] = issue.message;
    }
    return res.status(400).json({
      error: 'Dados inválidos',
      code: 'VALIDATION_ERROR',
      fields,
    });
  }

  // Erros de domínio com .status definido
  if (err && typeof err.status === 'number') {
    return res.status(err.status).json({
      error: err.message,
      code: err.code,
      fields: err.fields,
    });
  }

  // Fallback
  console.error('[ERROR]', err);
  return res.status(500).json({
    error: process.env.NODE_ENV === 'production' ? 'Erro interno' : err.message,
    code: 'INTERNAL_ERROR',
  });
}

/**
 * Helper para criar erros de domínio de forma fluente.
 *   throw httpError(404, 'Chatbot não encontrado', 'CHATBOT_NOT_FOUND');
 */
function httpError(status, message, code, fields) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  if (fields) e.fields = fields;
  return e;
}

module.exports = errorMiddleware;
module.exports.httpError = httpError;
