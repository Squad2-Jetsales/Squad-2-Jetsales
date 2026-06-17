// server/src/modules/ai/ingestion/chunker.js
//
// Divisor de texto recursivo com sobreposição (overlap), no estilo do
// RecursiveCharacterTextSplitter. Recebe o texto bruto de um documento e o
// quebra em pedaços (chunks) que cabem em `chunkSize`, mantendo um overlap
// entre chunks consecutivos para preservar contexto na fronteira.
//
// Unidade de chunkSize/overlap: CARACTERES (não tokens). O `tokenCount` é
// calculado à parte via tiktoken (cl100k_base) — serve para custo/auditoria
// (ai_usage_logs / knowledge_chunks.token_count), não para o corte. Os
// defaults (1000/150) vêm de knowledge_bases.chunk_size / chunk_overlap.

const { get_encoding } = require('tiktoken');

// Hierarquia de separadores: tenta quebrar por parágrafo, depois linha, depois
// sentença, depois palavra e, por fim, caractere a caractere.
const DEFAULT_SEPARATORS = ['\n\n', '\n', '. ', ' ', ''];

// Byte nulo: o Postgres rejeita NUL em colunas text/jsonb, então removemos.
const NULL_CHAR = String.fromCharCode(0);

// Encoder é caro de criar; mantemos um singleton para o processo do worker.
let _encoder = null;
function getEncoder() {
  if (_encoder !== null) return _encoder;
  try {
    _encoder = get_encoding('cl100k_base');
  } catch (err) {
    console.warn('[chunker] tiktoken indisponível, usando heurística de tokens:', err.message);
    _encoder = false; // marca falha — não tenta de novo
  }
  return _encoder;
}

function countTokens(text) {
  const enc = getEncoder();
  if (!enc) return Math.ceil(text.length / 4); // ~4 chars/token
  try {
    return enc.encode(text).length;
  } catch {
    return Math.ceil(text.length / 4);
  }
}

function normalize(text) {
  if (!text) return '';
  return String(text)
    .split(NULL_CHAR)
    .join('') // remove bytes nulos (quebram o Postgres)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n') // espaços no fim da linha
    .replace(/\n{3,}/g, '\n\n') // colapsa linhas em branco excessivas
    .trim();
}

// Junta pedaços pequenos respeitando chunkSize e aplicando overlap na fronteira.
function mergeSplits(splits, separator, chunkSize, overlap) {
  const sepLen = separator.length;
  const chunks = [];
  let current = [];
  let total = 0;

  for (const piece of splits) {
    const addLen = piece.length + (current.length > 0 ? sepLen : 0);

    if (total + addLen > chunkSize && current.length > 0) {
      const joined = current.join(separator).trim();
      if (joined) chunks.push(joined);

      // Mantém uma cauda de ~overlap caracteres para o próximo chunk.
      while (
        current.length > 0 &&
        (total > overlap || total + addLen > chunkSize)
      ) {
        const removed = current.shift();
        total -= removed.length + (current.length > 0 ? sepLen : 0);
      }
    }

    current.push(piece);
    total += addLen;
  }

  const joined = current.join(separator).trim();
  if (joined) chunks.push(joined);
  return chunks;
}

// Quebra recursiva: desce na hierarquia de separadores até caber em chunkSize.
function splitRecursive(text, chunkSize, overlap, separators) {
  const separator = separators[0];
  const remaining = separators.slice(1);
  const splits = separator === '' ? Array.from(text) : text.split(separator);

  const finalChunks = [];
  let goodSplits = [];

  for (const piece of splits) {
    if (piece.length < chunkSize) {
      goodSplits.push(piece);
    } else {
      if (goodSplits.length) {
        finalChunks.push(...mergeSplits(goodSplits, separator, chunkSize, overlap));
        goodSplits = [];
      }
      if (remaining.length) {
        finalChunks.push(...splitRecursive(piece, chunkSize, overlap, remaining));
      } else {
        finalChunks.push(piece); // último recurso: pedaço maior que chunkSize
      }
    }
  }
  if (goodSplits.length) {
    finalChunks.push(...mergeSplits(goodSplits, separator, chunkSize, overlap));
  }
  return finalChunks;
}

/**
 * Quebra `rawText` em chunks.
 * @param {string} rawText
 * @param {{ chunkSize?: number, overlap?: number }} [opts]
 * @returns {Array<{ content: string, tokenCount: number, metadata: object }>}
 */
function chunkText(rawText, { chunkSize = 1000, overlap = 150 } = {}) {
  const text = normalize(rawText);
  if (!text) return [];

  const size = Number(chunkSize) > 0 ? Number(chunkSize) : 1000;
  const ov =
    Number(overlap) >= 0 && Number(overlap) < size
      ? Number(overlap)
      : Math.floor(size * 0.15);

  const pieces = splitRecursive(text, size, ov, DEFAULT_SEPARATORS);

  return pieces
    .map((content) => content.trim())
    .filter((content) => content.length > 0)
    .map((content, index) => ({
      content,
      tokenCount: countTokens(content),
      metadata: { chunkIndex: index },
    }));
}

module.exports = { chunkText, countTokens };
