// server/src/modules/conversation/conversation.service.js
//
// Camada de regra de negócio entre controller e model. Por enquanto só repassa,
// mas é onde futuras validações (status transitions, regras de fechamento, etc.)
// vão morar.

const Conversation = require('./conversation.model');

const VALID_STATUS = ['open', 'closed', 'waiting', 'resolved'];

exports.VALID_STATUS = VALID_STATUS;

exports.list = (organizationId, filters) => Conversation.listWithContact(organizationId, filters);

exports.findById = (organizationId, id) => Conversation.findByIdWithDetail(organizationId, id);
