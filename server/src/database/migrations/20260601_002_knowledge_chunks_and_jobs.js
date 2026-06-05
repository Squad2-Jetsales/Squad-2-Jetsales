/**
 * F3.1 — Tabelas de chunks e jobs de ingestão + patches em knowledge_documents.
 *
 * - `knowledge_chunks` guarda os pedaços vetorizados (embedding pgvector).
 * - `knowledge_ingestion_jobs` rastreia o ciclo de vida do processamento async.
 * - `knowledge_documents` ganha status + metadados de arquivo.
 *
 * Convenções: PKs UUID, snake_case, índices em FKs e campos quentes.
 *
 * Dimensão do embedding: 1536 (text-embedding-3-small).
 * Se trocar de modelo com dimensão diferente, criar nova migration + tabela
 * separada (não dá pra ALTER vector dim sem perda).
 */

const EMBEDDING_DIM = 1536;

exports.up = async function up(knex) {
  /* -------------------- knowledge_chunks -------------------- */

  await knex.raw(`
    CREATE TABLE knowledge_chunks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id uuid NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
      knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
      chunk_index integer NOT NULL,
      content text NOT NULL,
      token_count integer NOT NULL DEFAULT 0,
      embedding vector(${EMBEDDING_DIM}) NOT NULL,
      embedding_model varchar(120) NOT NULL DEFAULT 'text-embedding-3-small',
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamp NOT NULL DEFAULT now(),
      UNIQUE (document_id, chunk_index)
    )
  `);

  await knex.raw('CREATE INDEX knowledge_chunks_kb_idx ON knowledge_chunks(knowledge_base_id)');
  await knex.raw('CREATE INDEX knowledge_chunks_doc_idx ON knowledge_chunks(document_id)');

  // Índice HNSW para busca por similaridade de cosseno.
  // Notas:
  //  - HNSW requer pgvector >= 0.5.0 (disponível em pgvector/pgvector:pg15).
  //  - Em datasets pequenos (<10k chunks) a busca sequencial é mais rápida
  //    que HNSW, mas mantemos o índice pronto para escalar.
  await knex.raw(`
    CREATE INDEX knowledge_chunks_embedding_idx
      ON knowledge_chunks
      USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64)
  `);

  /* -------------------- knowledge_ingestion_jobs -------------------- */

  await knex.schema.createTable('knowledge_ingestion_jobs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('document_id')
      .notNullable()
      .references('id')
      .inTable('knowledge_documents')
      .onDelete('CASCADE');
    t.enu('status', ['pending', 'processing', 'succeeded', 'failed'], {
      useNative: true,
      enumName: 'ingestion_job_status',
    })
      .notNullable()
      .defaultTo('pending');
    t.text('error').nullable();
    t.integer('tokens_used').notNullable().defaultTo(0);
    t.integer('chunk_count').notNullable().defaultTo(0);
    t.integer('attempts').notNullable().defaultTo(0);
    t.timestamp('started_at').nullable();
    t.timestamp('finished_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index('document_id');
    t.index(['status', 'created_at']);
  });

  /* -------------------- patch knowledge_documents -------------------- */

  await knex.raw(`
    CREATE TYPE knowledge_document_status AS ENUM
      ('uploaded', 'indexing', 'indexed', 'failed')
  `);

  await knex.schema.alterTable('knowledge_documents', (t) => {
    t.specificType('status', 'knowledge_document_status')
      .notNullable()
      .defaultTo('uploaded');
    t.string('mime_type', 120).nullable();
    t.bigInteger('file_size_bytes').nullable();
    t.string('storage_key', 500).nullable();
    t.string('checksum', 128).nullable();
    t.integer('chunk_count').notNullable().defaultTo(0);
    t.integer('tokens_used').notNullable().defaultTo(0);
    t.timestamp('indexed_at').nullable();
    t.index(['knowledge_base_id', 'status']);
    t.index('checksum');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('knowledge_documents', (t) => {
    t.dropIndex('checksum');
    t.dropIndex(['knowledge_base_id', 'status']);
    t.dropColumn('indexed_at');
    t.dropColumn('tokens_used');
    t.dropColumn('chunk_count');
    t.dropColumn('checksum');
    t.dropColumn('storage_key');
    t.dropColumn('file_size_bytes');
    t.dropColumn('mime_type');
    t.dropColumn('status');
  });

  await knex.raw('DROP TYPE IF EXISTS knowledge_document_status');
  await knex.schema.dropTableIfExists('knowledge_ingestion_jobs');
  await knex.raw('DROP TYPE IF EXISTS ingestion_job_status');
  await knex.raw('DROP TABLE IF EXISTS knowledge_chunks');
};
