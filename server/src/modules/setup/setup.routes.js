// server/src/modules/setup/setup.routes.js
//
// ⚠️  ROTA TEMPORÁRIA DE SETUP — USE UMA VEZ E REMOVA DO PROJETO ⚠️
//
// Como usar:
//   1. Adicione esta rota no app.js (instruções abaixo)
//   2. Faça deploy no Render
//   3. Acesse: POST https://seu-backend.onrender.com/api/v1/setup/seed
//      com o header:  X-Setup-Token: <valor de SETUP_SECRET no .env>
//   4. Confirme que retornou { ok: true }
//   5. REMOVA este arquivo e a linha do app.js — faça novo deploy
//
// Variável de ambiente necessária (adicione no Render):
//   SETUP_SECRET=qualquer-string-secreta-sua

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../../database');

const router = express.Router();

router.post('/seed', async (req, res) => {
  // Proteção por token secreto — nunca expõe sem autenticação
  const token = req.headers['x-setup-token'];
  const secret = process.env.SETUP_SECRET;

  if (!secret) {
    return res.status(500).json({ error: 'SETUP_SECRET não configurado nas variáveis de ambiente.' });
  }

  if (!token || token !== secret) {
    return res.status(401).json({ error: 'Token inválido. Informe o header X-Setup-Token correto.' });
  }

  try {
    // Verifica se o usuário já existe
    const existing = await db('users').where({ email: 'admin@jetgo.local' }).first();
    if (existing) {
      return res.json({
        ok: true,
        message: 'Usuário admin@jetgo.local já existe. Nenhuma alteração feita.',
        alreadyExisted: true,
      });
    }

    // Cria organização
    const [org] = await db('organizations')
      .insert({
        name: 'JetGO Local',
        slug: 'jetgo-local',
        plan: 'free',
        settings: {},
      })
      .returning('*');

    // Gera hash com bcryptjs — mesmo algoritmo usado no login
    const passwordHash = await bcrypt.hash('jetgo123', 10);

    // Cria usuário admin
    const [user] = await db('users')
      .insert({
        organization_id: org.id,
        name: 'Admin',
        email: 'admin@jetgo.local',
        password_hash: passwordHash,
        role: 'admin',
      })
      .returning('id', 'email', 'role');

    return res.json({
      ok: true,
      message: 'Usuário criado com sucesso!',
      user: { id: user.id, email: user.email, role: user.role },
      credentials: { email: 'admin@jetgo.local', password: 'jetgo123' },
    });
  } catch (err) {
    console.error('[setup/seed] erro:', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;