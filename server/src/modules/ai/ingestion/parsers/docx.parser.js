// DOCX → texto. Usa mammoth.extractRawText (ignora estilos, só o texto).

const mammoth = require('mammoth');

/**
 * @param {Buffer} buffer
 * @returns {Promise<{ text: string, metadata: object }>}
 */
async function parseDocx(buffer) {
  const { value } = await mammoth.extractRawText({ buffer });
  return { text: value || '', metadata: {} };
}

module.exports = { parseDocx };
