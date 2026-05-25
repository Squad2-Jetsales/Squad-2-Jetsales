# JetGO — Frontend

SaaS para criar, editar e publicar chatbots WhatsApp via EvolutionAPI.

> **Stack:** Vite + React 18 + React Router + TypeScript + Tailwind + shadcn/ui + React Flow + TanStack Query + Zustand + Recharts.

## Setup

```bash
# com npm (padrão do monorepo Squad-2-Jetsales)
npm install
npm run dev

# ou com bun
bun install
bun dev
```

Quando rodado a partir da raiz do monorepo, use `npm run client` (inicia o Vite via `npm start`).

Crie um `.env.local`:

```
VITE_API_BASE_URL=http://localhost:3001
```

Em producao na Vercel, deixe `VITE_API_BASE_URL` ausente/vazio. O frontend chama `/api/...` e o `vercel.json` faz rewrite para o backend Render.

A API real deve estar acessível com CORS configurado (ver abaixo). Em desenvolvimento sem `VITE_API_BASE_URL`, o app pode entrar em modo preview para revisao visual.

## Auth — contrato com o backend

O frontend **nunca** lê, escreve ou decodifica tokens. Toda autenticação é via cookies httpOnly emitidos pelo backend Node. Cada `fetch` usa `credentials: 'include'`.

### O backend DEVE:

1. **Login** (`POST /auth/login`) — retorna `{ user, organization }` no body e seta:
   - `Set-Cookie: jetgo_at=<jwt>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=900`
   - `Set-Cookie: jetgo_rt=<jwt>; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth/refresh; Max-Age=604800`
   - `Set-Cookie: csrf_token=<random>; Secure; SameSite=Lax; Path=/` (não-httpOnly, lido pelo SPA e ecoado em `X-CSRF-Token`)
2. **Refresh** (`POST /auth/refresh`) — rota servida sob `Path=/api/v1/auth/refresh`. Retorna 200 + novos `Set-Cookie`.
3. **Logout** (`POST /auth/logout`) — limpa cookies via `Set-Cookie: jetgo_at=; Max-Age=0`.
4. **Validar `X-CSRF-Token`** em POST/PATCH/DELETE (double-submit).

### CORS obrigatório

```
Access-Control-Allow-Origin: <origem exata do frontend>   # nunca *
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: GET,POST,PATCH,DELETE,OPTIONS
Access-Control-Allow-Headers: Content-Type, X-CSRF-Token
Access-Control-Max-Age: 600
```

OPTIONS preflight deve retornar 204.

### Domínio recomendado

Frontend em `app.jetgo.com.br` + backend em `api.jetgo.com.br`, cookies com `Domain=.jetgo.com.br; SameSite=Lax`. Cross-site exige `SameSite=None; Secure`.

## Arquitetura

```
src/
  pages/                     # rotas React Router
    LoginPage.tsx
    ForgotPasswordPage.tsx
    DashboardPage.tsx
    ChatbotsPage.tsx
    ChatbotEditorPage.tsx    # canvas React Flow
    NotFound.tsx
  components/
    auth/ProtectedRoute.tsx  # gate via useQuery(['session'])
    layout/                  # AppShell, Sidebar, PageHeader, JetSalesLogo
    dashboard/               # MetricCard, ChartCard, RecentActivityList
    chatbot/                 # ChatbotCard + dialogs (manual + IA)
  lib/
    api/
      client.ts              # apiFetch (credentials, CSRF, refresh-on-401)
      auth.ts | chatbots.ts | flows.ts | dashboard.ts | connections.ts | tickets.ts
    hooks/useSession.ts
    stores/canvasStore.ts    # Zustand: undo/redo
    utils/sidebar-cookie.ts
  types/domain.ts            # tipos do backend (TAKEOFF 3.1)
```

## Entregue

- [x] Design tokens HSL (azul JetSales, roxo IA, status, surfaces, nodes do canvas) + Inter
- [x] AppShell com sidebar colapsável (cookie persistido, drawer mobile)
- [x] Login (react-hook-form + zod, refresh-on-401 transparente)
- [x] Dashboard (4 métricas + linha + barras + atividade recente)
- [x] Chatbots: lista, criar manual, criar com IA, ativar/desativar/duplicar/excluir
- [x] Editor canvas: 5 tipos de nó, palette drag&drop, painel lateral, undo/redo (Cmd+Z), autosave debounced, validação RN04 antes de publicar
- [x] `/conexoes` — lista de conexões WhatsApp, criação com QR polling, excluir/reconectar
- [x] `/tickets` — lista de conversas, filtros (abertas/fechadas/todas), chat estilo WhatsApp, transbordo
- [x] "Ajustar com IA" overlay
- [x] TypeScript estrito, zero `any`, zero token em localStorage

## Pendente

- Knowledge base — UI para upload e gestão de documentos
- "Testar Fluxo" runner — simulador no canvas antes de publicar
- Banner LGPD (RN05) — banner de cookies/privacidade
- Contingência (RN06) — UX quando API está fora

## Regras de negócio implementadas

| ID   | Regra                                       | Status |
| ---- | ------------------------------------------- | ------ |
| RN01 | Nome único (validado pelo backend, 409 → toast) | OK |
| RN02 | TriggerNode `deletable: false`              | OK     |
| RN03 | Undo/Redo Zustand                           | OK     |
| RN04 | Validação antes de publicar                 | OK     |
| RN05 | LGPD                                        | Pendente |
| RN06 | Contingência                                | Pendente |
