// server/src/modules/ai/knowledge/knowledge.controller.js
//
// Camada fina: lê req.auth, valida input com zod (ZodError → 400 com fields no
// error.middleware) e delega ao knowledge.service. authRequired já roda no
// router pai (routes/index.js).

const { z } = require('zod');
const service = require('./knowledge.service');

/* -------------------------------- Schemas -------------------------------- */

const idParam = z.string().uuid('id inválido');

// A coluna knowledge_chunks.embedding é vector(1536) (fixa). Só aceitamos
// modelos que produzem 1536 dims — um modelo de outra dimensão (ex.:
// text-embedding-3-large = 3072) faria todo insert de chunk falhar.
const EMBEDDING_MODELS_1536 = ['text-embedding-3-small', 'text-embedding-ada-002'];
const embeddingModelField = z
  .enum(EMBEDDING_MODELS_1536, {
    errorMap: () => ({
      message: `embeddingModel deve ser de 1536 dims: ${EMBEDDING_MODELS_1536.join(' | ')}`,
    }),
  })
  .optional();

const createKbSchema = z.object({
  chatbotId: z.string().uuid('chatbotId inválido'),
  name: z.string().min(1, 'name é obrigatório').max(200),
  embeddingModel: embeddingModelField,
  chunkSize: z.number().int().min(100).max(8000).optional(),
  chunkOverlap: z.number().int().min(0).max(2000).optional(),
});

const updateKbSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    embeddingModel: embeddingModelField,
    chunkSize: z.number().int().min(100).max(8000).optional(),
    chunkOverlap: z.number().int().min(0).max(2000).optional(),
  })
  .strict();

const createDocSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  content: z.string().optional(),
  sourceUrl: z.string().url('sourceUrl inválida').optional(),
});

const listDocsQuerySchema = z.object({
  status: z.enum(['uploaded', 'indexing', 'indexed', 'failed']).optional(),
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/* ----------------------------- Knowledge bases ---------------------------- */

exports.listKbs = async (req, res, next) => {
  try {
    const { chatbotId } = req.query;
    if (chatbotId !== undefined) idParam.parse(chatbotId);
    res.json(await service.listKbs(req.auth.organizationId, { chatbotId }));
  } catch (err) {
    next(err);
  }
};

exports.getKb = async (req, res, next) => {
  try {
    const id = idParam.parse(req.params.id);
    res.json(await service.getKb(req.auth.organizationId, id));
  } catch (err) {
    next(err);
  }
};

exports.createKb = async (req, res, next) => {
  try {
    const body = createKbSchema.parse(req.body);
    const kb = await service.createKb(req.auth.organizationId, body);
    res.status(201).json(kb);
  } catch (err) {
    next(err);
  }
};

exports.updateKb = async (req, res, next) => {
  try {
    const id = idParam.parse(req.params.id);
    const patch = updateKbSchema.parse(req.body || {});
    res.json(await service.updateKb(req.auth.organizationId, id, patch));
  } catch (err) {
    next(err);
  }
};

exports.deleteKb = async (req, res, next) => {
  try {
    const id = idParam.parse(req.params.id);
    await service.deleteKb(req.auth.organizationId, id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};

/* -------------------------------- Documents ------------------------------- */

exports.listDocuments = async (req, res, next) => {
  try {
    const kbId = idParam.parse(req.params.id);
    const query = listDocsQuerySchema.parse(req.query);
    res.json(await service.listDocuments(req.auth.organizationId, kbId, query));
  } catch (err) {
    next(err);
  }
};

exports.createDocument = async (req, res, next) => {
  try {
    const kbId = idParam.parse(req.params.id);
    const body = createDocSchema.parse(req.body || {});
    const doc = await service.createDocument(req.auth.organizationId, kbId, {
      ...body,
      file: req.file || null,
    });
    res.status(202).json(doc);
  } catch (err) {
    next(err);
  }
};

exports.getDocument = async (req, res, next) => {
  try {
    const id = idParam.parse(req.params.id);
    res.json(await service.getDocument(req.auth.organizationId, id));
  } catch (err) {
    next(err);
  }
};

exports.deleteDocument = async (req, res, next) => {
  try {
    const id = idParam.parse(req.params.id);
    await service.deleteDocument(req.auth.organizationId, id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};

exports.reindexDocument = async (req, res, next) => {
  try {
    const id = idParam.parse(req.params.id);
    const job = await service.reindexDocument(req.auth.organizationId, id);
    res.status(202).json(job);
  } catch (err) {
    next(err);
  }
};
