# Plano de fechamento — Fase 2

> Documento de PO. Lê-se em 5 minutos. Discutível.
> Inventário técnico detalhado vive em [BUGS_FASE2.md](BUGS_FASE2.md).

## 1. Objetivo

Encerrar a Fase 2 com o **golden path do produto funcionando ponta a ponta**:

> Operador cria chatbot → desenha um fluxo no editor → publica → cliente
> envia mensagem no WhatsApp → bot responde → conversa aparece no painel
> de tickets.

Hoje cada estação dessa cadeia tem código, mas a cadeia **não fecha**. A
Fase 2 só está pronta quando esse caminho é repetível em ambiente real, sem
intervenção manual no banco.

## 2. Princípios

1. **Não criar feature nova.** Tudo o que está no plano corrige código já
   mergeado ou esconde código não entregue. Se aparecer ideia nova, vai pro
   backlog Fase 3.
2. **Golden path primeiro, polimento depois.** Bug que mente para o usuário
   final (ex.: "Criar com IA" que retorna 501) é tão grave quanto bug que
   trava o fluxo.
3. **Sem stub silencioso no boot.** Se o servidor liga com `MODULE_BROKEN` ou
   `Unknown node type`, a Fase 2 não está fechada.
4. **Decisões de produto antes de código.** Os itens marcados com 🟡
   precisam de resposta antes de o dev pegar a tarefa.

## 3. Plano em 4 ondas (+ Onda 5 de fechamento)

Ondas são sequenciais (dependências reais entre elas), mas dentro de cada
onda os bugs podem rodar em paralelo se o time permitir.

### Onda 1 — Higiene de boot (S, ~½ sprint)

**Por que primeiro:** dá base limpa para validar as próximas ondas sem ruído
de log. Risco zero, ganho de sinal alto.

| Bug | Severidade | Esforço | Owner sugerido |
|-----|-----------|---------|----------------|
| [B-02](BUGS_FASE2.md#b-02--rotas-flow-nodes-e-flow-edges-carregam-em-modo-stub-503) — rotas `/flow-nodes` e `/flow-edges` em stub 503 | P0 | S | backend |
| [B-09](BUGS_FASE2.md#b-09--dead-code-flowruntimeservicejs-e-flowruntimecontrollerjs) — apagar `flow.runtime.*` | P2 | XS | backend |
| [B-10](BUGS_FASE2.md#b-10--diretório-servermigrations-órfão) — apagar `server/migrations/` órfão | P2 | XS | backend |
| [B-08](BUGS_FASE2.md#b-08--engine-emite-consolewarnunknown-node-type--para-tipos-válidos) — warns "Unknown node type" | P2 | XS | backend |

**Definition of Done da Onda 1:**
- `npm run dev` em `server/` sobe sem nenhum `MODULE_BROKEN`,
  `NOT_IMPLEMENTED` ou `Unknown node type` no log.
- `grep -R "flow.runtime" server/` retorna vazio.
- Editor continua salvando fluxo via `PUT /flows/:id/graph` (não regrediu).

### Onda 2 — Golden path destravado (L, 1 sprint)

**Por que agora:** sem isso, criar um bot novo é inutilizável.
Internamente é uma cadeia: cada bug depende do anterior estar resolvido.

| Bug | Severidade | Esforço | Owner sugerido |
|-----|-----------|---------|----------------|
| [B-03](BUGS_FASE2.md#b-03--criar-chatbot-manual-não-vincula-fluxo--editor-mostra-sem-fluxo-ativo) — criar bot manual já gera flow draft + vincula | P0 | M | full-stack |
| [B-07](BUGS_FASE2.md#b-07--publishflow-não-promove-o-flow-a-active_flow_id-do-chatbot) — `publishFlow` promove a `active_flow_id` | P0 | S | backend |
| [B-01](BUGS_FASE2.md#b-01--mensagens-recebidas-do-whatsapp-não-acionam-o-flowengine) — webhook aciona `FlowEngine` e responde via Evolution | P0 | L | backend |

**Decisões de produto necessárias (🟡):**
- **B-03**: o flow draft criado vem com 1 node (`trigger`) ou com um
  esqueleto mais útil (`trigger → message "Olá" → end`)? Recomendo só
  `trigger` para não engessar.
- **B-01**: como persistimos sessão? Reusar
  `conversations.current_node_id` (coluna já existe no schema) e dar adeus
  ao `flowSessions Map` em memória para o caminho do WhatsApp? Recomendo
  sim — vai precisar de qualquer forma para sobreviver a deploys.

**Definition of Done da Onda 2:**
- Smoke test manual completo: criar bot → editar → publicar →
  mandar mensagem real no WhatsApp → ver mensagem `out` no banco e no
  painel de tickets.
- Documentado em [DEMO.md](DEMO.md) como roteiro reproduzível.
- Sessão sobrevive a restart do backend (estado no banco, não no Map).

### Onda 3 — Engine respeita o desenho do fluxo (M, ½ sprint)

**Por que agora:** assim que a Onda 2 fechar, vamos ter fluxo real
rodando — e os blocos `Condição` e `Aguardar`, que o operador desenha
hoje na UI, vão mostrar que **não funcionam**. Isso quebra confiança no
editor.

| Bug | Severidade | Esforço | Owner sugerido |
|-----|-----------|---------|----------------|
| [B-05](BUGS_FASE2.md#b-05--bloco-condição-ignora-source_handle-em-runtime) — ConditionNode true/false em runtime | P1 | M | backend |
| [B-06](BUGS_FASE2.md#b-06--bloco-aguardar-não-espera) — WaitNode aplica delay | P1 | S | backend |

**Definition of Done da Onda 3:**
- Teste manual no FlowTesterDialog com fluxo
  `trigger → capture → condition(contains "x") → [true] msgA / [false] msgB`
  direciona certo.
- Wait de 2s entre dois `message` é observável (cronômetro no tester).

### Onda 4 — IA: implementar ou esconder (🟡 decisão crítica)

**Bloqueador:** essa onda **não tem solução técnica até produto decidir**.
Hoje o front mostra "Criar com IA" e "Ajustar com IA" e os endpoints
respondem 501. Isso é pior do que não existir, porque promete e falha.

| Cenário | O que fazer | Esforço |
|---------|-------------|---------|
| **A) Esconder na UI** | Feature flag `VITE_ENABLE_AI=false` nos dois botões + dialogs. Endpoints continuam 501 mas ninguém clica. Fase 3 vira "ligar a flag". | XS, ½ dia |
| **B) Implementar nesta fase** | Backend `ai.service.js` + `rag.service.js` do zero. Sai de "Fase 2 de qualidade" e vira "Fase 2 + escopo novo". Não recomendo. | L+, fora do plano |

**Recomendação do PO:** cenário A. Mantém o foco e a Fase 3 fica com IA
como objetivo central, não como "remendo de Fase 2".

**Decisão necessária:** sim/não para A. Se for B, replanejamos.

### Onda 5 — Fechamento (XS, executada após Onda 4)

Bugs P1/P2 catalogados durante validação que ficaram fora do plano
original. Decidimos fechar todos para entregar a fase 100% limpa.

| Bug | Severidade | Esforço | Owner sugerido |
|-----|-----------|---------|----------------|
| [B-13](BUGS_FASE2.md#b-13) — `duplicate` com clone profundo do flow | P1 | S | backend |
| [B-12](BUGS_FASE2.md#b-12) — `loadOrStub` distingue módulo de domínio vs dep npm | P2 | XS | backend |
| [B-14](BUGS_FASE2.md#b-14) — sessões em memória sem guard | P2 | — | **diferido para Fase 3** com justificativa formal |

**Definition of Done da Onda 5:**
- `chatbot.duplicate` testado: bot duplicado abre o editor direto com
  nodes/edges idênticos ao original (mas em flow draft separado).
- Boot do backend sem `qrcode` instalado mostra erro claro `❌
  dependência ausente: 'qrcode'`, não mais o warn enganoso de "não
  implementado".

## 4. Sequência e dependências

```
Onda 1 (boot limpo)
       │
       ▼
Onda 2 (B-03 → B-07 → B-01)        ◀── golden path E2E
       │
       ▼
Onda 3 (B-05, B-06 em paralelo)    ◀── engine completo
       │
       ▼
Onda 4 (B-04 = decisão A ou B)     ◀── coerência da UI
       │
       ▼
   Fase 2 fechada
```

Onda 1 e o início da Onda 4 (cenário A é só front) podem rodar em paralelo
se o time tiver capacity.

## 5. Definition of Done — Fase 2

Critérios objetivos para declarar a fase concluída. Todos têm que estar
verdes simultaneamente.

- [ ] Bugs P0 (B-01, B-02, B-03, B-04) **fechados**.
- [ ] Bugs P1 (B-05, B-06, B-07) **fechados**.
- [ ] Bugs P2 (B-08, B-09, B-10) **fechados**.
- [ ] Smoke test do golden path em [DEMO.md](DEMO.md) atualizado e
      executado com sucesso em ambiente de staging.
- [ ] Boot do backend limpo (sem `MODULE_BROKEN`, sem
      `NOT_IMPLEMENTED`, sem `Unknown node type`).
- [ ] Front não tem botão que retorna 501 ao clicar (ou esses botões
      estão atrás de flag desligada).
- [ ] Build de produção (Vercel + Render) testado uma vez com o golden
      path.

## 6. Riscos

| Risco | Impacto | Probabilidade | Mitigação |
|-------|---------|---------------|-----------|
| B-01 expor outros bugs no `FlowEngine` quando exercitado em produção (variáveis `{{nome}}` no `message`, retry, race condition em mensagens simultâneas) | Alto | Média | Encarar B-01 com timebox de 3 dias; se estourar, abrir como bug separado e seguir |
| Decisão sobre B-04 demorar | Médio | Alta | PO precisa fechar até a Onda 1 terminar — senão Onda 4 atrasa o release |
| Persistência de sessão (B-01) exigir migração nova | Médio | Média | Schema já tem `conversations.current_node_id`; checar se basta antes de planejar migração |
| Webhook da Evolution não chegar em ambiente de teste | Alto | Baixa | Usar `ngrok` + Evolution local nos testes; documentar no DEMO.md |

## 7. Decisões tomadas (2026-05-25)

| # | Decisão | Implicação |
|---|---------|-----------|
| 1 | **B-04: cenário A.** Esconder botões de IA atrás de `VITE_ENABLE_AI=false`. | Onda 4 vira XS (só front). IA real é objetivo central da Fase 3. |
| 2 | **B-03: flow draft só com `trigger`.** | Onboarding leve. Operador desenha o resto. |
| 3 | **B-01: sessão persiste no banco** via `conversations.current_node_id` (coluna já existe). | Sobrevive a restart. Sem `flowSessions Map` no caminho de WhatsApp. |
| 4 | **B-06: `setTimeout` síncrono com teto de 60s.** Wait > 60s vira backlog Fase 3 (fila assíncrona). | Limita escopo da Onda 3. |
| 5 | **Escopo extra:** bugs novos que aparecerem nesta fase, **se não forem relacionados a IA**, são corrigidos aqui mesmo (não jogamos para Fase 3). | Inventário [BUGS_FASE2.md](BUGS_FASE2.md) cresce conforme aparecerem. |

## 8. Métricas pós-release (instrumentar antes de fechar)

Mesmo sem ferramenta de analytics, vale logar e revisar manualmente nos
primeiros 7 dias:

- **% de bots criados que chegam a 1 publicação** — métrica do funil de
  ativação. Hoje seria ~0% por causa do B-03.
- **% de mensagens `MESSAGES_UPSERT in` que geram pelo menos 1 `out`** —
  mede se o engine está rodando. Hoje seria 0% por causa do B-01.
- **Tempo médio entre `in` e primeiro `out` de bot** — sanity check para
  B-06 e para latência da Evolution.

## 9. Próximas 48h

1. **Hoje:** PO valida este plano e responde as 4 decisões pendentes.
2. **+24h:** Tech lead estima Onda 1 e Onda 2 em horas reais e atribui
   owners.
3. **+48h:** Onda 1 mergeada. Onda 2 começa.

---

_PO: Felipe. Revisado em 2026-05-25 a partir da revisão dos commits até
`6491b7a`._
