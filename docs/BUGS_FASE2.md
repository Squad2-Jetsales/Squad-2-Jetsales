# Inventário de bugs — Fase 2

Lista de pendências de qualidade levantadas ao revisar o código mergeado.
Foco: **fechar lacunas no que já foi entregue**, sem criar features novas.

## Como usar

Cada bug tem: ID, severidade, sintoma observável, ponto no código, causa raiz,
passos de reprodução, critério de aceite e campos `Status` / `Owner` para
preencher conforme o time atacar.

- **P0** — bloqueia o uso da feature em produção. Tem que sair antes da Fase 3.
- **P1** — funcionalidade quebra ou age errado, mas há caminho alternativo.
- **P2** — polimento, log, dead code. Limpa antes do encerramento.

Status sugerido: `Aberto` → `Em andamento` → `Em teste` → `Fechado`.

## Resumo

| Severidade | Aberto | Fechado |
|------------|--------|---------|
| P0         | 0 | 4 (B-01, B-02, B-03, B-04) |
| P1         | 0 | 5 (B-05, B-06, B-07, B-11, B-13) |
| P2         | 1 (B-14, diferido) | 5 (B-08, B-09, B-10, B-12, B-15) |

**Onda 1:** B-02, B-08, B-09, B-10.
**Onda 2:** B-03, B-07, B-01, B-11.
**Onda 3:** B-05, B-06, B-15.
**Onda 4:** B-04 (cenário A).
**Onda 5 (fechamento):** B-13, B-12.
**Descobertos durante a Fase 2:** B-11, B-12, B-13, B-14, B-15 (todos fechados, exceto B-14 diferido).
**Diferido para Fase 3 com justificativa:** B-14 (sessões em memória no tester — risco baixo, sai com migração para banco na Fase 3).

---

## P0 — Bloqueadores

### B-01 — Mensagens recebidas do WhatsApp não acionam o FlowEngine ✅ FECHADO (Onda 2)
- **Resolução:** `webhook.service.js` ganhou `processBotResponse` que roda
  após a transação de persistência da mensagem `in`:
  1. Chama `flowService.runChatbotMessage` (novo método) passando o
     `current_node_id` e `flow_context` da conversa.
  2. Atualiza ponteiro + contexto **antes** de enviar (evita duplicação se
     o `sendText` falhar).
  3. Para cada resposta com `message`: chama `Evolution.sendText` e
     persiste `messages.out`.
  4. Se o engine retorna `isComplete`, marca a conversa como `resolved`.
  5. Se Evolution não está configurada (sem chave), só warneja e segue
     sem quebrar o webhook.
- `flow.service.runChatbotMessage` encapsula o boundary entre webhook e
  `FlowEngine`: mapeia UUID ↔ label nos dois sentidos, inicia do trigger
  na primeira mensagem, continua do node persistido nos turnos seguintes.

**Ressalvas anotadas (não bloqueiam fase 2):**
- As rotas de sessão `/flows/sessions/:sessionId/...` continuam operando
  em `Map` na memória do processo (são para o tester manual no editor).
  Para o caminho de WhatsApp a sessão vive no banco
  (`conversations.current_node_id`+`flow_context`), então isso não
  contamina. Mas em produção com múltiplos processos o tester pode
  surpreender — registrar para Fase 3.

#### Histórico (descrição original) ✅ FECHADO (Onda 2)
- **Resolução:**
  - `flow.service.runChatbotMessage({chatbotId, currentNodeId, flowContext, userInput})`
    encapsula busca do `active_flow_id`, mapeamento label↔UUID e execução do
    engine. Retorna `{ responses, nextNodeUuid, context, isComplete }`.
  - `webhook.service.upsertMessageForConnection` foi separada em duas fases:
    transação 1 persiste contato/conversa/mensagem inbound (como antes), e
    após o commit a nova `processBotResponse` é chamada para mensagens
    `in` em conexões com chatbot vinculado.
  - `processBotResponse` atualiza `current_node_id`+`flow_context` ANTES de
    enviar (evita duplicação em retry); envia cada resposta via
    `Evolution.sendText` e persiste como `messages.out`. Conversa muda para
    `status='resolved'` quando o engine retorna `isComplete`.

#### Histórico (descrição original)
- **Sintoma:** cliente envia mensagem no WhatsApp, a conversa aparece no painel,
  mas o bot nunca responde automaticamente. O fluxo publicado só funciona via
  `FlowTesterDialog`.
- **Onde:** [`server/src/modules/webhook/webhook.service.js`](../server/src/modules/webhook/webhook.service.js#L191) (`handleMessagesUpsert`)
  vs [`server/src/modules/flow/flow.service.js`](../server/src/modules/flow/flow.service.js#L238) (`startFlowSession`).
- **Causa raiz:** `webhook.service` persiste `conversations`/`messages` mas
  nunca chama `flowService.startFlowSession` nem `processFlowInput`. O único
  caller do `FlowEngine` é o controller de teste manual.
- **Como testar:**
  1. Conectar uma instância Evolution e publicar um fluxo simples
     (`trigger → message "olá" → end`).
  2. Vincular a `whatsapp_connection.chatbot_id` ao chatbot publicado.
  3. Enviar uma mensagem real para a instância.
  4. Verificar `SELECT * FROM messages WHERE direction='out' ORDER BY created_at DESC`.
- **Esperado:** mensagem `out` com `content='olá'` gravada ~1s depois da `in`.
- **Obtido:** só a mensagem `in` é gravada; nenhuma resposta sai.
- **Critério de aceite:** ao receber `MESSAGES_UPSERT` com `fromMe=false`, o
  back instancia/retoma sessão de fluxo, executa o engine, persiste as
  respostas como `messages.out` e dispara `Evolution.sendText` para cada
  resposta. `conversations.current_node_id` (coluna já existe no schema)
  é atualizado após cada turno.

### B-02 — Rotas `/flow-nodes` e `/flow-edges` carregam em modo stub (503) ✅ FECHADO (Onda 1)
- **Resolução:** rotas e arquivos não usados removidos —
  `node.routes.js`, `edge.routes.js`, `node.model.js`, `edge.model.js`,
  `flow.schemas.js` (todos referenciando endpoints inexistentes ou consumidores
  inexistentes). Linhas correspondentes apagadas em
  `server/src/routes/index.js`. Funções mortas `createNode/updateNode/
  deleteNode/createEdge/deleteEdge` removidas de `client/src/lib/api/flows.ts`
  junto com as interfaces `CreateFlowNodeInput`/`CreateFlowEdgeInput`.

#### Histórico (descrição original)
- **Sintoma:** qualquer chamada `POST /api/v1/flow-nodes` etc. devolve 503
  `MODULE_BROKEN`. Não há impacto na UI atual (ela só usa
  `PUT /flows/:id/graph`), mas as funções expostas em
  `client/src/lib/api/flows.ts` são chamadas mortas que vão estourar se forem
  usadas.
- **Onde:**
  - [`server/src/modules/flow/node.routes.js`](../server/src/modules/flow/node.routes.js)
    referencia `c.createNode`, `c.updateNode`, `c.deleteNode`.
  - [`server/src/modules/flow/edge.routes.js`](../server/src/modules/flow/edge.routes.js)
    referencia `c.createEdge`, `c.deleteEdge`.
  - [`server/src/modules/flow/flow.controller.js`](../server/src/modules/flow/flow.controller.js)
    **não exporta** nenhum desses métodos.
- **Causa raiz:** routers tentam ligar a handlers `undefined`, Express lança
  `TypeError` no `require`, [`routes/index.js`](../server/src/routes/index.js#L32-L34)
  cai no `catch` e degrada para stub 503.
- **Como testar:**
  1. Subir o backend (`npm run dev` em `server/`).
  2. Conferir log: deve aparecer `❌ [flow-nodes] falha ao carregar módulo` e
     equivalente para `flow-edges`.
  3. `curl -X POST http://localhost:3001/api/v1/flow-nodes -H 'Content-Type: application/json' -d '{}'`.
- **Esperado:** 200/201 ou pelo menos 400 de validação.
- **Obtido:** `503 { code: 'MODULE_BROKEN' }`.
- **Critério de aceite:** ou implementar os 5 handlers em `flow.controller.js`,
  ou remover as rotas + os métodos não usados em `flowsApi` (e o stub em
  `routes/index.js` deixar de aparecer no boot).

### B-03 — Criar chatbot manual não vincula fluxo → editor mostra "sem fluxo ativo" ✅ FECHADO (Onda 2)
- **Resolução:** `chatbot.service.create` agora roda transação que insere
  `chatbots` + `flows` (draft) + `flow_nodes` (trigger) e atualiza
  `active_flow_id`. Retorna o chatbot já vinculado, sem mudar contrato
  com o front.

#### Histórico (descrição original)
- **Sintoma:** ao clicar **Criar Manualmente**, o usuário é redirecionado para
  `/chatbots/:id` e vê o card *Este chatbot ainda não tem um fluxo ativo*.
  Não há caminho na UI para sair desse estado.
- **Onde:**
  - [`server/src/modules/chatbot/chatbot.service.js`](../server/src/modules/chatbot/chatbot.service.js#L37) (`create`)
    só insere o chatbot.
  - [`client/src/components/chatbot/CreateManualChatbotDialog.tsx`](../client/src/components/chatbot/CreateManualChatbotDialog.tsx#L33)
    chama `chatbotsApi.create` e navega para o editor.
  - [`client/src/pages/ChatbotEditorPage.tsx:840`](../client/src/pages/ChatbotEditorPage.tsx#L840)
    bloqueia render se `activeFlowId` é null.
- **Causa raiz:** nenhum endpoint cria flow rascunho associado ao bot, e o
  front nunca chama `PATCH /chatbots/:id { activeFlowId }` (apesar do back
  aceitar — [`chatbot.controller.js:84`](../server/src/modules/chatbot/chatbot.controller.js#L84)).
- **Como testar:**
  1. Logar no front.
  2. *Criar Manualmente* com um nome qualquer.
  3. Observar a tela do editor.
- **Esperado:** canvas vazio editável com bloco "Início" pré-posicionado.
- **Obtido:** card "Este chatbot ainda não tem um fluxo ativo".
- **Critério de aceite:** após `POST /chatbots`, o chatbot tem
  `active_flow_id` apontando para um `flows` row em status `draft` com um
  único node `trigger`. Editor abre direto no canvas.

### B-04 — `POST /chatbots/ai-generate` e `/ai-adjust` respondem 501 ✅ FECHADO (Onda 4 — cenário A)
- **Resolução:** botões "Criar com IA" (em `ChatbotsPage`) e "Ajustar com
  IA" (em `ChatbotEditorPage`) ficam atrás de
  `VITE_ENABLE_AI === "true"`. Default desligado, então em dev e em
  produção atual eles não aparecem. Dialogs também escondidos para não
  ficarem montados sem necessidade. Texto do empty state ajustado para
  não prometer IA quando a flag está off.
- **Onde:**
  - [`client/.env.example`](../client/.env.example): documenta a flag.
  - [`ChatbotsPage.tsx`](../client/src/pages/ChatbotsPage.tsx#L16): const
    `AI_ENABLED` + 3 guardas (header, empty state, dialog).
  - [`ChatbotEditorPage.tsx`](../client/src/pages/ChatbotEditorPage.tsx#L62):
    mesma const + 2 guardas (botão + dialog).
- **Como ligar (Fase 3, quando o backend AI estiver pronto):** criar
  `client/.env.local` com `VITE_ENABLE_AI=true` (dev) ou setar no Vercel
  (produção) e os botões reaparecem. **Backend continua respondendo 501
  até o `ai.service.js` ser implementado** — esse é o pedaço de feature
  real da Fase 3.

#### Histórico (descrição original)
- **Sintoma:** clicar *Criar com IA* ou *Ajustar com IA* mostra toast de erro
  ("ainda não migrado para knex"). Os dialogs ficam visíveis e funcionais,
  passando expectativa de feature pronta.
- **Onde:**
  - [`server/src/modules/chatbot/chatbot.controller.js:136-137`](../server/src/modules/chatbot/chatbot.controller.js#L136)
    (`exports.aiGenerate = notImplemented(...)`).
  - [`server/src/modules/ai/ai.routes.js`](../server/src/modules/ai/ai.routes.js),
    [`ai.service.js`](../server/src/modules/ai/ai.service.js),
    [`rag.service.js`](../server/src/modules/ai/rag.service.js) — todos com
    **0 linhas**.
- **Causa raiz:** módulos AI nunca foram implementados, mas os endpoints
  ficaram registrados no router e dialogs no front ativos.
- **Como testar:**
  1. Front → *Criar com IA* → preencher prompt de 20+ chars → *Gerar*.
  2. Observar resposta HTTP em DevTools.
- **Esperado:** 200 com `{ chatbot, flow, nodes, edges }`.
- **Obtido:** 501 `{ code: 'NOT_IMPLEMENTED' }`.
- **Critério de aceite:** decisão de produto — implementar (escopo Fase 3) ou
  **esconder os botões "Criar com IA" / "Ajustar com IA"** até o backend
  existir. Hoje a UI mente sobre o que está pronto.

---

## P1 — Quebras funcionais com workaround

### B-05 — Bloco *Condição* ignora `source_handle` em runtime ✅ FECHADO (Onda 3)
- **Resolução:**
  1. `flow.service._toEngineFormat` agora preserva `sourceHandle` na edge
     passada para o engine.
  2. `FlowEngine.getNextNodeId`: se o node atual é tipo `condition`,
     avalia `node.condition` (field/operator/value) via novo helper
     `evaluateNodeCondition` e escolhe a edge cujo `sourceHandle` bate
     com `'true'` ou `'false'`. Suporta operadores `==`, `!=`, `contains`,
     `>`, `<` (numéricos comparam como Number).
  3. Field `'input'` usa o último input do usuário; qualquer outro nome
     busca no `context` (variáveis capturadas).

#### Histórico (descrição original)
- **Sintoma:** fluxo desenhado com `Condition → true/false` direciona errado
  no teste/produção. Sempre vai pelo primeiro edge encontrado.
- **Onde:**
  - Editor cria edges com `sourceHandle='true'|'false'`
    ([`ChatbotEditorPage.tsx:170-171`](../client/src/pages/ChatbotEditorPage.tsx#L170)).
  - Engine só olha `edge.condition`
    ([`flow.engine.js:60`](../server/src/modules/flow/flow.engine.js#L60), `getNextNodeId`).
- **Causa raiz:** `_toEngineFormat` em
  [`flow.service.js:345`](../server/src/modules/flow/flow.service.js#L345) descarta
  `source_handle` ao converter para o engine.
- **Como testar:**
  1. Montar fluxo: `trigger → capture(var=nome) → condition(field=nome,
     operator=contains, value=joao) → [true] message "oi joao" → end /
     [false] message "outro" → end`.
  2. Testar com input "joao silva" e depois "maria".
- **Esperado:** "joao silva" → "oi joao"; "maria" → "outro".
- **Obtido:** sempre vai pelo mesmo branch (ordem das edges no DB).
- **Critério de aceite:** engine usa `edge.sourceHandle` para escolher saída
  quando o node tipo `condition` tem múltiplos handles, OU `_toEngineFormat`
  popula `edge.condition` derivado do handle + condition do node.

### B-06 — Bloco *Aguardar* não espera ✅ FECHADO (Onda 3)
- **Resolução:** `FlowEngine.executeNode` no case `'wait'` agora aplica
  `setTimeout` com `node.delay` em milissegundos, **clampado em 60s**
  conforme decisão de produto da Fase 2. Delays maiores que isso passam
  silenciosamente a esperar só 60s — `wait` longo entra como fila
  assíncrona na Fase 3 (registrar como B-15 quando endereçar).

#### Histórico (descrição original)
- **Sintoma:** delay configurado no editor (ex.: "5s") é ignorado; mensagens
  saem em rajada.
- **Onde:** [`flow.engine.js:88`](../server/src/modules/flow/flow.engine.js#L88) (`executeNode`)
  não trata `wait`; cai no `default` warn. `node.delay` aparece em
  `buildResponse` mas nenhum consumidor (`tester`, futuro webhook) usa.
- **Causa raiz:** falta `case 'wait': await sleep(node.delay)` no switch.
- **Como testar:**
  1. Fluxo: `trigger → message "A" → wait(2000ms) → message "B" → end`.
  2. Iniciar sessão e cronometrar.
- **Esperado:** 2s entre "A" e "B".
- **Obtido:** "A" e "B" no mesmo response, sem espera.
- **Critério de aceite:** sessão respeita `node.delay` (ou `node.waitMs`)
  antes de emitir a próxima resposta.

### B-07 — `publishFlow` não promove o flow a `active_flow_id` do chatbot ✅ FECHADO (Onda 2)
- **Resolução:** `flow.service.publishFlow` virou transação que atualiza
  `flows.status='published'` e `chatbots.active_flow_id = flowId` no
  mesmo round-trip. Bot recém-criado já tem flow draft vinculado (B-03),
  então publicar simplesmente "trava" o flow como definitivo.

#### Histórico (descrição original)
- **Sintoma:** publicar um flow muda status para `published` mas o chatbot
  segue com `active_flow_id=NULL` (ou apontando para um draft antigo). A UI
  precisa de uma chamada manual de `PATCH /chatbots/:id` que ela não faz.
- **Onde:** [`flow.service.js:225`](../server/src/modules/flow/flow.service.js#L225)
  (`publishFlow`) — atualiza só `flows.status`.
- **Como testar:**
  1. Criar/atualizar um chatbot com `active_flow_id=NULL` (caso B-03) ou
     usar um existente.
  2. Criar um flow associado e publicar.
  3. `SELECT active_flow_id FROM chatbots WHERE id=...`.
- **Esperado:** `active_flow_id` igual ao `flow.id` recém-publicado.
- **Obtido:** valor inalterado.
- **Critério de aceite:** `publishFlow` faz, na mesma transação,
  `flows.status='published'` + `chatbots.active_flow_id = :flowId` quando o
  chatbot ainda não tem fluxo ativo (ou sempre, conforme decisão de
  produto).

---

## P2 — Higiene de código

### B-08 — Engine emite `console.warn('Unknown node type: ...')` para tipos válidos ✅ FECHADO (Onda 1)
- **Resolução:** [`flow.engine.js:executeNode`](../server/src/modules/flow/flow.engine.js#L88)
  agora cobre `trigger`, `condition` e `wait` no switch (sem efeito além de
  break — wait recebe delay real na Onda 3). Default só warneja para tipos
  realmente desconhecidos.

#### Histórico (descrição original)
- **Sintoma:** logs do back lotam de `Unknown node type: trigger`,
  `Unknown node type: condition`, `Unknown node type: wait` a cada execução
  de fluxo.
- **Onde:** [`flow.engine.js:106-108`](../server/src/modules/flow/flow.engine.js#L106).
- **Como testar:** rodar qualquer fluxo com Trigger/Condition/Wait e olhar o
  log do `npm run dev`.
- **Critério de aceite:** os três tipos têm `case` próprio (mesmo que com
  `break` vazio para trigger/condition) ou o `default` deixa de chamar
  `console.warn` para tipos conhecidos.

### B-09 — Dead code: `flow.runtime.service.js` e `flow.runtime.controller.js` ✅ FECHADO (Onda 1)
- **Resolução:** ambos arquivos apagados. `flow.schemas.js` (dead code
  correlato, sem importadores) também removido.

#### Histórico (descrição original)
- **Sintoma:** dois services com a mesma API; o `runtime.*` mantém estado em
  `Map` na memória, não está registrado em [`routes/index.js`](../server/src/routes/index.js),
  e divergiu do `flow.service.js` (sem DB, sem `_toEngineFormat`, sem
  tenancy).
- **Onde:** [`server/src/modules/flow/flow.runtime.service.js`](../server/src/modules/flow/flow.runtime.service.js)
  e [`flow.runtime.controller.js`](../server/src/modules/flow/flow.runtime.controller.js).
- **Como testar:** `grep -R "flow.runtime" server/src` — só ele aparece se
  referenciando a si mesmo.
- **Critério de aceite:** ambos arquivos apagados; nenhum require quebra.

### B-10 — Diretório `server/migrations/` órfão ✅ FECHADO (Onda 1)
- **Resolução:** pasta `server/migrations/` e seu único arquivo apagados.
  `server/src/database/migrations/` segue como diretório oficial do knex.

#### Histórico (descrição original)
- **Sintoma:** [`server/migrations/20260517_create_chatbots_conversations_messages.js`](../server/migrations/20260517_create_chatbots_conversations_messages.js)
  define um schema mais simples que o atual e nunca é executado, porque o
  [`knexfile.js:15`](../server/knexfile.js#L15) aponta para `./src/database/migrations`.
- **Como testar:** `cat server/knexfile.js | grep directory` e comparar com
  `ls server/migrations`.
- **Critério de aceite:** deletar a pasta `server/migrations/` (ou movê-la
  para `src/database/migrations` se o conteúdo for válido — checar com
  quem escreveu).

---

## Bugs descobertos durante a Fase 2

### B-11 — Tenancy não é aplicada nas rotas de `/flows` ✅ FECHADO (Onda 2)
- **Resolução:** `flow.controller.js` agora importa `assertFlowOwned` e
  adiciona um helper local `assertChatbotOwned`. Os handlers
  `createFlow`, `listFlows`, `getFlow`, `updateFlow`, `replaceGraph`,
  `publishFlow`, `deleteFlow` e `startSession` validam org antes de
  qualquer operação. `listFlows` sem `chatbotId` restringe à org via
  JOIN explícito.
- Erros voltam como 404 para não revelar a existência do recurso entre
  organizações (`error.status || 404`).

**Pendente (Fase 3):** as rotas de sessão (`processInput`, `getSession`,
`endSession`, `getSessionStats`) ainda não têm guard porque operam em
`Map` em memória sem `organization_id`. Se alguém adivinhar um
`sessionId`, consegue interagir. Baixo risco prático (UUID alto entropia
+ TTL curto), mas vale registrar como B-14 para fase seguinte.

#### Histórico (descrição original) ✅ FECHADO (Onda 2)
- **Resolução:** `flow.controller.js` agora chama `assertFlowOwned` (do
  `flow.guards`) em todos os handlers que recebem `flowId` no path:
  `getFlow`, `updateFlow`, `replaceGraph`, `publishFlow`, `deleteFlow`,
  `startSession`. `createFlow` e `listFlows` ganharam validação de
  `chatbotId` via novo helper `assertChatbotOwned`. Listagem sem
  `chatbotId` agora faz JOIN com `chatbots.organization_id` em vez de
  retornar todos os flows do banco.
- **Pendência conhecida (registrada como B-14):** as rotas de sessão de
  teste (`/sessions/:sessionId/*`) operam num `Map` em memória sem
  amarração à org. Vou tratar como follow-up.

#### Histórico (descrição original)
- **Severidade:** P1 (não é exploit aberto se as orgs ainda têm pouco volume,
  mas é vulnerabilidade arquitetural antes de ir a produção real).
- **Sintoma:** qualquer usuário autenticado consegue ler/editar/publicar
  qualquer flow ou node de qualquer organização chamando direto pelo `flowId`.
  As rotas de `/chatbots` filtram por `organization_id`, mas as de `/flows`
  não.
- **Onde:**
  - [`flow.controller.js`](../server/src/modules/flow/flow.controller.js)
    chama `flowService.getFlow(flowId)` etc. sem nunca passar
    `organizationId`.
  - [`flow.guards.js`](../server/src/modules/flow/flow.guards.js)
    **existe pronto** com `assertFlowOwned/assertNodeOwned/assertEdgeOwned`
    via JOIN com `chatbots.organization_id`, mas **ninguém importa** o
    arquivo.
  - [`flow.mapper.js`](../server/src/modules/flow/flow.mapper.js) idem
    (mapper limpo, sem consumidor).
- **Causa raiz:** infra de tenancy foi escrita mas não plugada nos
  handlers. O `flow.service.js` opera direto com `flowId` sem tomar
  `organizationId` como parâmetro.
- **Como testar:**
  1. Logar com usuário da org A, criar chatbot+flow.
  2. Anotar o `flowId`.
  3. Logar com usuário da org B (cookie diferente) e fazer
     `GET /api/v1/flows/{flowId}`.
- **Esperado:** 404 `NOT_FOUND` (não revelar nem existência).
- **Obtido (provável):** 200 com o flow inteiro da org A.
- **Critério de aceite:** todos os handlers de `flow.controller` chamam
  `assertFlowOwned`/`assertNodeOwned`/`assertEdgeOwned` antes de qualquer
  leitura ou mutação. `flow.mapper` passa a ser usado para padronizar a
  resposta. Endpoint público (sem auth) inexistente.
- **Status:** Aberto. **Sugiro tratar na Onda 2** porque B-01 e B-03 vão
  reescrever pedaços de `flow.service` e plugar o guard agora evita
  retrabalho.

### B-14 — Sessões de teste do FlowTester não têm tenancy guard
- **Severidade:** P2 (não vaza dados de produção; vaza sessões de teste).
- **Sintoma:** quem tem o `sessionId` consegue continuar a sessão
  independentemente de qual org. Como `sessionId` é gerado por
  `Date.now()_random` e vive num Map por instância de servidor, o impacto
  prático é baixo, mas é tenancy inconsistente.
- **Onde:** `flowSessions` Map em
  [`flow.service.js`](../server/src/modules/flow/flow.service.js#L5).
- **Critério de aceite:** `startFlowSession` registra o `organizationId`
  na sessão; `processFlowInput`/`getFlowSession`/`endFlowSession`
  comparam com `req.auth.organizationId` antes de prosseguir.
- **Status:** Aberto. Pode ir para o final da Onda 3 junto com B-05/B-06
  (mesmo arquivo).

### B-15 — Bloco "Capturar Resposta" sumido do toolbox do editor ✅ FECHADO (Onda 3)
- **Severidade:** P0 (descoberto durante a validação do B-05).
- **Sintoma:** o usuário desenha fluxo com Condition mas não tem como
  capturar input antes — só vê os blocos Início, Enviar Mensagem, Menu,
  Condição, Aguardar e Fim no toolbox. Usa Message no lugar e o engine
  nunca preenche `context.<variavel>` → Condition sempre cai no false.
- **Onde:** [`ChatbotEditorPage.tsx`](../client/src/pages/ChatbotEditorPage.tsx)
  no array `BLOCK_PALETTE`. O `CaptureNode` já existia em `NODE_TYPES`,
  o `NodeEditor` já tinha o painel `type === "capture"`, e o backend
  salva tipo `capture` em `flow_nodes` — só faltava a entrada no
  palette pro usuário arrastar.
- **Resolução:** linha adicionada em `BLOCK_PALETTE` entre Message e
  Menu, defaults `{ text: "Qual seu nome?", variable: "input" }`.
- **Como testar:** ver roteiro B-05 atualizado.

### B-13 — `chatbot.duplicate` copia só o chatbot, deixa cópia sem flow ✅ FECHADO (Fase 2)
- **Resolução:** `chatbot.service.duplicate` virou transação que clona
  o chatbot + flow ativo + nodes + edges. UUIDs dos nodes são gerados
  no Node via `crypto.randomUUID()` antes do INSERT, criando um mapa
  `oldId → newId` usado para remapear `source_node_id` /
  `target_node_id` nas edges. A cópia vira sempre `draft` (operador
  publica quando quiser sem afetar o original).

#### Histórico (descrição original)
- **Severidade:** P1 (mesma classe do B-03: cópia vira inutilizável).
- **Sintoma:** ao clicar *Duplicar* num bot publicado, o novo bot aparece
  na lista mas com `active_flow_id=NULL` e cai em "sem fluxo ativo" ao
  abrir o editor.
- **Onde:** [`chatbot.service.js:duplicate`](../server/src/modules/chatbot/chatbot.service.js#L63).
- **Causa raiz:** insere outra linha na tabela `chatbots` sem clonar flow,
  nodes ou edges associados.
- **Como testar:** com qualquer bot que tenha flow válido, clicar
  *Duplicar* no card. `SELECT active_flow_id FROM chatbots ORDER BY
  created_at DESC LIMIT 1;`.
- **Esperado:** `active_flow_id` aponta para um flow novo, em status
  `draft`, com a mesma estrutura de nodes/edges do original.
- **Obtido:** `active_flow_id` = NULL.
- **Critério de aceite:** `duplicate` faz, na mesma transação, INSERT do
  chatbot + INSERT do flow (status draft, version 1) + INSERT em massa de
  flow_nodes/flow_edges remapeando IDs + UPDATE `active_flow_id`.
- **Status:** Aberto.

### B-12 — `loadOrStub` mascara dependência faltando como "não implementado" ✅ FECHADO (Fase 2)
- **Resolução:** detector em `routes/index.js` agora extrai com regex o
  PRIMEIRO `Cannot find module 'X'` do error message e compara com o
  path/baseName do módulo de domínio. Só cai em stub 501 se `X` for o
  próprio módulo de domínio; deps npm transitivas faltando agora
  registram um `❌ dependência ausente: 'qrcode' — rode npm install`
  e caem em stub 503 (visível, não silencioso).

#### Histórico (descrição original)
- **Severidade:** P2 (não derruba produção, mas confunde quem debuga).
- **Sintoma:** ao rodar `npm run dev` sem ter rodado `npm install` recente
  (ou com `node_modules` antigo), o boot mostra
  `⚠️ [whatsapp-connections] módulo ainda não implementado` — o que é
  **mentira**. O módulo existe; o que falta é o pacote `qrcode` (importado
  por `whatsapp.mapper.js`).
- **Onde:** [`server/src/routes/index.js:24-29`](../server/src/routes/index.js#L24).
  O `catch` trata `MODULE_NOT_FOUND` como "feature não entregue".
- **Causa raiz:** Node lança `MODULE_NOT_FOUND` tanto para módulos da app
  (`../modules/foo`) quanto para deps `npm` (`qrcode`). O detector compara
  só pelo nome do arquivo (`err.message.includes(modulePath.split('/').pop())`),
  então `qrcode` ausente passa pelo fallback como se fosse o próprio módulo
  ausente.
- **Como testar:**
  1. `rm -rf server/node_modules/qrcode`.
  2. `npm run dev`.
- **Esperado:** erro alto e claro `Cannot find module 'qrcode' — rode npm install`.
- **Obtido:** stub silencioso 501 nas rotas de whatsapp.
- **Critério de aceite:** detector compara o caminho completo do require
  (só cair em stub se for o próprio módulo de domínio, não uma dep
  transitiva), ou sempre propaga o erro original quando a substring não
  bate exatamente com `../modules/<label>`.
- **Status:** Aberto. **Não bloqueia a Onda 2.**

---

## Checklist de saída da Fase 2

Antes de fechar:

- [ ] B-01 a B-04 resolvidos (todos P0).
- [ ] B-05 a B-07 com decisão de produto (corrigir vs. esconder na UI).
- [ ] B-08 a B-10 limpos.
- [ ] Roteiro de smoke test atualizado em [`docs/DEMO.md`](DEMO.md) cobre:
      criar bot manual → editar → publicar → mandar mensagem real no WhatsApp
      → bot responde → ticket reflete no painel.
- [ ] Logs de `npm run dev` no boot não trazem `MODULE_BROKEN` nem
      `Unknown node type`.

---

_Atualizado em 2026-05-25 a partir de revisão do commit `6491b7a`._
