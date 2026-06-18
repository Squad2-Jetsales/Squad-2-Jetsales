// server/src/modules/ai/engine/context.builder.js
//
// Monta a lista de mensagens enviada ao LLM e um resumo (promptSummary) para o
// trace. Composição do prompt:
//   system  = persona + guardrails + bloco de CONTEXTO recuperado + regras de tools
//   history = últimas N mensagens da conversa (in→user, out→assistant)
//   +turn   = o userInput corrente (sem duplicar a inbound já persistida)
//
// Tenancy: a posse da conversa já foi estabelecida pelo agent.engine (org vem de
// conversation.organization_id); a leitura do histórico é escopada por
// conversation_id, mesmo padrão de acesso direto do webhook.service.

const crypto = require('crypto');
const db = require('../../../database');

const DEFAULT_MAX_HISTORY = 8;

function buildSystemPrompt({ contact, aiConfig, citations }) {
  const parts = [];

  const persona = (aiConfig?.systemPrompt || '').trim();
  parts.push(
    persona ||
      'Você é um assistente virtual de atendimento ao cliente. Responda em português do ' +
        'Brasil, de forma objetiva, cordial e honesta.'
  );

  if (contact?.name && contact.name !== contact.phone) {
    parts.push(`O nome do contato é ${contact.name}.`);
  }

  const guardrails = aiConfig?.guardrails || {};
  if (Array.isArray(guardrails.blockedTopics) && guardrails.blockedTopics.length) {
    parts.push(
      `Nunca discuta os seguintes assuntos: ${guardrails.blockedTopics.join(', ')}. ` +
        'Se perguntado, recuse educadamente.'
    );
  }

  parts.push(
    'Use prioritariamente as informações do CONTEXTO abaixo (trechos da base de ' +
      'conhecimento). Se a resposta não estiver no contexto, use a ferramenta search_kb ' +
      'para buscar mais. Se ainda assim não houver base para responder, seja honesto; ' +
      'quando apropriado, use transfer_to_human (falar com humano) ou trigger_flow ' +
      '(fluxo estruturado). Não invente informações.'
  );

  if (Array.isArray(citations) && citations.length) {
    const block = citations
      .map((c, i) => `[${i + 1}] ${c.title ? `${c.title} — ` : ''}${c.snippet}`)
      .join('\n');
    parts.push(`CONTEXTO RECUPERADO:\n${block}`);
  } else {
    parts.push('CONTEXTO RECUPERADO: (nenhum trecho relevante encontrado na base)');
  }

  if (guardrails.requiredDisclaimer) {
    parts.push(`Inclua sempre este aviso ao final da resposta: "${guardrails.requiredDisclaimer}"`);
  }

  return parts.join('\n\n');
}

async function fetchRecentHistory(conversationId, limit) {
  // listByConversation ordena ASC (primeiras N) — aqui queremos as N MAIS
  // RECENTES, então busca desc + reverte para ordem cronológica.
  const rows = await db('messages')
    .select('direction', 'content', 'created_at')
    .where({ conversation_id: conversationId })
    .orderBy('created_at', 'desc')
    .limit(limit);
  return rows.reverse();
}

async function build({ chatbot, conversation, contact, userInput, citations = [] }) {
  const aiConfig = chatbot?.ai_config || {};
  const maxHistory = Number.isFinite(Number(aiConfig.maxHistoryMessages))
    ? Math.max(1, Math.floor(Number(aiConfig.maxHistoryMessages)))
    : DEFAULT_MAX_HISTORY;

  const system = buildSystemPrompt({ contact, aiConfig, citations });

  const history = await fetchRecentHistory(conversation.id, maxHistory);
  const historyMessages = history
    .map((m) => ({
      role: m.direction === 'in' ? 'user' : 'assistant',
      content: typeof m.content === 'string' ? m.content : '',
    }))
    .filter((m) => m.content.trim());

  // Anthropic exige que a 1ª mensagem (após system) seja 'user'. Se a janela de
  // histórico começar com uma resposta do bot (out→assistant), descarta os
  // turnos assistant iniciais até o primeiro 'user' — senão a API rejeita com
  // "first message must use the user role".
  while (historyMessages.length && historyMessages[0].role !== 'user') {
    historyMessages.shift();
  }

  const turns = [...historyMessages];

  // Garante que o último turno é o userInput, sem duplicar a inbound que o
  // webhook já persistiu (nesse caminho ela já é o último 'in' do histórico).
  const last = turns[turns.length - 1];
  if (!(last && last.role === 'user' && last.content === userInput)) {
    turns.push({ role: 'user', content: userInput });
  }

  // Colapsa turnos consecutivos de mesmo papel (ex.: contato manda 2 mensagens
  // seguidas) — Anthropic exige alternância user/assistant. Defesa geral e
  // provider-agnóstica, antes de o adapter formatar.
  const convo = [];
  for (const m of turns) {
    const prev = convo[convo.length - 1];
    if (prev && prev.role === m.role) prev.content = `${prev.content}\n${m.content}`;
    else convo.push({ ...m });
  }

  const messages = [{ role: 'system', content: system }, ...convo];

  const promptSummary = {
    systemHash: crypto.createHash('sha256').update(system).digest('hex').slice(0, 16),
    historyCount: historyMessages.length,
    contextChars: system.length,
    citationCount: Array.isArray(citations) ? citations.length : 0,
  };

  return { messages, promptSummary };
}

module.exports = { build };
