// PDF → texto. Usa pdf-parse v2 (classe PDFParse, API baseada em pdfjs).

const { PDFParse } = require('pdf-parse');

/**
 * @param {Buffer} buffer
 * @returns {Promise<{ text: string, metadata: object }>}
 */
async function parsePdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return { text: result.text || '', metadata: { pages: result.total } };
  } finally {
    if (typeof parser.destroy === 'function') {
      await parser.destroy().catch(() => {});
    }
  }
}

module.exports = { parsePdf };
