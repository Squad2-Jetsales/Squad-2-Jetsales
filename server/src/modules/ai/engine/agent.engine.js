const ragService = require('../rag/rag.service');
const contextBuilder = require('./context.builder');
const toolRouter = require('./tool.router');
const { resolveChatProvider } = require('../providers');
const traceLogger = require('../observability/trace.logger');

const MAX_ITERATIONS = 4;

async function run({ chatbot, conversation, contact, userInput }) {
  const provider = resolveChatProvider();
  const kbId = chatbot.ai_config?.knowledgeBaseId;
  const minConfidence = chatbot.ai_config?.minConfidence || 0.65;

  // 1. RAG: recupera chunks relevantes
  const citations = kbId
    ? await ragService.retrieve(kbId, userInput, { topKReturn: chatbot.ai_config?.topK || 6 })
    : [];

  // 2. Monta o contexto inicial
  let messages = await contextBuilder.build({ chatbot, conversation, contact, userInput, citations });

  const toolsCalled = [];
  let finalDecision = 'answered';
  let finalContent = '';
  let iteration = 0;

  // 3. Loop tool-use
  while (iteration < MAX_ITERATIONS) {
    const response = await provider.chat({
      messages,
      tools: toolRouter.getToolDefs(chatbot.ai_config?.enabledTools),
      temperature: chatbot.ai_config?.temperature || 0.3,
    });

    if (response.finishReason === 'stop' || response.content) {
      finalContent = response.content;
      break;
    }

    if (response.finishReason === 'tool_use') {
      for (const tc of response.toolCalls) {
        toolsCalled.push({ name: tc.name, args: tc.args });
        const result = await toolRouter.execute(tc, { conversation, chatbot });

        if (result.decision) { finalDecision = result.decision; break; }

        // Realimenta o resultado da tool no contexto
        messages = [...messages,
          { role: 'assistant', content: JSON.stringify(response.toolCalls) },
          { role: 'tool', toolCallId: tc.id, content: JSON.stringify(result) },
        ];
      }
    }

    iteration++;
  }

  // 4. Calcula confidence
  const avgScore = citations.length
    ? citations.reduce((s, c) => s + c.score, 0) / citations.length : 0;
  const confidence = Math.min(1, avgScore + (citations.length > 0 ? 0.1 : 0));

  // Fallback se confidence baixa
  if (confidence < minConfidence && chatbot.ai_config?.fallbackFlowId) {
    finalDecision = 'fallback_flow';
  }

  // 5. Persiste trace
  const trace = await traceLogger.save({
    conversationId: conversation.id,
    retrievedChunks: citations,
    toolsCalled,
    decision: finalDecision,
    confidence,
  });

  return {
    reply: finalContent,
    citations,
    toolsCalled,
    decision: finalDecision,
    confidence,
    traceId: trace.id,
    fallbackFlowId: finalDecision === 'fallback_flow' ? chatbot.ai_config?.fallbackFlowId : null,
  };
}

module.exports = { run };