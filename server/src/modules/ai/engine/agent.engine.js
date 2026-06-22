// server/src/modules/ai/engine/agent.engine.js
//
// AgentEngine (F3.4) — motor do chatbot nível 3 (AI Agent). Fluxo de run():
//   1. Pré-recuperação RAG (rag.service.retrieve, assinatura tenant-aware F3.3).
//   2. context.builder monta system + histórico + contexto recuperado.
//   3. Loop tool-use nativo do provider: chat → se tool_use, executa tool e
//      REALIMENTA (turno assistant com toolCalls + turno tool com o resultado)
//      → repete até resposta final, decisão terminal ou maxIterations.
//   4. Confidence (heurística sobre score das citações) → fallback se baixa.
//   5. Persiste trace em ai_agent_traces.
//
// Contrato (consumido pelo webhook.service.processBotResponse):
//   run({ chatbot, conversation, contact, userInput })
//     → { reply, citations, toolsCalled, decision, confidence, traceId, fallbackFlowId }
//
// Tenancy: organizationId vem SEMPRE de conversation.organization_id (nunca do
// payload). O provider é resolvido pela factory (nunca adapter direto). Todo
// custo de chat é auditado em ai_usage_logs.

const ragService = require('../rag/rag.service');
const contextBuilder = require('./context.builder');
const toolRouter = require('./tool.router');
const traceLogger = require('../observability/trace.logger');
const { resolveChatProvider } = require('../providers');
const { logUsage } = require('../observability/usage.logger');

const DEFAULT_MAX_ITERATIONS = Number(process.env.AI_MAX_AGENT_ITERATIONS) || 4;
const DEFAULT_MIN_CONFIDENCE = 0.65;

// Confiança heurística: score médio das citações (+0.1 se houve qualquer
// citação). Sem citações → 0. F3.7 pode refinar com sinais do próprio LLM.
function computeConfidence(citations) {
  if (!citations.length) return 0;
  const avg = citations.reduce((sum, c) => sum + (Number(c.score) || 0), 0) / citations.length;
  return Math.min(1, avg + 0.1);
}

// Pré-recuperação + search_kb podem trazer o mesmo chunk; dedupe por chunkId.
function dedupeCitations(citations) {
  const seen = new Set();
  const out = [];
  for (const c of citations) {
    const key = c.chunkId || `${c.documentId}:${(c.snippet || '').slice(0, 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

async function run({ chatbot, conversation, contact, userInput }) {
  const organizationId = conversation.organization_id;
  const aiConfig = chatbot.ai_config || {};
  const kbId = aiConfig.knowledgeBaseId;
  const minConfidence = Number.isFinite(Number(aiConfig.minConfidence))
    ? Number(aiConfig.minConfidence)
    : DEFAULT_MIN_CONFIDENCE;
  const maxIterations = Number.isFinite(Number(aiConfig.maxIterations))
    ? Math.max(1, Math.floor(Number(aiConfig.maxIterations)))
    : DEFAULT_MAX_ITERATIONS;
  const temperature = Number.isFinite(Number(aiConfig.temperature))
    ? Number(aiConfig.temperature)
    : undefined;

  const provider = resolveChatProvider();
  const collectedCitations = [];
  const toolsCalled = [];
  let finalDecision = 'answered';
  let finalContent = '';
  let iterations = 0;
  let promptSummary = {};

  try {
    // 1. Pré-recuperação RAG (assinatura F3.3: organizationId, kbId, query, opts).
    if (kbId) {
      const res = await ragService.retrieve(organizationId, kbId, userInput, {
        topKReturn: aiConfig.topK,
      });
      collectedCitations.push(...(res.citations || []));
    }

    // 2. Contexto inicial.
    const built = await contextBuilder.build({
      chatbot,
      conversation,
      contact,
      userInput,
      citations: collectedCitations.slice(),
    });
    let messages = built.messages;
    promptSummary = built.promptSummary;

    const toolDefs = toolRouter.getToolDefs(aiConfig.enabledTools);
    const toolCtx = { conversation, chatbot, organizationId, aiConfig, collectedCitations };

    // 3. Loop tool-use.
    let terminalDecision = null;
    while (iterations < maxIterations) {
      iterations += 1;

      const response = await provider.chat({ messages, tools: toolDefs, temperature });

      // Auditoria de custo/latência da chamada chat (nunca lança).
      await logUsage({
        organizationId,
        chatbotId: chatbot.id,
        conversationId: conversation.id,
        provider: response.provider,
        model: response.model,
        operation: 'chat',
        promptTokens: response.usage?.promptTokens || 0,
        completionTokens: response.usage?.completionTokens || 0,
        latencyMs: response.latencyMs || 0,
        metadata: { iteration: iterations },
      });

      if (response.content) finalContent = response.content;

      const wantsTools =
        response.finishReason === 'tool_use' && Array.isArray(response.toolCalls) && response.toolCalls.length;

      if (!wantsTools) break; // resposta final em texto

      // Realimenta o turno assistant que chamou as tools + os resultados.
      messages = [
        ...messages,
        { role: 'assistant', content: response.content || '', toolCalls: response.toolCalls },
      ];

      for (const tc of response.toolCalls) {
        const outcome = await toolRouter.execute(tc, toolCtx);
        toolsCalled.push({ name: tc.name, args: tc.args, result: outcome.result });
        messages.push({
          role: 'tool',
          toolCallId: tc.id,
          content: JSON.stringify(outcome.result ?? {}),
        });
        if (outcome.decision) terminalDecision = outcome.decision;
      }

      if (terminalDecision) {
        finalDecision = terminalDecision;
        break;
      }
      // Sem decisão terminal: volta ao topo para o modelo redigir a resposta
      // final usando os resultados das tools.
    }

    // 4. Confiança + fallback por baixa confiança (só se ainda 'answered').
    //    Dedupe antes de medir: search_kb pode repetir chunks da pré-recuperação,
    //    e duplicatas distorceriam a média de score.
    const confidence = computeConfidence(dedupeCitations(collectedCitations));
    if (finalDecision === 'answered' && confidence < minConfidence && aiConfig.fallbackFlowId) {
      finalDecision = 'fallback_flow';
    }

    // 5. Trace.
    const trace = await traceLogger.save({
      organizationId,
      conversationId: conversation.id,
      chatbotId: chatbot.id,
      retrievedChunks: collectedCitations,
      promptSummary,
      toolsCalled,
      decision: finalDecision,
      confidence,
      iterations,
    });

    return {
      reply: finalDecision === 'fallback_flow' ? '' : finalContent,
      citations: dedupeCitations(collectedCitations),
      toolsCalled,
      decision: finalDecision,
      confidence,
      traceId: trace.id,
      fallbackFlowId: finalDecision === 'fallback_flow' ? aiConfig.fallbackFlowId || null : null,
    };
  } catch (err) {
    console.error('[agent.engine] erro no run:', err.message);

    const trace = await traceLogger.save({
      organizationId,
      conversationId: conversation.id,
      chatbotId: chatbot.id,
      retrievedChunks: collectedCitations,
      promptSummary,
      toolsCalled,
      decision: 'errored',
      confidence: computeConfidence(dedupeCitations(collectedCitations)),
      iterations,
      error: err.message,
    });

    return {
      reply: '',
      citations: dedupeCitations(collectedCitations),
      toolsCalled,
      decision: 'errored',
      confidence: 0,
      traceId: trace.id,
      fallbackFlowId: null,
      error: err.message,
    };
  }
}

module.exports = { run };
