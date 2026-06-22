#!/usr/bin/env node
// server/scripts/agent-smoke.js
//
// Smoke test standalone do AgentEngine (F3.4). Roda fora do servidor HTTP — exercita
// o loop tool-use ponta a ponta sem precisar do webhook/WhatsApp.
//
// Uso:
//   npm run agent:smoke -- --chatbot <CHATBOT_ID>                 # 3 cenários default
//   npm run agent:smoke -- --chatbot <CHATBOT_ID> --message "..." # 1 turno custom
//
// Pré-requisito: um chatbot do tipo 'ai_agent' com ai_config.knowledgeBaseId
// apontando para uma KB indexada (fluxo F3.2), e idealmente fallbackFlowId +
// minConfidence em ai_config. Cria uma conversa EFÊMERA na org do chatbot e a
// remove no final (cascateia messages/traces/tickets).
//
// LLM real (como rag:smoke) — consome tokens. Saída ilustrativa (OK/INFO).

require('dotenv').config();

const db = require('../src/database');
const agentEngine = require('../src/modules/ai/engine/agent.engine');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function fmtResult(r) {
  const lines = [];
  lines.push(`  decision   : ${r.decision}`);
  lines.push(`  confidence : ${r.confidence?.toFixed?.(3) ?? r.confidence}`);
  lines.push(`  traceId    : ${r.traceId || '(não persistido)'}`);
  lines.push(`  citations  : ${r.citations.length}`);
  for (const c of r.citations.slice(0, 3)) {
    const snippet = (c.snippet || '').slice(0, 70).replace(/\s+/g, ' ');
    lines.push(`     [${c.score}] ${c.title || '(sem título)'} — ${snippet}…`);
  }
  lines.push(`  tools      : ${r.toolsCalled.map((t) => t.name).join(', ') || '(nenhuma)'}`);
  if (r.fallbackFlowId) lines.push(`  fallbackTo : ${r.fallbackFlowId}`);
  const reply = (r.reply || '').slice(0, 200).replace(/\s+/g, ' ');
  lines.push(`  reply      : ${reply || '(vazio)'}`);
  return lines.join('\n');
}

async function main() {
  const chatbotId = arg('chatbot') || process.env.AGENT_SMOKE_CHATBOT_ID;
  const customMessage = arg('message');

  if (!chatbotId) {
    console.error('Uso: npm run agent:smoke -- --chatbot <CHATBOT_ID> [--message "..."]');
    process.exit(2);
  }

  const chatbot = await db('chatbots').where({ id: chatbotId }).first();
  if (!chatbot) {
    console.error(`✗ Chatbot ${chatbotId} não encontrado.`);
    process.exit(1);
  }

  const organizationId = chatbot.organization_id;
  const aiConfig = chatbot.ai_config || {};
  console.log(`▶ Chatbot: ${chatbot.name} (${chatbotId})  type=${chatbot.type}  org=${organizationId}`);
  if (chatbot.type !== 'ai_agent') {
    console.log(`  ⚠ type != 'ai_agent' — o engine roda mesmo assim, mas o webhook só despacharia ai_agent.`);
  }
  if (!aiConfig.knowledgeBaseId) {
    console.log('  ⚠ ai_config.knowledgeBaseId ausente — RAG desligado (citations sempre vazias).');
  }
  if (!aiConfig.fallbackFlowId) {
    console.log('  ⚠ ai_config.fallbackFlowId ausente — cenário de fallback não dispara.');
  }
  console.log('');

  // Conversa + contato efêmeros na org do chatbot.
  const phone = `00000${Date.now()}`.slice(-13);
  let contact;
  let conversation;
  try {
    [contact] = await db('contacts')
      .insert({ organization_id: organizationId, phone, name: 'Smoke F3.4' })
      .returning('*');

    [conversation] = await db('conversations')
      .insert({
        organization_id: organizationId,
        contact_id: contact.id,
        chatbot_id: chatbot.id,
        status: 'open',
      })
      .returning('*');

    const runTurn = async (label, userInput) => {
      console.log(`─── ${label} ───`);
      console.log(`  input      : "${userInput}"`);
      // Re-lê a conversa para refletir mutações (ex.: status waiting) entre turnos.
      const conv = await db('conversations').where({ id: conversation.id }).first();
      const result = await agentEngine.run({ chatbot, conversation: conv, contact, userInput });
      console.log(fmtResult(result));
      console.log('');
      return result;
    };

    if (customMessage) {
      await runTurn('Turno custom', customMessage);
    } else {
      // 1) Pergunta coberta pela KB → answered + citações (ilustrativo).
      const r1 = await runTurn('Cenário 1 — answer', process.env.AGENT_SMOKE_QUERY || 'Qual o horário de atendimento?');
      console.log(r1.citations.length > 0 ? '  ✓ retrieval trouxe citações\n' : '  ℹ sem citações (a KB tem documentos indexados sobre o tema?)\n');

      // 2) Pedido explícito de humano → transfer_to_human (ticket + waiting).
      const r2 = await runTurn('Cenário 2 — transfer_to_human', 'Quero falar com um atendente humano, por favor.');
      const ticket = await db('tickets').where({ conversation_id: conversation.id }).first();
      const convAfter = await db('conversations').where({ id: conversation.id }).first();
      if (r2.decision === 'transferred_human' && ticket && convAfter.status === 'waiting') {
        console.log(`  ✓ ticket ${ticket.id} criado + conversa em 'waiting'\n`);
      } else {
        console.log(`  ℹ transfer não confirmado (decision=${r2.decision}, ticket=${Boolean(ticket)}, status=${convAfter.status})\n`);
      }

      // 3) Mensagem sem base → confiança baixa → fallback_flow (se configurado).
      const r3 = await runTurn('Cenário 3 — fallback', 'xyzzy plugh qwop 0192837 mensagem sem sentido algum');
      if (aiConfig.fallbackFlowId) {
        console.log(r3.decision === 'fallback_flow' ? '  ✓ fallback disparou\n' : `  ℹ decision=${r3.decision} (esperado fallback_flow)\n`);
      }
    }

    // Confirma que traces foram gravados para a conversa.
    const traceCount = await db('ai_agent_traces').where({ conversation_id: conversation.id }).count('* as c').first();
    console.log(`─── Traces ───\n  ${traceCount.c} linha(s) em ai_agent_traces para esta conversa`);
  } finally {
    // Limpeza: delete da conversa cascateia messages/traces/tickets; depois o contato.
    if (conversation?.id) await db('conversations').where({ id: conversation.id }).del();
    if (contact?.id) await db('contacts').where({ id: contact.id }).del();
  }
}

main()
  .catch((err) => {
    console.error('✗ erro no smoke:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.destroy();
  });
