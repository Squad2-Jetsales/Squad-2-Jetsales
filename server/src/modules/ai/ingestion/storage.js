// server/src/modules/ai/ingestion/storage.js
//
// Armazenamento local dos arquivos enviados na ingestão. O banco guarda apenas
// o `storage_key` (caminho relativo); os bytes ficam em disco sob
// server/storage/uploads/<orgId>/<docId><ext>. Para migrar p/ S3 no futuro,
// basta reimplementar este módulo — a interface (save/read/remove/sha256) não
// muda e nada acima dela importa `fs` diretamente.

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

// server/src/modules/ai/ingestion → ../../../../ = server/
const STORAGE_ROOT = path.resolve(__dirname, '../../../../storage/uploads');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Impede path traversal: o key nunca pode escapar de STORAGE_ROOT.
function resolveKeyPath(storageKey) {
  const full = path.resolve(STORAGE_ROOT, storageKey);
  if (full !== STORAGE_ROOT && !full.startsWith(STORAGE_ROOT + path.sep)) {
    throw new Error('storageKey inválido (fora do diretório de uploads)');
  }
  return full;
}

/**
 * Persiste um buffer e devolve o storageKey relativo a guardar no banco.
 * @param {Buffer} buffer
 * @param {{ orgId: string, docId: string, ext?: string }} opts
 * @returns {Promise<string>} storageKey (ex.: "<orgId>/<docId>.pdf")
 */
async function save(buffer, { orgId, docId, ext = '' }) {
  const safeExt = !ext ? '' : ext.startsWith('.') ? ext : `.${ext}`;
  const storageKey = path.posix.join(orgId, `${docId}${safeExt}`);
  const full = resolveKeyPath(storageKey);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buffer);
  return storageKey;
}

async function read(storageKey) {
  return fs.readFile(resolveKeyPath(storageKey));
}

async function remove(storageKey) {
  if (!storageKey) return;
  try {
    await fs.unlink(resolveKeyPath(storageKey));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err; // já não existe → ok
  }
}

module.exports = { save, read, remove, sha256, STORAGE_ROOT };
