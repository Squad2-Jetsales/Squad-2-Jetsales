# Deploy - Render + Vercel

## 1. Visao geral

Arquitetura de producao:

- Frontend: Vercel
- Backend: Render Web Service
- Banco de dados: Render PostgreSQL

URLs atuais:

- Frontend: https://squad-2-jetsales-wheat.vercel.app
- Backend: https://squad-2-jetsales-api.onrender.com
- Health: https://squad-2-jetsales-api.onrender.com/health

Fluxo da aplicacao:

`Vercel frontend -> Render backend -> Render PostgreSQL`

## 2. Branch de deploy

As configuracoes de deploy foram preparadas na branch:

`deploy/vercel`

Mudancas relacionadas a deploy devem ser feitas em branch propria e revisadas antes de chegar na `develop`. Evite alterar configuracoes de producao diretamente na `develop`.

## 3. Vercel - Frontend

O frontend Vite/React e publicado na Vercel.

Variavel obrigatoria:

```env
VITE_API_BASE_URL=https://squad-2-jetsales-api.onrender.com
```

Regras importantes:

- Configure `VITE_API_BASE_URL` em `Production`.
- Sempre que a variavel for criada ou alterada, faca um novo redeploy da Vercel.
- Se o frontend estiver chamando `localhost:3001`, a variavel nao foi aplicada corretamente ou faltou redeploy.

## 4. Render - Backend

Configuracao do Web Service:

| Campo | Valor |
| --- | --- |
| Root Directory | `server` |
| Build Command | `npm ci` |
| Start Command | `node src/app.js` |
| Health Check Path | `/health` |
| Branch | `deploy/vercel` |

Nao coloque `npm run migrate` no Build Command.

Motivo:

- o build pode rodar mais de uma vez;
- migrations precisam de controle explicito;
- a execucao deve ser manual no Render Shell quando necessario.

## 5. Render - PostgreSQL

O banco de producao deve ser um PostgreSQL gerenciado no Render.

Regras importantes:

- Use a `Internal Database URL` como `DATABASE_URL` no Web Service do backend.
- Nunca commite a URL do banco.
- Em producao, o Knex usa SSL quando `NODE_ENV=production`.

## 6. Variaveis de ambiente do Render

| Variavel | Obrigatoria | Observacao |
| --- | --- | --- |
| `NODE_ENV=production` | Sim | Ativa comportamento de producao no backend e SSL no Knex |
| `DATABASE_URL=<Internal Database URL>` | Sim | Use a URL interna do PostgreSQL do Render |
| `JWT_ACCESS_SECRET=<secret forte>` | Sim | Gere um valor forte e nunca versione |
| `JWT_REFRESH_SECRET=<secret forte>` | Sim | Gere um valor forte e nunca versione |
| `FRONTEND_ORIGINS=https://squad-2-jetsales-wheat.vercel.app` | Sim | Origem permitida para CORS |
| `SETUP_SECRET=<secret forte>` | Sim | Token usado pela rota de setup inicial |
| `COOKIE_DOMAIN=` | Nao | Pode ficar ausente ou vazio |

Notas:

- `PORT` nao precisa ser configurada manualmente, porque o Render injeta essa variavel automaticamente.
- `COOKIE_DOMAIN` pode ficar ausente ou vazio.
- Gere secrets com valores fortes.
- Nunca commite secrets.

## 7. Migrations em producao

O endpoint `setup.routes.js` nao roda migrations.

Ele apenas cria:

- a organizacao inicial `JetGO Local`;
- o usuario `admin@jetgo.local`.

Por isso, a migration precisa ser executada manualmente quando aplicavel:

```bash
npm run migrate
```

Tabela de operacao:

| Quando | Onde | Comando |
| --- | --- | --- |
| 1a vez, apos criar Web Service | Render Shell | `npm run migrate` |
| 1a vez, apos migration | Qualquer maquina | `curl -X POST https://squad-2-jetsales-api.onrender.com/api/v1/setup/seed -H "X-Setup-Token: <SETUP_SECRET>"` |
| Sempre que entrar PR com migration nova | Render Shell | `npm run migrate` |
| Deploy sem migration | Render/Vercel | So redeploy normal |

## 8. Setup do admin inicial

Comando:

```bash
curl -X POST https://squad-2-jetsales-api.onrender.com/api/v1/setup/seed \
  -H "X-Setup-Token: <SETUP_SECRET>"
```

Resposta esperada:

```json
{
  "ok": true
}
```

Se o admin ja existir:

```json
{
  "ok": true,
  "alreadyExisted": true
}
```

Nunca documente o valor real de `SETUP_SECRET`.

As credenciais demo `admin@jetgo.local / jetgo123` servem apenas para ambiente de demonstracao. Se o projeto evoluir para producao real, troque essas credenciais imediatamente.

## 9. Smoke test de producao

Checklist:

1. Testar health:

```bash
curl -i https://squad-2-jetsales-api.onrender.com/health
```

2. Abrir o frontend:

`https://squad-2-jetsales-wheat.vercel.app`

3. Fazer login.

4. Confirmar:

- redirect para `/dashboard`;
- chamadas para o backend Render;
- `/auth/me` com `200`;
- nenhuma chamada para `localhost:3001`.

## 10. Diagnostico rapido

| Sintoma | Causa provavel | Onde ajustar |
| --- | --- | --- |
| CORS error no console | Origin da Vercel nao esta em `FRONTEND_ORIGINS` | Render env |
| Login retorna `200` mas `/auth/me` da `401` | Cookie nao persistiu | Conferir `NODE_ENV=production`, `trust proxy`, `SameSite=None`, `Secure` |
| `502 Bad Gateway` | Backend caiu ou health falhou | Logs do Render Web Service |
| `relation "users" does not exist` | Migration nao rodou | Render Shell: `npm run migrate` |
| Frontend faz request para `localhost:3001` | Vercel sem `VITE_API_BASE_URL` ou sem redeploy | Vercel env + redeploy |
| `no pg_hba.conf entry` | SSL desligado | Confirmar `NODE_ENV=production` |

## 11. Seguranca

Boas praticas minimas:

- nunca commite `.env`;
- nunca commite `.vercel/`;
- nunca commite tokens;
- apague arquivos locais de secrets depois do uso;
- mantenha `SETUP_SECRET` forte;
- troque ou remova credenciais demo se o projeto virar producao real.
