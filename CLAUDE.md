# CLAUDE.md — JetGO

> Contexto persistente para qualquer sessão Claude trabalhando neste projeto.
> Última atualização: 2026-06-18 (F3.4 Agent engine implementada e validada).

---

## 1. Produto

**JetGO** — plataforma SaaS de criação, edição e publicação de chatbots integrados ao WhatsApp via EvolutionAPI.

Substitui o JetGO legacy (formulários sequenciais rígidos + visualização estática) por um editor visual drag & drop em canvas, permitindo reorganizar fluxos complexos sem edição linear.

**Três níveis de chatbot:**
1. **Manual** — fluxo desenhado em canvas com respostas pré-definidas
2. **AI Generated** — fluxos tradicionais criados automaticamente via Gen AI
3. **AI Agent** — agentes de IA com base de conhecimento (RAG) + fallback para fluxo tradicional

---

## 2. Modelo de negócio

**B2B SaaS para PMEs e empresas** que querem automatizar atendimento via WhatsApp.

- Tenancy multi-org (toda query filtra por `organization_id`)
- Cliente paga pelo acesso à plataforma e provisiona suas próprias conexões WhatsApp via EvolutionAPI
- Cobrança recorrente **ainda não integrada** (Stripe/pagamentos é trabalho futuro, não está no escopo atual)

---

## 3. Estado atual

**Pre-launch / desenvolvimento ativo.** Zero usuários reais — ambiente é só desenvolvimento.

**Fases concluídas:**
- **Frontend** (PR #1) — Vite + React 18 + shadcn/ui + React Flow + TanStack Query
- **Fase 0** (PR #6 + #7) — infra, auth, schema inicial, stubs do contrato
- **Fase 1** — `chatbot.module` + `flow.module` + `flow-nodes` + `flow-edges` em knex
- **Fase 2** — WhatsApp (EvolutionAPI), webhook, conversations, tickets, dashboard
- **Fase 3.1** — Infra de IA: pgvector, migrations `20260601_001..003`, provider abstraction (`modules/ai/providers/{anthropic,openai}.adapter.js`), `usage.logger`, `GET /api/v1/ai/health`, script `npm run ai:ping`
- **Fase 3.2** — Pipeline de ingestão RAG: upload de documentos (multipart/texto), parsers (pdf/docx/html/txt/md), `chunker.js` recursivo, `storage.js` local, worker BullMQ (`parse→chunk→embed→knowledge_chunks`), endpoints `/knowledge-bases` + `/knowledge-documents` em `modules/ai/knowledge/`, `redis` no compose, `npm run worker`
- **Fase 3.3** — RAG retrieval: `rag/retriever.js` (pgvector top-K + **MMR real** sobre os embeddings dos candidatos), `rag/citation.builder.js`, facade `rag/rag.service.js` (tenancy via `assertKbOwned` + custo do embed em `ai_usage_logs` + defaults via env `RAG_*`), endpoint `POST /knowledge-bases/:id/search`, smoke `npm run rag:smoke`. Duplicata vazia `ai/rag.service.js` removida
- **Fase 3.4** — Agent engine: `engine/agent.engine.js` reescrito (loop tool-use nativo: chat → tool_use → realimenta turno assistant+tool → repete até stop/`AI_MAX_AGENT_ITERATIONS`) consumindo o `rag.service` da F3.3. Novos: `engine/context.builder.js` (system+guardrails+contexto+histórico), `engine/tool.router.js` (defs+whitelist), `engine/tools/{search-kb,capture-field,transfer-to-human,trigger-flow}.js`, `observability/trace.logger.js` (grava `ai_agent_traces`). Contrato de provider estendido (turno `assistant` com `toolCalls`) p/ tool-use multi-turno. Smoke `npm run agent:smoke`, **validado ao vivo** em Anthropic `claude-sonnet-4-6` e OpenAI `gpt-4o-mini`. **Escopo engine-only**: `fallback.bridge`, re-wire do webhook e idempotência `UNIQUE` ficam na F3.5
- **AI Generated (nível 2 do produto)** — geração e ajuste de fluxos por IA via `ai.service.js` (`generateInitialFlow` / `adjustExistingFlow`), consumido pelo módulo `chatbot`. Funciona e está wired, **mas não faz parte do roadmap RAG** abaixo (que cobre o nível 3, AI Agent). Não confundir os dois.

### Estado real da Fase 3 (auditado 2026-06-16)

⚠️ O roadmap assume **9 PRs isoladas e sequenciais** sobre um `develop` limpo. **Isso não corresponde mais à realidade**: merges anteriores (`iago-scosta/AI-integracao`) scaffoldaram F3.3/F3.4/F3.5 **fora de ordem e pela metade**, inclusive ligando um caminho quebrado no webhook. Estado verificado por fase:

| Fase | Escopo | Estado real |
|---|---|---|
| **F3.1** Infra & providers | adapters, usage.logger, /ai/health | ✅ **Feito e wired** |
| **F3.2** Ingestão | parsers, chunker, upload, worker | ✅ **Feito e wired** — parsers (pdf/docx/html/txt/md), `chunker.js`, `storage.js`, worker BullMQ robusto (transação no upsert, dedupe por checksum, falha só na última tentativa), endpoints KB+documentos montados, `redis` no compose, `npm run worker`. Camada vazia `modules/knowledge/` removida (consolidada em `modules/ai/knowledge/`) |
| **F3.3** RAG retrieval | retriever pgvector + MMR + citações | ✅ **Feito e wired** — `rag/retriever.js` (top-K filtrado por `knowledge_base_id` + **MMR real** sobre os vetores), `rag/citation.builder.js`, facade `rag/rag.service.js` (tenancy + log de custo do embed + env `RAG_*`), exposto em `POST /knowledge-bases/:id/search`; duplicata vazia `ai/rag.service.js` deletada |
| **F3.4** Agent engine | loop tool-use + tools | ✅ **Feito e validado** — `agent.engine.run()` (loop tool-use + realimentação), `context.builder`, `tool.router` + `tools/` (search_kb/capture_field/transfer_to_human/trigger_flow), `trace.logger` → `ai_agent_traces`. Contrato de provider estendido p/ tool-use multi-turno. Smoke `npm run agent:smoke` verde nos 2 providers (Anthropic+OpenAI). Handoff real ao FlowEngine + idempotência = F3.5 |
| **F3.5** Webhook wire | dispatcher ai_agent | ⏳ **Próxima** — o webhook já chama o engine (agora funcional) sob try/catch, então o caminho *answer* já responde; falta `engine/fallback.bridge.js` (handoff real ao FlowEngine), remover o guard try/catch, e idempotência `evolution_message_id UNIQUE` em `messages` |

**Próximo passo real:** F3.5 (Webhook wire) — criar `engine/fallback.bridge.js` (dirige o FlowEngine a partir do `fallbackFlowId`/`flow_context`), remover o guard try/catch do `webhook.service.js`, e adicionar idempotência `evolution_message_id UNIQUE` em `messages`. O AgentEngine (F3.4) já está pronto e validado. **Pendência de tuning** (não bloqueia): `minConfidence` default 0.65 é alto demais vs scores reais do embedding (~0.4–0.5) — quase todo acerto cai em fallback; calibrar na F3.7. Ver estado por fase em [`AI_AGENT_RAG_ROADMAP.md`](./docs/AI_AGENT_RAG_ROADMAP.md) §6.

Detalhes técnicos do backend até a Fase 2 em [`jetgo-context.md`](./jetgo-context.md).

---

## 4. Stack principal

**Frontend** (mergeado, contrato estável)
- Vite + React 18 + TypeScript
- shadcn/ui + TailwindCSS
- React Flow (canvas de fluxos)
- TanStack Query (data fetching)
- Axios com interceptors CSRF

**Backend**
- Node.js + Express 4.21 (rebaixado de v5 por compat de middlewares)
- PostgreSQL + knex (Mongoose foi removido — decisão deliberada)
- PKs em UUID via `gen_random_uuid()` (pgcrypto), enums nativos do Postgres
- Auth: JWT em cookie httpOnly + CSRF double-submit
- Validação: zod em todos os controllers
- Docker Compose para Postgres local (imagem `pgvector/pgvector:pg15` desde a F3.1)

**IA (Fase 3)**
- Providers plugáveis via env: `AI_CHAT_PROVIDER` (default `anthropic`), `AI_EMBEDDING_PROVIDER` (default `openai`)
- SDKs: `@anthropic-ai/sdk`, `openai`
- Chat default: `claude-sonnet-4-6` · Embedding default: `text-embedding-3-small` (1536d)
- Vector store: pgvector com índice HNSW (cosine) em `knowledge_chunks.embedding`
- Auditoria de custo/latência em `ai_usage_logs`; traces de agente em `ai_agent_traces`

**Banco**
- 16 tabelas: organizations, users, refresh_tokens, chatbots, flows, flow_nodes, flow_edges, whatsapp_connections, contacts, conversations, messages, tickets, knowledge_bases, knowledge_documents, knowledge_chunks, knowledge_ingestion_jobs, ai_usage_logs, ai_agent_traces
- Migrations: `20260504_001_initial_schema`, `20260601_001_enable_pgvector`, `20260601_002_knowledge_chunks_and_jobs`, `20260601_003_ai_audit_tables`
- Seed dev: `admin@jetgo.local / jetgo123`

---

## 5. Integrações externas

- **EvolutionAPI v2** — WhatsApp (Fase 2 entregue). Doc: https://doc.evolution-api.com
- **Anthropic** — chat do AI Agent. SDK: `@anthropic-ai/sdk`. Model default: `claude-sonnet-4-6`.
- **OpenAI** — embeddings (Anthropic não tem embedding público). SDK: `openai`. Model default: `text-embedding-3-small`.
- **pgvector** — extensão Postgres para retrieval semântico (F3.1 entregue).
- **Redis + BullMQ** — fila de ingestão assíncrona (vem na F3.2, ainda não está no compose).

Sem dependências externas adicionais (pagamentos, analytics, email transacional) no escopo atual.

---

## 6. Volume de dados

Zero. Ambiente é só desenvolvimento. Não há considerações de escala/performance baseadas em volume real ainda — projetar para multi-tenancy e queries indexadas corretamente é suficiente nesta fase.

---

## 7. Repositório e branches

- **Repo**: `iago-scosta/Squad-2-Jetsales`
- **Branch principal**: `develop` (NÃO é `main`)
- Toda nova feature → branch dedicada → PR contra `develop`
- Não mergear nada direto em `main`

---

## 8. Contrato front ↔ back (CRÍTICO)

O frontend está pronto e fala um contrato bem definido em `client/src/lib/api/*.ts`. **Toda mudança no backend deve respeitar este contrato.**

- Base URL: `/api/v1`
- Cookies: `jetgo_at` (access JWT, 15min, httpOnly), `jetgo_rt` (refresh, 30d, httpOnly, path `/api/v1/auth`), `csrf_token` (legível pelo JS)
- Toda request state-changing precisa header `X-CSRF-Token` = cookie `csrf_token`
- CORS com `credentials: true` + allowlist via `FRONTEND_ORIGINS`
- Em produção: cookies precisam `sameSite: 'none'` + `secure: true`

**Antes de mexer em qualquer endpoint:** ler o arquivo correspondente em `client/src/lib/api/` e usar `client/src/types/domain.ts` como fonte da verdade dos shapes de resposta.

Lista completa dos 40 endpoints e seu estado (pronto / stub / vazio) em [`jetgo-context.md`](./jetgo-context.md), seções 3 e 4.

---

## 9. Convenções não-negociáveis

- **ORM**: knex (Mongoose foi removido)
- **PKs**: UUID, não auto-increment
- **Naming**: snake_case no DB, camelCase no código JS. Respostas JSON expostas pelo back são **camelCase** (service mapeia `created_at` → `createdAt` ao serializar)
- **Validação**: zod em todos os controllers, ZodError vira 400 com `fields`
- **Tenancy**: tudo é multi-org. Toda query filtra por `organization_id` do `req.auth.organizationId`
- **Datas**: ISO 8601 (`toISOString()`)
- **Erros**: `httpError(status, message, code)` do `error.middleware.js`
- **Operações multi-tabela**: sempre `db.transaction()`
- **Nunca retornar**: `password_hash`, `token_hash`, ou outros campos sensíveis
- **Testar sempre com 2 orgs no seed** para garantir que não vaza dados cross-tenant

---

## 10. Como rodar localmente

```bash
# Postgres com pgvector
docker compose up -d postgres

# Server
cd server
cp .env.example .env
# Gerar secrets:
#   openssl rand -hex 64  → JWT_ACCESS_SECRET
#   openssl rand -hex 64  → JWT_REFRESH_SECRET
# Preencher (para Fase 3):
#   ANTHROPIC_API_KEY=...
#   OPENAI_API_KEY=...
npm install
npm run migrate
npm run seed       # cria admin@jetgo.local / jetgo123
npm run ai:ping    # smoke test dos providers (Fase 3)
npm run dev        # http://localhost:3001

# Client
cd ../client
npm install
npm run dev        # http://localhost:5173
```

> ⚠️ Se subiu o stack antes da F3.1, recrie o volume: `docker compose down -v && docker compose up -d postgres` (imagem do Postgres mudou para `pgvector/pgvector:pg15`).

---

## 11. Como retomar trabalho

1. `git checkout develop && git pull` — sincroniza
2. Confirmar a fase ativa lendo a seção 3 deste arquivo + checklist da seção 12 do [`AI_AGENT_RAG_ROADMAP.md`](./docs/AI_AGENT_RAG_ROADMAP.md)
3. Verificar quais módulos têm conteúdo real (`ls server/src/modules/`) e quais migrations foram aplicadas (`npm run migrate -- --dry-run` ou inspeção em `knex_migrations`)
4. Antes de mexer em endpoint, ler `client/src/lib/api/<dominio>.ts` (contrato) e `client/src/types/domain.ts` (shapes)
5. **Uma PR por sessão Claude Code.** Branch dedicada (`feat/<slug>`) → PR contra `develop`. Nunca mergear em `main`.
6. Se for Fase 3, use os slash commands `/start-fase`, `/review-fase`, `/validate-tenancy` (ver seção 13)

---

## 12. Documentos de apoio

- [`AI_AGENT_RAG_ROADMAP.md`](./docs/AI_AGENT_RAG_ROADMAP.md) — **fase ativa.** Roadmap completo do AI Agent + RAG em 9 PRs (F3.1..F3.8), com arquitetura, migrations, contratos, riscos e checklist
- [`jetgo-context.md`](./jetgo-context.md) — handoff técnico completo do backend, mapa de endpoints, estado das fases até a 2
- [`FASE_2_FLOW_SPEC.md`](./FASE_2_FLOW_SPEC.md) — especificação do flow runtime
- [`PROMPT_DB_ENRICHMENT.md`](./PROMPT_DB_ENRICHMENT.md) — prompt de enriquecimento do schema
- [`JETGO_LOVABLE_SYSTEM_DESIGN_PROMPT.md`](./JETGO_LOVABLE_SYSTEM_DESIGN_PROMPT.md) — system design original do front
- `Figma Export/` — telas de referência (LOGIN, HOME, MENU, conexões WhatsApp, tickets, chatbot)

---

## 13. Workflow Fase 3 — AI Agent + RAG

A Fase 3 é entregue em **9 PRs sequenciais** (F3.1 → F3.8 + variantes). F3.1 já está mergeada.
Cada PR = uma sessão isolada do Claude Code = uma branch dedicada.

**Roadmap fonte:** [`AI_AGENT_RAG_ROADMAP.md`](./docs/AI_AGENT_RAG_ROADMAP.md), seções 6 (fases) e 11 (sequência de PRs).

### 13.1. Slash commands disponíveis

Os comandos vivem em `.claude/commands/` no repo:

| Comando | Uso | O que faz |
|---|---|---|
| `/start-fase F3.X` | Iniciar nova fase | Lê roadmap+CLAUDE.md, cria branch, entra em plan mode |
| `/review-fase` | Antes de fechar PR | Audita diff vs critérios de aceite + checklist transversal |
| `/validate-tenancy` | Após qualquer query nova | Confirma filtro `organization_id` em todos os SQL adicionados |

### 13.2. Fluxo recomendado por sessão

```
1. /start-fase F3.X       → roadmap lido, branch criada, plan mode ativo
2. <revisar plano>        → aprovar com Esc+a, ou ajustar
3. <execução>             → Claude codifica respeitando o plano
4. /validate-tenancy      → checa multi-org em tudo que mudou
5. /review-fase           → audita contra critérios de aceite do roadmap
6. <commit + push + PR>   → manualmente, sempre contra develop
7. Mergear PR antes de iniciar a próxima fase
```

### 13.3. Anti-padrões a evitar

- Colar o roadmap inteiro num prompt único — sempre referenciar via `@AI_AGENT_RAG_ROADMAP.md` e indicar a seção
- Pular plan mode em PRs grandes (F3.4 agent engine, F3.7 observability) — sempre `Shift+Tab` 2x antes
- Misturar duas fases na mesma branch — cada F3.X é uma PR isolada
- Confiar no auto-resumo do Claude — sempre rodar `git diff develop..HEAD` antes de fechar
- Trocar provider sem mexer só nas env vars — qualquer chamada direta a `AnthropicAdapter`/`OpenAIAdapter` fora de `modules/ai/providers/index.js` é bug

### 13.4. Gates obrigatórios antes de mergear uma PR de Fase 3

- [ ] `npm run migrate` roda sem erro em dev limpo
- [ ] `npm run ai:ping` continua verde
- [ ] `git diff develop..HEAD` revisado com `/review-fase`
- [ ] Cross-tenant testado se a PR tocou query (2 orgs no seed)
- [ ] Seção 12 do roadmap atualizada se a fase concluir um item do checklist final
- [ ] Esta seção 3 do CLAUDE.md atualizada marcando a F3.X como entregue
