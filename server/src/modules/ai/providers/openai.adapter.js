// server/src/modules/ai/providers/openai.adapter.js
//
// Adapter OpenAI conforme contrato em provider.interface.js.
// Cobre chat + embeddings (Anthropic não embeda).

const OpenAI = require('openai');

const PROVIDER_NAME = 'openai';
const DEFAULT_CHAT_MODEL = process.env.AI_CHAT_MODEL || 'gpt-4o-mini';
const DEFAULT_EMBED_MODEL = process.env.AI_EMBEDDING_MODEL || 'text-embedding-3-small';

let client = null;
function getClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY não configurada');
  }
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

/* -------------------------------------------------------------------------- */
/*  Conversão de formato                                                      */
/* -------------------------------------------------------------------------- */

function toOpenAIMessages(messages) {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        tool_call_id: m.toolCallId,
      };
    }
    return { role: m.role, content: m.content, ...(m.name ? { name: m.name } : {}) };
  });
}

function toOpenAITools(tools) {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

function fromOpenAIResponse(resp, latencyMs) {
  const choice = resp.choices?.[0];
  const msg = choice?.message;
  const toolCalls = (msg?.tool_calls || []).map((tc) => ({
    id: tc.id,
    name: tc.function?.name,
    args: safeJsonParse(tc.function?.arguments),
  }));

  return {
    content: msg?.content || '',
    toolCalls,
    finishReason: mapFinishReason(choice?.finish_reason),
    usage: {
      promptTokens: resp.usage?.prompt_tokens ?? 0,
      completionTokens: resp.usage?.completion_tokens ?? 0,
      totalTokens: resp.usage?.total_tokens ?? 0,
    },
    model: resp.model,
    provider: PROVIDER_NAME,
    latencyMs,
    raw: resp,
  };
}

function safeJsonParse(s) {
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function mapFinishReason(reason) {
  if (reason === 'tool_calls' || reason === 'function_call') return 'tool_use';
  if (reason === 'length') return 'length';
  if (reason === 'stop') return 'stop';
  return 'stop';
}

/* -------------------------------------------------------------------------- */
/*  Implementação do contrato                                                 */
/* -------------------------------------------------------------------------- */

async function chat(req) {
  const c = getClient();
  const started = Date.now();
  const resp = await c.chat.completions.create({
    model: req.model || DEFAULT_CHAT_MODEL,
    temperature: req.temperature ?? Number(process.env.AI_TEMPERATURE_DEFAULT ?? 0.3),
    max_tokens: req.maxTokens || Number(process.env.AI_MAX_OUTPUT_TOKENS || 1024),
    messages: toOpenAIMessages(req.messages),
    tools: toOpenAITools(req.tools),
    tool_choice:
      typeof req.toolChoice === 'object' && req.toolChoice.name
        ? { type: 'function', function: { name: req.toolChoice.name } }
        : req.toolChoice === 'none'
        ? 'none'
        : req.tools?.length
        ? 'auto'
        : undefined,
  });
  const latencyMs = Date.now() - started;
  return fromOpenAIResponse(resp, latencyMs);
}

async function embed(req) {
  const c = getClient();
  if (!Array.isArray(req.input) || req.input.length === 0) {
    throw new Error('embed.input deve ser array não vazio de strings');
  }

  const started = Date.now();
  const resp = await c.embeddings.create({
    model: req.model || DEFAULT_EMBED_MODEL,
    input: req.input,
  });
  const latencyMs = Date.now() - started;

  const embeddings = resp.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);

  return {
    embeddings,
    usage: {
      promptTokens: resp.usage?.prompt_tokens ?? 0,
      totalTokens: resp.usage?.total_tokens ?? 0,
    },
    model: resp.model,
    provider: PROVIDER_NAME,
    dim: embeddings[0]?.length || 0,
    latencyMs,
  };
}

async function ping() {
  const started = Date.now();
  try {
    // Embedding é mais barato que chat — vira o ping default.
    const c = getClient();
    const resp = await c.embeddings.create({
      model: DEFAULT_EMBED_MODEL,
      input: 'ping',
    });
    return {
      ok: true,
      latencyMs: Date.now() - started,
      model: resp.model,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: err?.message || String(err),
    };
  }
}

module.exports = {
  name: PROVIDER_NAME,
  chat,
  embed,
  ping,
};
