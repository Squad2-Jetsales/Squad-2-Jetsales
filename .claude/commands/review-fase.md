---
description: Auditar a PR atual contra os critérios de aceite do roadmap antes de mergear
---

Auditar rigorosamente a branch atual contra o roadmap.

## 1. Diff a auditar
```
git diff develop..HEAD --stat
git diff develop..HEAD
```
Identifique a fase em andamento (nome da branch + commits + arquivos tocados).

## 2. Cross-check contra o roadmap
- Abra @docs/AI_AGENT_RAG_ROADMAP.md
- Localize a fase (F3.X) na seção 6
- Para CADA entregável listado em "Entregáveis", confirme com path:linha do diff onde foi implementado
- Para CADA item em "Critério de aceite", marque ✅ ou ❌ com justificativa
- Se algum item não tem prova no código, listar como GAP

## 3. Cross-check transversal (CLAUDE.md §9)
Para cada arquivo `.js` novo/modificado, verifique:
- [ ] Toda query knex tem `where('organization_id', ...)` (direto ou via JOIN)
- [ ] Validação `zod` em controllers que recebem body/query/params
- [ ] Mapper snake_case → camelCase nas respostas (não vaza `created_at`, `password_hash`, etc.)
- [ ] Datas serializadas com `.toISOString()`
- [ ] Erros via `httpError(status, message, code)` — não `throw new Error(...)` direto
- [ ] Operações multi-tabela dentro de `db.transaction(async (trx) => {...})`
- [ ] Nenhuma chamada direta a adapters de provider — sempre via `modules/ai/providers/index.js`

## 4. Cross-check de contrato (front ↔ back)
Para cada endpoint novo:
- [ ] Path bate com `client/src/lib/api/*.ts`
- [ ] Shape de resposta bate com `client/src/types/domain.ts`
- [ ] Se o tipo do front precisa ser estendido, listar mudanças propostas

## 5. Smoke checklist
Sugira ao usuário rodar (não execute sem autorização):
- `npm run migrate` (deve aplicar sem erro)
- `npm run ai:ping` (deve continuar verde)
- Smoke test específico da fase (ex: upload de PDF para F3.2)

## 6. Relatório final
Entregue em formato:
```
## F3.X review — <slug-da-branch>

### Entregáveis (roadmap §6)
- ✅ <item> — path:linha
- ❌ <item> — FALTA: <descrição>

### Critérios de aceite
- ✅ ...
- ❌ ...

### Transversal (CLAUDE.md §9)
- ✅ multi-tenancy: <N queries verificadas>
- ❌ zod ausente em: <path:linha>

### Contrato front
- ✅ <endpoint> compatível
- ⚠️ <endpoint> requer atualização em <client/src/...>

### Pronto para merge?  SIM | NÃO (motivos)
```
