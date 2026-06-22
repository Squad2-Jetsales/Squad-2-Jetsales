// server/src/modules/ai/knowledge/upload.middleware.js
//
// Upload de documentos (multipart) via multer. Buffer em memória — o
// knowledge.service calcula o checksum e persiste via storage.js. Aceita
// também requests JSON (texto): nesse caso o multer é no-op e o body já veio
// do express.json. Limite e tipos vêm de env / whitelist.

const multer = require('multer');
const { httpError } = require('../../../middlewares/error.middleware');

const MAX_BYTES = Number(process.env.INGESTION_MAX_FILE_BYTES) || 20 * 1024 * 1024;

// Nota: `.doc` (Word legado/binário) NÃO é aceito — o parser usa `mammoth`,
// que só lê `.docx` (OOXML). Aceitar `.doc` garantiria falha na ingestão.
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/html',
  'text/plain',
  'text/markdown',
]);
const ALLOWED_EXT = new Set(['.pdf', '.docx', '.html', '.htm', '.txt', '.md', '.markdown']);

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
    // Qualquer erro do multer (tamanho, campo inesperado, etc.) é input ruim → 400.
    if (err instanceof multer.MulterError) {
      const msg =
        err.code === 'LIMIT_FILE_SIZE'
          ? `Arquivo excede o limite de ${MAX_BYTES} bytes`
          : err.code === 'LIMIT_UNEXPECTED_FILE'
            ? "Campo de arquivo inesperado — use o campo 'file'"
            : `Falha no upload do arquivo: ${err.message}`;
      return next(httpError(400, msg, err.code));
    }
    return next(err);
  });
}

module.exports = { handleUpload };
