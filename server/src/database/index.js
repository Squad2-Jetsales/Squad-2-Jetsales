// server/src/database/index.js
//
// Conexão única com Postgres via knex. Importe `db` em qualquer model/service
// para queries diretas. Nunca instancie outra conexão.

const knex = require('knex');
const config = require('../../knexfile');

function resolveEnv() {
  if (process.env.NODE_ENV) return process.env.NODE_ENV;

  const hasManagedDatabaseUrl =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING;

  return hasManagedDatabaseUrl ? 'production' : 'development';
}

const env = resolveEnv();
const db = knex(config[env]);

module.exports = db;
