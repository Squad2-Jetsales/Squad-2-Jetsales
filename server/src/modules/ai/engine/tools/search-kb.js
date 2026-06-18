// server/src/modules/ai/engine/tools/search-kb.js
//
// Tool `search_kb`: retrieval explícito na base de conhecimento. O LLM decide
// quando aprofundar a busca (além do contexto já injetado na pré-recuperação).
// Tenancy herdada do rag.service (assertKbOwned com organizationId do request).

const ragService = require('../../rag/rag.service');

const definition = {
  name: 'search_kb',
  description:
    'Busca trechos relevantes na base de conhecimento para fundamentar a resposta. ' +
    'Use quando precisar de informação que não está no contexto já fornecido.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Pergunta ou termos de busca, em linguagem natural.',
      },
    },
    required: ['query'],
  },
};

async function execute(args, ctx) {
  const { organizationId, aiConfig } = ctx;
  const kbId = aiConfig?.knowledgeBaseId;
  const query = typeof args?.query === 'string' ? args.query.trim() : '';

  if (!kbId || !query) {
    return {
      result: {
        citations: [],
        note: kbId ? 'query vazia' : 'chatbot sem knowledgeBaseId configurado',
      },
    };
  }

  const { citations } = await ragService.retrieve(organizationId, kbId, query, {
    topKReturn: aiConfig?.topK,
  });

  // Acumula as citações desta tool para entrar no trace + na resposta final do
  // engine (ctx.collectedCitations é um array fornecido pelo agent.engine).
  if (Array.isArray(ctx.collectedCitations)) {
    ctx.collectedCitations.push(...citations);
  }

  return {
    result: {
      citations: citations.map((c) => ({
        title: c.title,
        snippet: c.snippet,
        score: c.score,
      })),
    },
  };
}

module.exports = { definition, execute };
