---
description: Auditar isolamento multi-org em todas as queries adicionadas
---

Auditar multi-tenancy em todo SQL/knex tocado na branch atual.

Multi-tenancy é convenção não-negociável (CLAUDE.md §9). Vazamento cross-org = bug crítico.

## 1. Coletar diff
```
git diff develop..HEAD -- 'server/src/**/*.js'
```

## 2. Para cada query knex nova/modificada, verificar:

### Padrão A — tabela tenant-aware direta (organization_id na própria tabela)
Toda query DEVE conter `.where('organization_id', req.auth.organizationId)` ou equivalente.

Tabelas tenant-aware diretas:
- organizations, users, chatbots, whatsapp_connections, contacts, conversations
- tickets, knowledge_bases, ai_usage_logs, ai_agent_traces

### Padrão B — tabela tenant-aware via JOIN
Tabelas filhas filtram via JOIN com a tabela-mãe + filtro `organization_id`:
- flows → JOIN chatbots
- flow_nodes / flow_edges → JOIN flows → JOIN chatbots
- messages → JOIN conversations
- knowledge_documents → JOIN knowledge_bases → JOIN chatbots
- knowledge_chunks → JOIN knowledge_bases → JOIN chatbots
- knowledge_ingestion_jobs → JOIN knowledge_documents → ...

### Padrão C — operações de escrita
- `INSERT` precisa setar `organization_id` explicitamente (não confiar em default)
- `UPDATE`/`DELETE` precisam de `WHERE organization_id = ...` + `WHERE id = ...` (nunca só por id)
- `db.raw(...)` precisa de bind parametrizado, nunca interpolação de string

## 3. Casos suspeitos a sinalizar
- Query sem `.where(...)` (provavelmente lista global)
- `req.params.id` usado direto sem cross-check de ownership
- Função utilitária genérica que recebe `id` mas não recebe `organizationId`
- Service que aceita `organizationId` opcional
- Endpoint que faz read e devolve `organization_id` no payload (vaza tenant ID, mesmo sendo do próprio cliente — preferir mascarar)

## 4. Cross-tenant test sugerido
Para a fase atual, descrever em pseudo-código um teste com 2 orgs:
```
Seed org A (admin@orgA.local) + recurso X em A
Seed org B (admin@orgB.local) + recurso Y em B
Login como org B → tentar acessar X via endpoint da fase → DEVE 404
Login como org B → list endpoint da fase → resposta DEVE conter só Y
```

## 5. Relatório
```
## Tenancy audit — <branch>

### Queries auditadas: <N>
- ✅ path:linha — padrão A com filtro correto
- ✅ path:linha — padrão B via JOIN com chatbots
- ❌ path:linha — FALTA filtro de tenant
- ⚠️ path:linha — query genérica sem ownership check

### Cross-tenant test sugerido
<pseudo-código>

### Pronto?  SIM | NÃO
```
