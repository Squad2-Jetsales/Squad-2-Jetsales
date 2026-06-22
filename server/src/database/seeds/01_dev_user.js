// Seed de desenvolvimento — cria 1 organização e 1 usuário admin.
// Login: admin@jetgo.local / jetgo123
const bcrypt = require('bcryptjs');

exports.seed = async function seed(knex) {
  const existing = await knex('users').where({ email: 'admin@jetgo.local' }).first();
  if (existing) {
    console.log('[seed] usuário dev já existe — pulando');
    return;
  }

  const [org] = await knex('organizations')
    .insert({ name: 'JetGO Demo', slug: 'jetgo-demo', plan: 'free' })
    .returning('*');

  const passwordHash = await bcrypt.hash('jetgo123', 10);

  await knex('users').insert({
    organization_id: org.id,
    name: 'Admin Dev',
    email: 'admin@jetgo.local',
    password_hash: passwordHash,
    role: 'admin',
  });

  console.log('[seed] criado admin@jetgo.local / jetgo123');
};
