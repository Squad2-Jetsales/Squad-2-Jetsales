// server/src/modules/ai/providers/provider.interface.js
//
// Contrato que TODO adapter de LLM deve cumprir.
// Permite trocar OpenAI ↔ Anthropic sem tocar no AgentEngine/RAG.
//
// Não é interface "estática" em JS — usamos JSDoc para documentar o shape
// esperado e testes contra o contrato.

/**
 * @typedef {Object} ChatMessage
 * @property {'system' | 'user' | 'assistant' | 'tool'} role
 * @property {string} content
 * @property {string} [name]      // p/ tool messages
 * @property {string} [toolCallId] // p/ tool messages
 */

/**
 * @typedef {Object} ChatToolDef
 * @property {string} name
 * @property {string} description
 * @property {object} parameters  JSON Schema
 */

/**
 * @typedef {Object} ChatRequest
 * @property {ChatMessage[]} messages
 * @property {string} [model]
 * @property {number} [temperature]
 * @property {number} [maxTokens]
 * @property {ChatToolDef[]} [tools]
 * @property {{ name: string } | 'auto' | 'none'} [toolChoice]
 */

/**
 * @typedef {Object} ChatToolCall
 * @property {string} id
 * @property {string} name
 * @property {Record<string, unknown>} args
 */

/**
 * @typedef {Object} ChatResponse
 * @property {string} content                  Texto da resposta (vazio se só tool_use)
 * @property {ChatToolCall[]} toolCalls        Lista de tool calls (vazio se só texto)
 * @property {'stop' | 'tool_use' | 'length' | 'error'} finishReason
 * @property {{ promptTokens: number; completionTokens: number; totalTokens: number }} usage
 * @property {string} model
 * @property {string} provider                 'openai' | 'anthropic'
 * @property {number} latencyMs
 * @property {unknown} [raw]                   Resposta crua p/ debug (não persistir bruto)
 */

/**
 * @typedef {Object} EmbedRequest
 * @property {string[]} input         Batch de strings
 * @property {string} [model]
 */

/**
 * @typedef {Object} EmbedResponse
 * @property {number[][]} embeddings   Mesma ordem do input
 * @property {{ promptTokens: number; totalTokens: number }} usage
 * @property {string} model
 * @property {string} provider
 * @property {number} dim
 * @property {number} latencyMs
 */

/**
 * @typedef {Object} LLMProvider
 * @property {string} name                                          'openai' | 'anthropic'
 * @property {(req: ChatRequest) => Promise<ChatResponse>} chat
 * @property {(req: EmbedRequest) => Promise<EmbedResponse>} embed
 * @property {() => Promise<{ ok: boolean; latencyMs: number; model?: string; error?: string }>} ping
 */

module.exports = {};
