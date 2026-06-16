// Texto puro (txt/md) → string. Aceita Buffer ou string.

/**
 * @param {Buffer|string} input
 * @returns {{ text: string, metadata: object }}
 */
function parseText(input) {
  const text = Buffer.isBuffer(input) ? input.toString('utf-8') : String(input || '');
  return { text, metadata: {} };
}

module.exports = { parseText };
