---
description: Iniciar uma nova fase do roadmap AI Agent + RAG (F3.X)
---

Iniciar trabalho na fase **$ARGUMENTS** do roadmap AI Agent + RAG.

Execute os passos NA ORDEM, sem pular nenhum:

## 1. Contexto obrigatório
- Leia integralmente: @CLAUDE.md (especialmente seções 3, 9, 13)
- Leia integralmente: @docs/AI_AGENT_RAG_ROADMAP.md
  - Foque na seção 6 referente à fase **$ARGUMENTS**
  - Releia a seção 2 (decisões técnicas), 7 (contratos), 9 (DoD), 11 (sequência de PRs)
- Verifique o estado atual do repo:
  - `git status` (deve estar limpo)
  - `git branch --show-current` (deve estar em `develop`)
  - `git log --oneline -10` (confirmar que fases anteriores foram mergeadas)

## 2. Confirmar pré-requisitos da fase
Releia a seção "Pré-requisito" no topo do `AI_AGENT_RAG_ROADMAP.md` e os critérios de aceite da fase imediatamente anterior. Se algum pré-requisito não estiver atendido, **PARE** e reporte ao usuário antes de criar branch.

## 3. Criar a branch
A partir de `develop` atualizada:
```
git checkout develop
git pull origin develop
git checkout -b feat/ai-<slug-derivado-da-fase>
```
Use o slug sugerido na seção 11 do roadmap (ex: `feat/ai-ingestion` para F3.2).

## 4. Entrar em plan mode e entregar:
- Lista de arquivos a CRIAR (path absoluto)
- Lista de arquivos a EDITAR (path + razão)
- Ordem de execução
- Dependências npm novas (com versão)
- Migrations novas (se houver)
- Como rodar smoke test ao final

## 5. AGUARDAR aprovação do plano
Não escreva código antes de o usuário aprovar com `Esc + a` ou pedir ajustes.

## 6. Restrições não-negociáveis
- Toda query SQL nova filtra por `organization_id` (CLAUDE.md §9)
- Validação `zod` em todo controller
- Mapeamento snake_case → camelCase nas respostas
- Operações multi-tabela em `db.transaction()`
- Nunca alterar código fora do escopo da fase
- Reaproveitar o que já existe em `server/src/modules/ai/` (providers, usage.logger, pricing)
- Nunca expor `password_hash`, `token_hash`, secrets de provider
