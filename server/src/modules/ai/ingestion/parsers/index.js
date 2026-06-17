// server/src/modules/ai/ingestion/parsers/index.js
//
// Facade dos parsers. `parseDocument(doc)` recebe a linha de knowledge_documents
// e devolve o texto bruto, escolhendo o parser por mime_type/extensão.
//
// Dois caminhos de origem:
//   - Arquivo em disco (storage_key) → lê os bytes e parseia por tipo.
//   - Texto inline (content) → usado direto (md/txt) ou limpo (html).
// `source_url` é apenas proveniência (metadata); F3.2 não faz fetch remoto.

const storage = require('../storage');
const { parsePdf } = require('./pdf.parser');
const { parseDocx } = require('./docx.parser');
const { parseHtml } = require('./html.parser');
const { parseText } = require('./text.parser');

// Decide o tipo pelo mime_type e, como fallback, pela extensão do arquivo/título.
function pickKind({ mimeType = '', storageKey = '', title = '' }) {
  const m = (mimeType || '').toLowerCase();
  const name = (storageKey || title || '').toLowerCase();

  if (m.includes('pdf') || name.endsWith('.pdf')) return 'pdf';
  // Só DOCX (OOXML) — `.doc` legado não é suportado pelo mammoth (e é barrado no upload).
  if (m.includes('wordprocessingml') || name.endsWith('.docx')) return 'docx';
  if (m.includes('html') || name.endsWith('.html') || name.endsWith('.htm')) return 'html';
  return 'text'; // text/plain, text/markdown, .txt, .md
}

/**
 * @param {object} doc - linha de knowledge_documents (snake_case)
 * @returns {Promise<string>} texto bruto extraído
 */
async function parseDocument(doc) {
  const kind = pickKind({
    mimeType: doc.mime_type,
    storageKey: doc.storage_key,
    title: doc.title,
  });

  // Documento com arquivo em disco → lê os bytes e parseia.
  if (doc.storage_key) {
    const buffer = await storage.read(doc.storage_key);
    let res;
    if (kind === 'pdf') res = await parsePdf(buffer);
    else if (kind === 'docx') res = await parseDocx(buffer);
    else if (kind === 'html') res = parseHtml(buffer);
    else res = parseText(buffer);
    return res.text || '';
  }

  // Documento de texto inline (content).
  if (doc.content != null && String(doc.content).trim() !== '') {
    return kind === 'html' ? parseHtml(doc.content).text : String(doc.content);
  }

  return '';
}

module.exports = { parseDocument, pickKind };
