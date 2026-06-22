// server/src/modules/ai/knowledge/knowledge.guards.js
//
// Guards de tenancy. Toda operação em KB/documento passa por aqui antes de
// tocar dados — garante que o recurso pertence à org do request (CLAUDE.md §9).
// knowledge_bases tem organization_id direto; knowledge_documents herda via
// JOIN na KB.

const db = require('../../../database');
const { httpError } = require('../../../middlewares/error.middleware');

async function assertKbOwned(organizationId, kbId) {
  const kb = await db('knowledge_bases')
    .where({ id: kbId, organization_id: organizationId })
    .first();
  if (!kb) throw httpError(404, 'Base de conhecimento não encontrada', 'KB_NOT_FOUND');
  return kb;
}

async function assertDocOwned(organizationId, documentId) {
  const doc = await db('knowledge_documents as d')
    .join('knowledge_bases as kb', 'kb.id', 'd.knowledge_base_id')
    .where('d.id', documentId)
    .andWhere('kb.organization_id', organizationId)
    .select('d.*')
    .first();
  if (!doc) throw httpError(404, 'Documento não encontrado', 'DOCUMENT_NOT_FOUND');
  return doc;
}

module.exports = { assertKbOwned, assertDocOwned };
