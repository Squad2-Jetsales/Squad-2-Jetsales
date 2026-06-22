/**
 * F3.1 — Habilita a extensão pgvector no Postgres.
 *
 * Requer que a imagem Docker do Postgres já tenha a extensão disponível
 * (ver docker-compose.yaml: usar `pgvector/pgvector:pg15`).
 *
 * Em ambientes gerenciados (Supabase/RDS) basta habilitar via dashboard ou
 * a query abaixo se o serviço permitir CREATE EXTENSION.
 */

exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS vector');
};

exports.down = async function down(knex) {
  // Não dropamos a extensão por segurança — outras migrations podem depender.
  // Se realmente precisar, rode manualmente: DROP EXTENSION vector;
};
