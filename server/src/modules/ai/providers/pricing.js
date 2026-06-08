// server/src/modules/ai/providers/pricing.js
//
// Cálculo de custo em USD por chamada. Preços vêm das env vars (atualize quando
// o provider mudar tabela). Tudo aqui é USD por 1 milhão de tokens.

function n(envVar, fallback) {
  const v = Number(process.env[envVar]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

const PRICING = {
  anthropic: {
    inputPer1M: () => n('COST_ANTHROPIC_INPUT_PER_1M', 3.0),
    outputPer1M: () => n('COST_ANTHROPIC_OUTPUT_PER_1M', 15.0),
  },
  openai: {
    inputPer1M: () => n('COST_OPENAI_INPUT_PER_1M', 0.15),
    outputPer1M: () => n('COST_OPENAI_OUTPUT_PER_1M', 0.60),
    embedPer1M: () => n('COST_OPENAI_EMBED_PER_1M', 0.02),
  },
};

/**
 * @param {Object} args
 * @param {'openai' | 'anthropic'} args.provider
 * @param {'chat' | 'embed' | 'rerank'} args.operation
 * @param {number} args.promptTokens
 * @param {number} [args.completionTokens]
 * @returns {number} custo em USD (até 6 casas)
 */
function calcCostUsd({ provider, operation, promptTokens = 0, completionTokens = 0 }) {
  const table = PRICING[provider];
  if (!table) return 0;

  if (operation === 'embed') {
    const per1M = table.embedPer1M?.() ?? 0;
    return round6((promptTokens / 1_000_000) * per1M);
  }

  if (operation === 'chat' || operation === 'rerank') {
    const inUsd = (promptTokens / 1_000_000) * (table.inputPer1M?.() ?? 0);
    const outUsd = (completionTokens / 1_000_000) * (table.outputPer1M?.() ?? 0);
    return round6(inUsd + outUsd);
  }

  return 0;
}

function round6(n) {
  return Math.round(n * 1_000_000) / 1_000_000;
}

module.exports = { calcCostUsd };
