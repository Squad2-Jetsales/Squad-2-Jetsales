// server/src/modules/ai/knowledge/upload.middleware.js
//
// Upload de documentos (multipart) via multer. Buffer em memória — o
// knowledge.service calcula o checksum e persiste via storage.js. Aceita
// também requests JSON (texto): nesse caso o multer é no-op e o body já veio
// do express.json. Limite e tipos vêm de env / whitelist.

const multer = require('multer');
const { httpError } = require('../../../middlewares/error.middleware');

const MAX_BYTES = Number(process.env.INGESTION_MAX_FILE_BYTES) || 20 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/html',
  'text/plain',
  'text/markdown',
]);
const ALLOWED_EXT = new Set(['.pdf', '.docx', '.doc', '.html', '.htm', '.txt', '.md', '.markdown']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = (file.originalname.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
    if (ALLOWED_MIME.has((file.mimetype || '').toLowerCase()) || ALLOWED_EXT.has(ext)) {
      return cb(null, true);
    }
    cb(httpError(400, `Tipo de arquivo não suportado: ${file.mimetype || ext || 'desconhecido'}`, 'UNSUPPORTED_FILE_TYPE'));
  },
});

const uploadSingle = upload.single('file');

// Wrapper: traduz erros do multer (ex.: tamanho) para httpError tratável pelo
// error.middleware, em vez de vazar o erro cru do multer.
function handleUpload(req, res, next) {
  uploadSingle(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(httpError(400, `Arquivo excede o limite de ${MAX_BYTES} bytes`, 'FILE_TOO_LARGE'));
    }
    return next(err);
  });
}

module.exports = { handleUpload };
