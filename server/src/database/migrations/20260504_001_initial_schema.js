/**
 * Migration inicial — schema completo do JetGO.
 *
 * Tabelas criadas (na ordem certa para FKs):
 *   organizations · users · chatbots · flows · flow_nodes · flow_edges
 *   whatsapp_connections · contacts · conversations · messages · tickets
 *   knowledge_bases · knowledge_documents · refresh_tokens
 *
 * Convenções:
 *   - PKs em UUID (gen_random_uuid via pgcrypto) para casar com o front.
 *   - Toda tabela tenant-aware tem organization_id + índice.
 *   - timestamps default now(); updated_at é mantido em código (knex helper).
 */

exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  /* -------------------- organizations & users -------------------- */

  await knex.schema.createTable('organizations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name').notNullable();
    t.string('slug').notNullable().unique();
    t.string('plan').notNullable().defaultTo('free');
    t.jsonb('settings').notNullable().defaultTo('{}');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('users', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.string('name').notNullable();
    t.string('email').notNullable();
    t.string('password_hash').notNullable();
    t.enu('role', ['admin', 'operator'], { useNative: true, enumName: 'user_role' }).notNullable().defaultTo('operator');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['organization_id', 'email']);
    t.index('email');
  });

  // Refresh tokens — armazenamos hash + jti para rotação/revogação
  await knex.schema.createTable('refresh_tokens', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('token_hash').notNullable();
    t.string('jti').notNullable().unique();
    t.timestamp('expires_at').notNullable();
    t.timestamp('revoked_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index('user_id');
  });

  /* -------------------- chatbots -------------------- */

  await knex.schema.createTable('chatbots', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.uuid('active_flow_id').nullable(); // FK adicionada depois (ciclo flows<->chatbots)
    t.string('name').notNullable();
    t.text('description').notNullable().defaultTo('');
    t.enu('type', ['manual', 'ai_generated', 'ai_agent'], {
      useNative: true,
      enumName: 'chatbot_type',
    }).notNullable().defaultTo('manual');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.jsonb('ai_config').nullable();
    t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index('organization_id');
    t.index(['organization_id', 'is_active']);
  });

  /* -------------------- flows / nodes / edges -------------------- */

  await knex.schema.createTable('flows', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('chatbot_id').notNullable().references('id').inTable('chatbots').onDelete('CASCADE');
    t.string('name').notNullable();
    t.enu('status', ['draft', 'published'], { useNative: true, enumName: 'flow_status' }).notNullable().defaultTo('draft');
    t.integer('version').notNullable().defaultTo(1);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index('chatbot_id');
  });

  // Agora podemos amarrar chatbots.active_flow_id -> flows.id
  await knex.schema.alterTable('chatbots', (t) => {
    t.foreign('active_flow_id').references('id').inTable('flows').onDelete('SET NULL');
  });

  await knex.schema.createTable('flow_nodes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('flow_id').notNullable().references('id').inTable('flows').onDelete('CASCADE');
    t.enu(
      'type',
      ['trigger', 'message', 'menu', 'condition', 'wait', 'capture', 'integration', 'end'],
      { useNative: true, enumName: 'flow_node_type' }
    ).notNullable();
    t.jsonb('data').notNullable().defaultTo('{}');
    t.double('position_x').notNullable().defaultTo(0);
    t.double('position_y').notNullable().defaultTo(0);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index('flow_id');
  });

  await knex.schema.createTable('flow_edges', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('flow_id').notNullable().references('id').inTable('flows').onDelete('CASCADE');
    t.uuid('source_node_id').notNullable().references('id').inTable('flow_nodes').onDelete('CASCADE');
    t.uuid('target_node_id').notNullable().references('id').inTable('flow_nodes').onDelete('CASCADE');
    t.string('source_handle').nullable();
    t.string('condition_type').nullable();
    t.text('condition_value').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index('flow_id');
    t.index('source_node_id');
  });

  /* -------------------- whatsapp connections -------------------- */

  await knex.schema.createTable('whatsapp_connections', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.uuid('chatbot_id').nullable().references('id').inTable('chatbots').onDelete('SET NULL');
    t.string('name').notNullable();
    t.string('phone_number').notNullable().defaultTo('');
    t.string('evolution_instance').notNullable().unique(); // nome da instância na Evolution API
    t.enu('status', ['connected', 'disconnected', 'pending_qr'], {
      useNative: true,
      enumName: 'whatsapp_status',
    }).notNullable().defaultTo('pending_qr');
    t.text('qr_code').nullable();
    t.timestamp('qr_expires_at').nullable();
    t.timestamp('last_activity_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index('organization_id');
  });

  /* -------------------- contacts / conversations / messages -------------------- */

  await knex.schema.createTable('contacts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.string('phone').notNullable();
    t.string('name').notNullable().defaultTo('');
    t.jsonb('custom_fields').notNullable().defaultTo('{}');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['organization_id', 'phone']);
  });

  await knex.schema.createTable('conversations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.uuid('contact_id').notNullable().references('id').inTable('contacts').onDelete('CASCADE');
    t.uuid('chatbot_id').notNullable().references('id').inTable('chatbots').onDelete('CASCADE');
    t.uuid('whatsapp_connection_id').nullable().references('id').inTable('whatsapp_connections').onDelete('SET NULL');
    t.enu('status', ['open', 'closed', 'waiting', 'resolved'], {
      useNative: true,
      enumName: 'conversation_status',
    }).notNullable().defaultTo('open');
    t.string('current_flow_path').nullable();
    t.jsonb('flow_context').notNullable().defaultTo('{}');
    t.uuid('current_node_id').nullable(); // ponteiro do FlowEngine
    t.integer('unread_count').notNullable().defaultTo(0);
    t.text('last_message_preview').nullable();
    t.timestamp('last_message_at').nullable();
    t.timestamp('closed_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['organization_id', 'status']);
    t.index('contact_id');
  });

  await knex.schema.createTable('messages', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('conversation_id').notNullable().references('id').inTable('conversations').onDelete('CASCADE');
    t.uuid('flow_node_id').nullable().references('id').inTable('flow_nodes').onDelete('SET NULL');
    t.enu('direction', ['in', 'out'], { useNative: true, enumName: 'message_direction' }).notNullable();
    t.text('content').notNullable();
    t.jsonb('metadata').notNullable().defaultTo('{}');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['conversation_id', 'created_at']);
  });

  /* -------------------- tickets -------------------- */

  await knex.schema.createTable('tickets', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.uuid('conversation_id').notNullable().references('id').inTable('conversations').onDelete('CASCADE');
    t.uuid('assigned_to').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.enu('status', ['open', 'in_progress', 'closed'], {
      useNative: true,
      enumName: 'ticket_status',
    }).notNullable().defaultTo('open');
    t.enu('priority', ['low', 'medium', 'high'], {
      useNative: true,
      enumName: 'ticket_priority',
    }).notNullable().defaultTo('medium');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['organization_id', 'status']);
  });

  /* -------------------- knowledge bases -------------------- */

  await knex.schema.createTable('knowledge_bases', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.uuid('chatbot_id').notNullable().references('id').inTable('chatbots').onDelete('CASCADE');
    t.string('name').notNullable();
    t.string('embedding_model').notNullable().defaultTo('text-embedding-3-small');
    t.integer('chunk_size').notNullable().defaultTo(1000);
    t.integer('chunk_overlap').notNullable().defaultTo(150);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index('chatbot_id');
  });

  await knex.schema.createTable('knowledge_documents', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('knowledge_base_id').notNullable().references('id').inTable('knowledge_bases').onDelete('CASCADE');
    t.string('title').notNullable();
    t.text('content').nullable();
    t.string('source_url').nullable();
    t.jsonb('metadata').notNullable().defaultTo('{}');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index('knowledge_base_id');
  });
};

exports.down = async function down(knex) {
  // Drop em ordem inversa para respeitar FKs.
  await knex.schema.dropTableIfExists('knowledge_documents');
  await knex.schema.dropTableIfExists('knowledge_bases');
  await knex.schema.dropTableIfExists('tickets');
  await knex.schema.dropTableIfExists('messages');
  await knex.schema.dropTableIfExists('conversations');
  await knex.schema.dropTableIfExists('contacts');
  await knex.schema.dropTableIfExists('whatsapp_connections');
  await knex.schema.dropTableIfExists('flow_edges');
  await knex.schema.dropTableIfExists('flow_nodes');

  // Quebra FK circular antes de dropar flows
  await knex.schema.alterTable('chatbots', (t) => {
    t.dropForeign('active_flow_id');
  });
  await knex.schema.dropTableIfExists('flows');
  await knex.schema.dropTableIfExists('chatbots');
  await knex.schema.dropTableIfExists('refresh_tokens');
  await knex.schema.dropTableIfExists('users');
  await knex.schema.dropTableIfExists('organizations');

  // Drop dos enums (Postgres não dropa junto com a tabela)
  for (const enumName of [
    'user_role',
    'chatbot_type',
    'flow_status',
    'flow_node_type',
    'whatsapp_status',
    'conversation_status',
    'message_direction',
    'ticket_status',
    'ticket_priority',
  ]) {
    await knex.raw(`DROP TYPE IF EXISTS ${enumName}`);
  }
};
