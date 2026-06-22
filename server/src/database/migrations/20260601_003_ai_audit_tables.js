/**
 * F3.1 — Tabelas de auditoria de uso da IA (custos, latência, traces).
 *
 * `ai_usage_logs` — uma linha por chamada ao provider (embed / chat / rerank).
 * `ai_agent_traces` — uma linha por turno do agente, com chunks recuperados,
 *                     tools chamadas e decisão final. Liga-se à conversation.
 */

exports.up = async function up(knex) {
  /* -------------------- ai_usage_logs -------------------- */

  await knex.raw(`
    CREATE TYPE ai_usage_operation AS ENUM ('embed', 'chat', 'rerank')
  `);

  await knex.schema.createTable('ai_usage_logs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('organization_id')
      .notNullable()
      .references('id')
      .inTable('organizations')
      .onDelete('CASCADE');
    t.uuid('chatbot_id')
      .nullable()
      .references('id')
      .inTable('chatbots')
      .onDelete('SET NULL');
    t.uuid('conversation_id')
      .nullable()
      .references('id')
      .inTable('conversations')
      .onDelete('SET NULL');
    t.string('provider', 32).notNullable(); // 'openai' | 'anthropic'
    t.string('model', 120).notNullable();
    t.specificType('operation', 'ai_usage_operation').notNullable();
    t.integer('prompt_tokens').notNullable().defaultTo(0);
    t.integer('completion_tokens').notNullable().defaultTo(0);
    t.integer('total_tokens').notNullable().defaultTo(0);
    t.decimal('cost_usd', 12, 6).notNullable().defaultTo(0);
    t.integer('latency_ms').notNullable().defaultTo(0);
    t.jsonb('metadata').notNullable().defaultTo('{}');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['organization_id', 'created_at']);
    t.index(['organization_id', 'operation', 'created_at']);
  });

  /* -------------------- ai_agent_traces -------------------- */

  await knex.raw(`
    CREATE TYPE ai_agent_decision AS ENUM
      ('answered', 'fallback_flow', 'transferred_human', 'errored')
  `);

  await knex.schema.createTable('ai_agent_traces', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('organization_id')
      .notNullable()
      .references('id')
      .inTable('organizations')
      .onDelete('CASCADE');
    t.uuid('conversation_id')
      .notNullable()
      .references('id')
      .inTable('conversations')
      .onDelete('CASCADE');
    t.uuid('chatbot_id')
      .notNullable()
      .references('id')
      .inTable('chatbots')
      .onDelete('CASCADE');
    t.uuid('message_id').nullable(); // incoming message — FK opcional para não acoplar com message ID
    t.jsonb('retrieved_chunks').notNullable().defaultTo('[]'); // [{chunkId, score, snippet}]
    t.jsonb('prompt_summary').notNullable().defaultTo('{}'); // {systemHash, historyCount, contextTokens}
    t.jsonb('tools_called').notNullable().defaultTo('[]'); // [{name, args, result}]
    t.specificType('decision', 'ai_agent_decision').notNullable();
    t.decimal('confidence', 4, 3).nullable();
    t.integer('iterations').notNullable().defaultTo(1);
    t.text('error').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['organization_id', 'created_at']);
    t.index('conversation_id');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('ai_agent_traces');
  await knex.raw('DROP TYPE IF EXISTS ai_agent_decision');
  await knex.schema.dropTableIfExists('ai_usage_logs');
  await knex.raw('DROP TYPE IF EXISTS ai_usage_operation');
};
