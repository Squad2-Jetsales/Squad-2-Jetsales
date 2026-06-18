// server/src/modules/ai/engine/tool.router.js
//
// Ponte entre o loop do agent.engine e as tools concretas. Duas
// responsabilidades:
//   getToolDefs(enabledTools) → defs (JSON Schema) que vão para o provider.
//   execute(toolCall, ctx)    → despacha a execução e normaliza o retorno.
//
// O whitelist (chatbot.aiConfig.enabledTools) é aplicado nas duas pontas: o LLM
// só vê as tools habilitadas e, por defesa, a execução também recusa tool fora
// da lista.

const { TOOLS } = require('./tools');

function resolveEnabledNames(enabledTools) {
  if (Array.isArray(enabledTools) && enabledTools.length) {
    return enabledTools.filter((name) => TOOLS[name]);
  }
  return Object.keys(TOOLS);
}

function getToolDefs(enabledTools) {
  return resolveEnabledNames(enabledTools).map((name) => TOOLS[name].definition);
}

async function execute(toolCall, ctx) {
  const name = toolCall?.name;
  const tool = TOOLS[name];

  if (!tool) {
    return { result: { error: `tool desconhecida: ${name}` } };
  }

  const enabled = resolveEnabledNames(ctx?.aiConfig?.enabledTools);
  if (!enabled.includes(name)) {
    return { result: { error: `tool não habilitada: ${name}` } };
  }

  try {
    return await tool.execute(toolCall.args || {}, ctx);
  } catch (err) {
    console.error(`[tool.router] erro ao executar ${name}: ${err.message}`);
    return { result: { error: err.message } };
  }
}

module.exports = { getToolDefs, execute };
