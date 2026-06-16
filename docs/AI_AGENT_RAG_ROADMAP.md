# JetGO — Roadmap AI Agent + RAG (Nível 3)

> Blueprint executável para construção do nível 3 de chatbot do JetGO: agente de IA com base de conhecimento (RAG) + fallback determinístico para o fluxo tradicional.
> Última atualização: 2026-06-16 (re-baseline após auditoria do estado real).
> Pré-requisito: PRs #6 e #7 mergeadas e Fases 1 (chatbot/flow CRUD) e 2 (WhatsApp + conversations) entregues. Sem isso, este roadmap não roda.

> ⚠️ **AVISO DE REALIDADE (2026-06-16).** Este roadmap foi escrito assumindo **9 PRs isoladas e sequenciais** sobre um `develop` limpo. **A premissa já não vale.** Merges anteriores (`iago-scosta/AI-integracao`) introduziram scaffolds parciais e quebrados de F3.3/F3.4/F3.5 fora de ordem. Antes de seguir qualquer fase, leia o quadro **"Estado real auditado"** no início da seção 6 e a **"Lista de limpeza"** no fim dela. As anotações `> Estado real (2026-06-16)` em cada fase têm precedência sobre o texto de planejamento original.

---

## 0. Visão executiva

O AI Agent é um chatbot tipo `ai_agent` que:

1. Recebe a mensagem do contato vinda do `webhook/evolution`.
2. Resolve a `KnowledgeBase` vinculada ao chatbot.
3. Executa retrieval semântico nos chunks da base (pgvector top-K + reranking).
4. Monta um prompt com sistema + contexto recuperado + histórico curto da conversa.
5. Chama o provider LLM (OpenAI/Anthropic) com tool-use habilitado.
6. Pode chamar ferramentas (`transfer_to_human`, `capture_field`, `trigger_flow`, etc.).
7. Persiste resposta como `messages` e envia via Evolution.
8. Se confidence < threshold ou tool `trigger_flow` for invocada → cai no `fallbackFlowId` definido em `chatbot.aiConfig` (FlowEngine tradicional).

Tudo isso atrás de tenancy multi-org, rate limit por org, logging de custo por request e auditoria de citações.

---

## 1. Arquitetura em camadas

```
┌────────────────────────────────────────────────────────────────┐
│ Webhook Evolution  →  Dispatcher  →  AgentEngine               │
│                                       │                        │
│                                       ├─ ContextBuilder        │
│                                       │   ├─ ConversationStore │
│                                       │   ├─ ContactStore      │
│                                       │   └─ RAGService ───┐   │
│                                       │                    │   │
│                                       │   ┌────────────────┘   │
│                                       │   ▼                    │
│                                       │  Retriever (pgvector)  │
│                                       │   ├─ Embedder          │
│                                       │   ├─ Reranker (opt.)   │
│                                       │   └─ CitationBuilder   │
│                                       │                        │
│                                       ├─ LLMProvider (plug)    │
│                                       │   ├─ OpenAIAdapter     │
│                                       │   └─ AnthropicAdapter  │
│                                       │                        │
│                                       ├─ ToolRouter            │
│                                       │   ├─ transferToHuman   │
│                                       │   ├─ captureField      │
│                                       │   ├─ triggerFlow       │
│                                       │   └─ searchKb          │
│                                       │                        │
│                                       └─ FallbackBridge → FlowEngine │
│                                                                │
│ IngestionWorker (async) ── parse ── chunk ── embed ── upsert   │
└────────────────────────────────────────────────────────────────┘
```

Cada caixa é um módulo isolado em `server/src/modules/ai/` com responsabilidade única e testável em unidade.

---

## 2. Decisões técnicas (não-negociáveis)

| Tema | Decisão | Motivo |
|---|---|---|
| Vector store | `pgvector` no mesmo Postgres | Stack já tem PG; evita serviço externo na fase inicial |
| Embedding model | `text-embedding-3-small` (1536d) default, configurável por KB | Custo baixo, qualidade suficiente; já está em `knowledge_bases.embedding_model` |
| LLM default | Anthropic `claude-sonnet-4-6` | Tool-use robusto, melhor qualidade em PT-BR |
| Provider abstraction | Interface `LLMProvider` com adapters | Trocar OpenAI/Anthropic sem tocar AgentEngine |
| Chunking | Recursive + janela de overlap (default 1000/150) | Configurável por KB; tabela já prevê |
| Ingestão | Fila assíncrona (BullMQ + Redis) | Upload nunca bloqueia request; embeddings demoram |
| Retrieval | Híbrido: vector top-K (k=20) → MMR (k=6) → opcional rerank | Equilibra recall com precisão |
| Tool-use | Nativo do provider (não simulado via JSON parsing) | Mais confiável e barato em tokens |
| Streaming | Server-Sent Events (`/ai/chat/stream`) para o painel preview | UX no editor; WhatsApp ainda é round-trip |
| Token accounting | Persistir em `ai_usage_logs` por request | Auditoria + billing futuro |
| Rate limit | Token bucket por `organization_id` (Redis) | Não derrubar a plataforma em loop de webhook |
| Idempotência webhook | `evolution_message_id` único | Evita reprocessar mensagem duplicada |

---

## 3. Schema enrichment (migrations novas)

O schema atual cobre `knowledge_bases` e `knowledge_documents`, mas falta o necessário para RAG real. Criar **3 migrations sequenciais**:

### 3.1. `20260601_001_enable_pgvector.js`

```js
exports.up = (knex) => knex.raw('CREATE EXTENSION IF NOT EXISTS vector');
exports.down = (knex) => knex.raw('DROP EXTENSION IF EXISTS vector');
```

### 3.2. `20260601_002_knowledge_chunks_and_jobs.js`

Tabelas novas:

- `knowledge_chunks`
  - `id` UUID PK
  - `document_id` FK → `knowledge_documents` ON DELETE CASCADE
  - `knowledge_base_id` FK (denormalizado p/ query rápida)
  - `chunk_index` int
  - `content` text
  - `token_count` int
  - `embedding` vector(1536) NOT NULL
  - `metadata` jsonb (page, section, source)
  - `created_at` timestamp
  - **Índice IVFFlat ou HNSW**: `CREATE INDEX ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)`
  - Índice em `knowledge_base_id` (filtragem por tenant via JOIN)

- `knowledge_ingestion_jobs`
  - `id` UUID PK
  - `document_id` FK
  - `status` enum (`pending`, `processing`, `succeeded`, `failed`)
  - `error` text nullable
  - `tokens_used` int default 0
  - `started_at`, `finished_at` timestamps nullable
  - `created_at`

- Patch em `knowledge_documents`:
  - `status` enum (`uploaded`, `indexing`, `indexed`, `failed`) default `uploaded`
  - `mime_type` string
  - `file_size_bytes` bigint nullable
  - `storage_key` string nullable (S3/local path)
  - `checksum` string nullable (sha256 para dedupe)

### 3.3. `20260601_003_ai_audit_tables.js`

- `ai_usage_logs`
  - `id` UUID PK
  - `organization_id` FK
  - `chatbot_id` FK nullable
  - `conversation_id` FK nullable
  - `provider` string (`openai`/`anthropic`)
  - `model` string
  - `operation` enum (`embed`, `chat`, `rerank`)
  - `prompt_tokens` int
  - `completion_tokens` int
  - `total_tokens` int (generated col)
  - `cost_usd` numeric(10,6)
  - `latency_ms` int
  - `created_at` timestamp
  - Índice composto `(organization_id, created_at desc)`

- `ai_agent_traces`
  - `id` UUID PK
  - `conversation_id` FK
  - `message_id` FK (incoming)
  - `retrieved_chunks` jsonb (array de `{chunkId, score, snippet}`)
  - `prompt_messages` jsonb (truncado pra audit, com hash)
  - `tools_called` jsonb (array de `{name, args, result}`)
  - `decision` enum (`answered`, `fallback_flow`, `transferred_human`)
  - `confidence` numeric(4,3) nullable
  - `created_at` timestamp
  - Índice em `conversation_id`

- `ai_rate_limit_state` (opcional, se não usar Redis)
  - `organization_id` PK
  - `tokens` int
  - `last_refill_at` timestamp

> Manter snake_case no DB e mapear para camelCase nas respostas, conforme convenção da seção 9 do CLAUDE.md.

---

## 4. Estrutura de pastas no backend

```
server/src/modules/ai/
├── ai.routes.js                 # /ai/*  e /knowledge-bases/*
├── ai.controller.js             # validação zod + delegação
├── ai.service.js                # orquestração de alto nível
├── ai.mapper.js                 # snake_case → camelCase
├── ai.guards.js                 # assertKbOwned, assertDocOwned
├── engine/
│   ├── agent.engine.js          # loop tool-use + decisão final
│   ├── context.builder.js       # monta system + history + retrieved
│   ├── tools/
│   │   ├── transfer-to-human.js
│   │   ├── capture-field.js
│   │   ├── trigger-flow.js
│   │   └── search-kb.js
│   └── fallback.bridge.js       # conecta com flow.engine
├── providers/
│   ├── provider.interface.js    # contrato { embed, chat, stream }
│   ├── openai.adapter.js
│   └── anthropic.adapter.js
├── rag/
│   ├── rag.service.js           # facade: retrieve()
│   ├── retriever.js             # SQL pgvector + MMR
│   ├── reranker.js              # opcional, cohere/bge
│   └── citation.builder.js
├── ingestion/
│   ├── ingestion.queue.js       # BullMQ producer
│   ├── ingestion.worker.js      # consumer
│   ├── parsers/
│   │   ├── pdf.parser.js
│   │   ├── docx.parser.js
│   │   ├── html.parser.js
│   │   └── text.parser.js
│   └── chunker.js               # recursive + overlap
├── observability/
│   ├── usage.logger.js
│   └── trace.logger.js
└── ratelimit/
    └── token-bucket.js
```

---

## 5. Endpoints (extensão do contrato)

> Mantém o padrão de `/api/v1` + auth via cookie + CSRF.

### 5.1. Knowledge bases (CRUD)

| Método | Path | Body / Query | Resposta |
|---|---|---|---|
| GET | `/knowledge-bases?chatbotId=` | filtro opcional | `KnowledgeBase[]` |
| GET | `/knowledge-bases/:id` | — | `KnowledgeBase` |
| POST | `/knowledge-bases` | `{ chatbotId, name, embeddingModel?, chunkSize?, chunkOverlap? }` | `KnowledgeBase` |
| PATCH | `/knowledge-bases/:id` | partial | `KnowledgeBase` |
| DELETE | `/knowledge-bases/:id` | — | 204 |

### 5.2. Documentos

| Método | Path | Notas |
|---|---|---|
| GET | `/knowledge-bases/:id/documents?status&cursor&limit` | paginado |
| POST | `/knowledge-bases/:id/documents` | multipart (file) ou `{ title, content, sourceUrl }` — dispara job de ingestão |
| GET | `/knowledge-documents/:id` | inclui `status`, `chunkCount`, `tokensUsed` |
| DELETE | `/knowledge-documents/:id` | cascade nos chunks |
| POST | `/knowledge-documents/:id/reindex` | enfileira job de reembedding |

### 5.3. Agent (preview/playground no editor)

| Método | Path | Notas |
|---|---|---|
| POST | `/chatbots/:id/agent/preview` | `{ message, sessionId? }` → resposta síncrona com `citations`, `toolsCalled`, `traceId` |
| GET | `/chatbots/:id/agent/preview/stream?sessionId=&message=` | SSE — token a token |
| GET | `/chatbots/:id/agent/traces?conversationId=` | últimas N traces para debug |

### 5.4. Configuração do AI Agent (já parcialmente coberto via `PATCH /chatbots/:id`)

`chatbot.aiConfig` precisa ganhar mais campos. Extensão do tipo no front:

```ts
interface ChatbotAIConfig {
  model: string;
  temperature: number;
  systemPrompt?: string;
  knowledgeBaseId?: UUID;
  fallbackFlowId?: UUID;
  // novos
  topK?: number;                     // default 6
  minConfidence?: number;            // 0..1, default 0.65
  maxHistoryMessages?: number;       // default 8
  enabledTools?: ToolName[];         // whitelist
  rateLimit?: { rpm: number };       // override por chatbot
  guardrails?: {
    blockedTopics?: string[];
    requiredDisclaimer?: string;
  };
}
```

> Alinhar com a squad antes de mexer em `client/src/types/domain.ts` — é contrato compartilhado.

### 5.5. Webhook (sem mudar path, mudar comportamento)

`POST /webhooks/evolution/:instance` quando o chatbot resolvido for `ai_agent` → encaminha para `AgentEngine.handleIncoming(...)` em vez de `FlowEngine`. Resto idêntico.

---

## 6. Fases de implementação

> ### Estado real auditado (2026-06-16)
>
> | Fase | Estado | Resumo |
> |---|---|---|
> | F3.1 | ✅ Feito e wired | providers + adapters + `usage.logger` + `/ai/health` + migrations `001‑003` |
> | F3.2 | ❌ ~15% | só migration `002` + `ingestion.queue.js` órfão + `ingestion.worker.js` quebrado |
> | F3.3 | ⚠️ ~40% scaffold | `rag/retriever.js` real, mas MMR falso e `ai/rag.service.js` duplicado vazio; não exposto |
> | F3.4 | ❌ ~20% quebrado | `agent.engine.js` importa 3 módulos inexistentes; não roda |
> | F3.5 | ⚠️ wired/guardado | webhook despachava p/ engine quebrado; branch `ai_agent` guardada com try/catch em 2026-06-16 |
>
> Fora deste roadmap, existe e funciona a feature **"AI Generated" (nível 2)**: geração/ajuste de fluxo por IA em `ai.service.js`. Não confundir com o AI Agent (nível 3) descrito aqui.

### F3.1 — Infra & provider abstraction (sprint 1)

> **Estado real (2026-06-16): ✅ ENTREGUE.** Tudo presente e wired. `/ai/health` ainda checa a tabela `ai_usage_logs` além dos providers (mais rico que a spec).

**Entregáveis**
- Migrations 3.1, 3.2, 3.3 aplicadas em dev
- `LLMProvider` interface + `AnthropicAdapter` + `OpenAIAdapter` (chat + embed)
- Config via env (`AI_PROVIDER`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `AI_DEFAULT_MODEL`, `AI_EMBEDDING_MODEL`)
- Healthcheck `GET /ai/health` valida que o provider responde com `ping`
- `usage.logger.js` registrando toda chamada (embed e chat)

**Critério de aceite**
- `node scripts/ping-ai.js` retorna 200 com latency < 3s em ambos adapters
- Logs aparecem em `ai_usage_logs`

### F3.2 — Pipeline de ingestão (sprint 1-2)

> **Estado real (2026-06-16): ❌ ~15% — PRÓXIMO ENTREGÁVEL, redefinido.** Presente: migration `002` (schema de `knowledge_chunks` + `knowledge_ingestion_jobs` + patch em `knowledge_documents`) e `ingestion/ingestion.queue.js` (producer BullMQ, **mas ninguém o importa**). Faltando/quebrado: `ingestion.worker.js` faz `require('./parsers')` e `./chunker` **inexistentes**; sem `parsers/*`, sem `chunker.js`; sem endpoint `POST /knowledge-bases/:id/documents`; sem lib de multipart (multer/busboy); sem serviço `redis` no compose; worker não sobe no boot; `knowledge.service.js` está **vazio (0 bytes)**. **Antes de construir**, executar a "Lista de limpeza" no fim da seção 6.

**Entregáveis**
- BullMQ + Redis no docker-compose (`redis:7-alpine`)
- `POST /knowledge-bases/:id/documents` aceita multipart e texto
- Parsers para `pdf`, `docx`, `html`, `txt`, `md`
- `chunker.js` recursivo com overlap configurável
- `ingestion.worker.js` processa: parse → chunk → embed em batch (50 chunks/call) → upsert em `knowledge_chunks`
- Atualiza `knowledge_documents.status` e `knowledge_ingestion_jobs`
- Retry exponencial (3x) em falhas transientes; dead letter no `failed`

**Critério de aceite**
- Upload de PDF de 30 páginas finaliza em < 60s e gera N chunks corretos
- Dedupe por `checksum` impede reupload duplicado
- Cancelar deleta cascata (doc → chunks → jobs)

### F3.3 — RAG retrieval (sprint 2)

> **Estado real (2026-06-16): ⚠️ ~40% scaffold, NÃO exposto.** Presente: `rag/retriever.js` com SQL pgvector real (`embedding <=> $1`) **filtrado por `knowledge_base_id`** ✅, e `rag/rag.service.js` (facade `retrieve()`). Problemas: o "MMR" usa um `cosineSimilarity` **falso/heurístico** (`1 - |score_a - score_b|`, sem os vetores reais em memória) — não é MMR de verdade; não há `citation.builder.js` separado; existe um **`ai/rag.service.js` duplicado e vazio** (deletar); nada disso está atrás de endpoint e depende de chunks que só F3.2 produz. Reavaliar o MMR ao retomar.

**Entregáveis**
- `retriever.js`: query SQL com `embedding <=> $1` ordenando por similaridade, filtrando por `knowledge_base_id`
- MMR (Maximal Marginal Relevance) em memória para diversificar top-K
- `citation.builder.js` retorna `{ chunkId, documentId, title, snippet, score }`
- `rag.service.retrieve(kbId, query, opts)` é a única API exposta

**Critério de aceite**
- Tempo médio < 200ms para top-6 numa KB com 5k chunks
- Cross-tenant proof: query em KB de outra org retorna 0 resultados (testar com 2 orgs no seed)

### F3.4 — Agent engine + tools (sprint 2-3)

> **Estado real (2026-06-16): ❌ ~20% scaffold quebrado.** `engine/agent.engine.js` existe e esboça o loop tool-use, mas importa **três módulos inexistentes**: `engine/context.builder`, `engine/tool.router` e `observability/trace.logger`. Não há diretório `engine/tools/`. **Não carrega** — qualquer `require('../ai/engine/agent.engine')` em runtime estoura `MODULE_NOT_FOUND`. Como `trace.logger` não existe, `ai_agent_traces` nunca seria escrito. Tratar como rascunho: completar na fase certa (após F3.2/F3.3) ou deletar.

**Entregáveis**
- `agent.engine.run(input)` implementa loop: monta contexto → chama LLM com tools → se tool_use, executa tool → realimenta → repete até `stop` ou maxIterations (default 4)
- Tools mínimas:
  - `search_kb(query)` → retrieval explícito (LLM decide quando aprofundar)
  - `capture_field(name, value)` → grava em `conversation.flow_context`
  - `transfer_to_human(reason)` → cria ticket + status `waiting`
  - `trigger_flow(flowId, startNodeId?)` → handoff para FlowEngine
- `context.builder` monta: system prompt (org + guardrails) + últimas N messages + contexto recuperado + descrição das tools
- `trace.logger` salva tudo em `ai_agent_traces`
- Decisão final: se confidence (heurística baseada em score médio dos chunks + sinais do LLM) < `minConfidence` → fallback para `fallbackFlowId`

**Critério de aceite**
- Conversa de smoke test (KB com FAQ JetGO) responde com citação correta
- Tool `transfer_to_human` cria ticket e marca `conversation.status = 'waiting'`
- Quando KB não tem resposta, fallback dispara e FlowEngine assume

### F3.5 — Integração com webhook e FlowEngine (sprint 3)

> **Estado real (2026-06-16): ⚠️ parcialmente wired, GUARDADO.** `webhook.service.js` já despacha `chatbot.type === 'ai_agent'` para `agent.engine.run()` (F3.4 quebrado) e referencia `engine/fallback.bridge` (inexistente) — ou seja, **qualquer chatbot marcado como `ai_agent` derrubaria o processamento de mensagens inbound daquela conexão**. Em 2026-06-16 essa branch foi **envolvida em try/catch**: em falha, loga e preserva a mensagem inbound sem enviar resposta automática, em vez de estourar. Idempotência hoje é por `metadata->'evolution'->>'messageId'` (funcional), **não** pela coluna `UNIQUE` da spec. Completar de verdade só depois de F3.2→F3.4 prontos.

**Entregáveis**
- `dispatcher.js` no `webhook/evolution` resolve `chatbot.type`:
  - `manual` / `ai_generated` → `FlowEngine.handle(...)` (já existente)
  - `ai_agent` → `AgentEngine.handleIncoming(...)`
- `fallback.bridge.js` invoca `FlowEngine.startAt(flowId, startNodeId, conversationContext)` preservando contexto
- `messages` persiste com `metadata = { source: 'ai_agent', traceId, citations }`
- Idempotência: `evolution_message_id` UNIQUE em `messages`

**Critério de aceite**
- Enviar mensagem real via Evolution responde via WhatsApp em < 8s p95
- Reentry no fluxo tradicional preserva `flow_context` capturado pelo agente

### F3.6 — Preview/playground no editor (sprint 3)

**Entregáveis**
- `POST /chatbots/:id/agent/preview` para o editor testar antes de publicar
- SSE em `/agent/preview/stream` (provider streaming nativo)
- Frontend consome via `EventSource` e renderiza citações inline

**Critério de aceite**
- Editor do front consegue testar agente sem precisar conectar WhatsApp
- Trace exposto na UI mostra cada chunk recuperado com score

### F3.7 — Observabilidade, custos e rate limit (sprint 4)

**Entregáveis**
- Dashboard `GET /dashboard/ai-usage?range=` agregando `ai_usage_logs`
- Métricas Prom-style (opcional): `ai_requests_total`, `ai_tokens_total`, `ai_latency_ms`
- Token bucket por org via Redis (`ai:rl:{orgId}`); HTTP 429 ao estourar
- Hard cap mensal por org em `organizations.settings.aiMonthlyTokenLimit`
- Alerta (log estruturado) quando org passa 80% do cap

**Critério de aceite**
- Org consegue ver consumo em USD por dia
- Loop infinito de webhook não derruba a plataforma (rate limit aborta)

### F3.8 — Hardening produção (sprint 4)

**Entregáveis**
- Guardrails:
  - Bloquear topics da `aiConfig.guardrails.blockedTopics` via classificação prévia barata (modelo small)
  - Sanitização de prompt injection (strip de instruções tentando sobrescrever system prompt)
  - PII redaction opcional em `messages.content` antes de enviar para LLM
- Encryption-at-rest da `storage_key` (já é PG, mas e se for S3, KMS-managed key)
- Backup das KBs (pg_dump scoping por org para LGPD)
- Documentar processo de "esquecimento" (delete KB → delete chunks → invalidar logs antigos > N dias)
- Load test: 50 conversas simultâneas, p95 < 8s

**Critério de aceite**
- Pen test básico de prompt injection não vaza system prompt
- DPA / LGPD: org consegue exportar e deletar todos os dados de IA

---

### Lista de limpeza (pré-F3.2) — auditada 2026-06-16

Antes de construir F3.2 de verdade, reconciliar os scaffolds órfãos/quebrados deixados por merges fora de ordem. **Decisão tomada no re-baseline:** documentar agora, deletar quando a fase dona for retomada (não apagar nada ainda, exceto o guard de segurança já aplicado no webhook).

**Já aplicado (2026-06-16):**
- [x] `webhook.service.js` — branch `type === 'ai_agent'` envolvida em try/catch para não derrubar o inbound enquanto o AgentEngine está quebrado.

**A limpar quando a fase dona for retomada:**
- [ ] `server/src/modules/ai/rag.service.js` — **vazio (0 bytes), duplicata** de `ai/rag/rag.service.js`. Deletar (F3.3).
- [ ] `server/src/modules/knowledge/{knowledge.model.js, document.model.js, knowledge.service.js}` — **3 arquivos vazios (0 bytes)**. Decidir entre implementar a camada `knowledge` ou consolidar tudo em `modules/ai/` e deletar (F3.2).
- [ ] `server/src/modules/ai/ingestion/ingestion.queue.js` — producer órfão (ninguém importa). Manter e wirar em F3.2, ou deletar se o desenho mudar.
- [ ] `server/src/modules/ai/ingestion/ingestion.worker.js` — reescrever robusto em F3.2 (transaction no upsert, dedupe por checksum, criar `parsers/*` e `chunker.js` que ele importa).
- [ ] `server/src/modules/ai/engine/agent.engine.js` — completar (criar `context.builder`, `tool.router`, `tools/`, `trace.logger`, `fallback.bridge`) em F3.4, ou deletar até lá para não rotacionar dívida quebrada.

**Lacunas de contrato a registrar:**
- [ ] Nenhum endpoint `/knowledge-bases*` está montado em `routes/index.js` — chamadas do front a esse path retornam **404** (nem stub). Entra em F3.2.
- [ ] `docker-compose` ainda sem serviço `redis` (necessário para BullMQ em F3.2).

---

## 7. Contratos de mapeamento (camelCase do front)

```ts
// addições em domain.ts (front)
export interface KnowledgeChunk {
  id: UUID;
  documentId: UUID;
  knowledgeBaseId: UUID;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  metadata?: Record<string, unknown>;
}

export interface IngestionJob {
  id: UUID;
  documentId: UUID;
  status: "pending" | "processing" | "succeeded" | "failed";
  error?: string;
  tokensUsed: number;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
}

export interface AgentPreviewResponse {
  reply: string;
  citations: Array<{
    chunkId: UUID;
    documentId: UUID;
    title: string;
    snippet: string;
    score: number;
  }>;
  toolsCalled: Array<{ name: string; args: Record<string, unknown> }>;
  decision: "answered" | "fallback_flow" | "transferred_human";
  confidence: number;
  traceId: UUID;
  usage: { promptTokens: number; completionTokens: number; costUsd: number };
}

export interface AiUsageSummary {
  rangeStart: string;
  rangeEnd: string;
  totals: {
    requests: number;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
  };
  byDay: Array<{ date: string; costUsd: number; tokens: number }>;
}
```

---

## 8. Variáveis de ambiente novas

```bash
# AI
AI_PROVIDER=anthropic              # anthropic | openai
AI_DEFAULT_MODEL=claude-sonnet-4-6
AI_EMBEDDING_PROVIDER=openai       # embeddings geralmente seguem OpenAI
AI_EMBEDDING_MODEL=text-embedding-3-small
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...

# Ingestão
REDIS_URL=redis://localhost:6379
INGESTION_CONCURRENCY=4
INGESTION_MAX_FILE_BYTES=20971520  # 20MB

# RAG
RAG_TOP_K_RETRIEVE=20
RAG_TOP_K_RETURN=6
RAG_MIN_SIMILARITY=0.25

# Rate limit
AI_RPM_DEFAULT=30
AI_MONTHLY_TOKEN_CAP_DEFAULT=2000000

# Custos (USD por 1M tokens, atualizar conforme provider)
COST_ANTHROPIC_INPUT_PER_1M=3.00
COST_ANTHROPIC_OUTPUT_PER_1M=15.00
COST_OPENAI_EMBED_PER_1M=0.02
```

---

## 9. Testes (Definition of Done por fase)

| Tipo | Cobertura mínima | Onde |
|---|---|---|
| Unit | chunker, mapper, citation.builder, token-bucket | `__tests__/ai/*.spec.js` |
| Integration | endpoints CRUD KB/docs + ingestão completa (mock provider) | `__tests__/integration/ai/*.spec.js` |
| RAG eval | golden set de 30 perguntas com resposta esperada → recall@6 ≥ 0.8 | `__tests__/ai/rag.eval.js` |
| Cross-tenant | 2 orgs com KBs distintas, query nunca cruza | `__tests__/ai/tenancy.spec.js` |
| E2E | webhook real → agente → mensagem enviada (Evolution sandbox) | `__tests__/e2e/agent.spec.js` |
| Load | k6 com 50 conversas simultâneas, p95 < 8s | `load/agent.js` |

---

## 10. Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Custo da OpenAI/Anthropic explodir em loop de webhook | Financeiro alto | Rate limit + idempotência + monthly cap por org |
| Embeddings ficarem stale (modelo trocado) | Qualidade cai | `POST /knowledge-documents/:id/reindex` + flag `embedding_model_version` no chunk |
| Prompt injection vazando system prompt | Segurança | Sanitização + isolamento de papéis + nunca incluir secrets no system prompt |
| Cross-tenant leak | LGPD / contrato | Toda query JOIN passa por `organization_id`; teste obrigatório |
| pgvector escalar mal além de 1M chunks | Performance | Migrar para Pinecone/Qdrant; manter interface `Retriever` para troca |
| Provider fora do ar | Disponibilidade | Failover OpenAI ↔ Anthropic no AgentEngine via flag dinâmica |
| LLM "alucinar" sem citação | UX / confiança | Forçar tool `search_kb` antes de answer; rejeitar resposta sem citation se KB obrigatória |
| Latência alta no WhatsApp | UX | Resposta progressiva ("digitando...") via Evolution presence event |

---

## 11. Sequência sugerida de PRs

> ⚠️ **Esta sequência não foi seguida (2026-06-16).** PR A (schema/PR B providers) está feita, mas pedaços de PR C/D/E (ingestion, rag, agent engine) e PR G (webhook wire) foram mergeados fora de ordem e incompletos via `iago-scosta/AI-integracao`. Use o quadro "Estado real auditado" da seção 6 como verdade, não a lista abaixo. Próxima PR efetiva: **F3.2 (ingestion) redefinida**, precedida pela limpeza dos scaffolds (ver fim da seção 6).

1. **PR A** — migrations + pgvector + tabelas auxiliares (`feat/ai-schema`)
2. **PR B** — provider abstraction + adapters + health (`feat/ai-providers`)
3. **PR C** — ingestion pipeline (parsers + chunker + worker) (`feat/ai-ingestion`)
4. **PR D** — RAG service + retriever (`feat/ai-rag`)
5. **PR E** — agent engine + tools + fallback bridge (`feat/ai-agent-engine`)
6. **PR F** — endpoints REST + preview/SSE (`feat/ai-endpoints`)
7. **PR G** — webhook dispatcher patch + idempotência (`feat/ai-webhook-wire`)
8. **PR H** — observability + rate limit + dashboards (`feat/ai-observability`)
9. **PR I** — guardrails + hardening + load tests (`feat/ai-hardening`)

Cada PR contra `develop`, com testes próprios, sem mergear direto em `main`.

---

## 12. Checklist final (antes de chamar de "pronto pra cliente")

- [ ] Cross-tenant testado com 2 orgs (zero vazamento)
- [ ] Reindex completo de uma KB de 500 docs roda em < 30min
- [ ] Rate limit corta loop infinito de webhook
- [ ] Trace de qualquer conversa pode ser auditado em < 5 cliques
- [ ] Cliente consegue exportar+deletar todos os dados de IA da org (LGPD)
- [ ] Custo médio por conversa documentado (USD)
- [ ] Fallback flow assume sem perder `flow_context`
- [ ] Prompt injection clássico não escapa do system prompt
- [ ] p95 webhook→resposta WhatsApp < 8s em load test
- [ ] Documentação interna de operações (runbook: re-embed, swap provider, throttle org)
