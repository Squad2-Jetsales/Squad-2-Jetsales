// server/src/modules/ai/engine/tools/index.js
//
// Registry das tools do agente. Chave = nome exposto ao LLM; valor = módulo
// { definition, execute }. O tool.router lê daqui para montar os defs e
// despachar a execução.

const searchKb = require('./search-kb');
const captureField = require('./capture-field');
const transferToHuman = require('./transfer-to-human');
const triggerFlow = require('./trigger-flow');

const TOOLS = {
  search_kb: searchKb,
  capture_field: captureField,
  transfer_to_human: transferToHuman,
  trigger_flow: triggerFlow,
};

module.exports = { TOOLS };
