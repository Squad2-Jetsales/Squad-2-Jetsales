// server/src/modules/ai/providers/anthropic.adapter.js
//
// Adapter Anthropic conforme contrato em provider.interface.js.
// Usa @anthropic-ai/sdk oficial.

const Anthropic = require('@anthropic-ai/sdk');

const PROVIDER_NAME = 'anthropic';
const DEFAULT_MODEL = process.env.AI_CHAT_MODEL || 'claude-sonnet-4-6';

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY não configurada');
  }
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

/* -------------------------------------------------------------------------- */
/*  Helpers de conversão (formato do contrato → formato Anthropic)            */
/* -------------------------------------------------------------------------- */

function toAnthropicMessages(messages) {
  // Anthropic separa `system` em campo próprio. O resto vai em `messages`.
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');

  const turns = messages
    .filter((m) => m.role !== 'system')
    .map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: m.toolCallId,
              content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
            },
          ],
        };
      }
      return { role: m.role, content: m.content };
    });

  return { system, messages: turns };
}

function toAnthropicTools(tools) {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

function fromAnthropicResponse(resp, latencyMs) {
  const blocks = resp.content || [];
  let textOut = '';
  const toolCalls = [];

  for (const b of blocks) {
    if (b.type === 'text') textOut += b.text;
    else if (b.type === 'tool_use') {
      toolCalls.push({ id: b.id, name: b.name, args: b.input || {} });
    }
  }

  return {
    content: textOut,
    toolCalls,
    finishReason: mapStopReason(resp.stop_reason),
    usage: {
      promptTokens: resp.usage?.input_tokens ?? 0,
      completionTokens: resp.usage?.output_tokens ?? 0,
      totalTokens: (resp.usage?.input_tokens ?? 0) + (resp.usage?.output_tokens ?? 0),
    },
    model: resp.model,
    provider: PROVIDER_NAME,
    latencyMs,
    raw: resp,
  };
}

function mapStopReason(reason) {
  if (reason === 'tool_use') return 'tool_use';
  if (reason === 'end_turn' || reason === 'stop_sequence') return 'stop';
  if (reason === 'max_tokens') return 'length';
  return 'stop';
}

/* -------------------------------------------------------------------------- */
/*  Implementação do contrato                                                 */
/* -------------------------------------------------------------------------- */

async function chat(req) {
  const c = getClient();
  const { system, messages } = toAnthropicMessages(req.messages);

  const started = Date.now();
  const resp = await c.messages.create({
    model: req.model || DEFAULT_MODEL,
    max_tokens: req.maxTokens || Number(process.env.AI_MAX_OUTPUT_TOKENS || 1024),
    temperature: req.temperature ?? Number(process.env.AI_TEMPERATURE_DEFAULT ?? 0.3),
    system: system || undefined,
    messages,
    tools: toAnthropicTools(req.tools),
    tool_choice:
      typeof req.toolChoice === 'object' && req.toolChoice.name
        ? { type: 'tool', name: req.toolChoice.name }
        : req.toolChoice === 'none'
        ? { type: 'none' }
        : undefined,
  });
  const latencyMs = Date.now() - started;

  return fromAnthropicResponse(resp, latencyMs);
}

async function embed() {
  // Anthropic não expõe API pública de embeddings.
  // O sistema usa OpenAI (ou compatível) para embedding.
  throw new Error(
    'AnthropicAdapter.embed: provider não oferece embeddings — use AI_EMBEDDING_PROVIDER=openai'
  );
}

async function ping() {
  const started = Date.now();
  try {
    const c = getClient();
    const resp = await c.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'ping' }],
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
