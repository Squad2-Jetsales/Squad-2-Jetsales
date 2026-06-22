// server/src/database/index.js
//
// Conexão única com Postgres via knex. Importe `db` em qualquer model/service
// para queries diretas. Nunca instancie outra conexão.

const knex = require('knex');
const config = require('../../knexfile');

const env = process.env.NODE_ENV || 'development';
const db = knex(config[env]);

module.exports = db;
