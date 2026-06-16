// HTML → texto. Usa cheerio para remover tags estruturais/script e extrair
// o texto visível. Aceita Buffer ou string.

const cheerio = require('cheerio');

/**
 * @param {Buffer|string} input
 * @returns {{ text: string, metadata: object }}
 */
function parseHtml(input) {
  const html = Buffer.isBuffer(input) ? input.toString('utf-8') : String(input || '');
  const $ = cheerio.load(html);
  $('script, style, noscript, template, head').remove();

  const root = $('body').length ? $('body') : $.root();
  const text = root
    .text()
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text, metadata: {} };
}

module.exports = { parseHtml };
