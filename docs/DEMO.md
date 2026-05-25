# Roteiro de Apresentacao / Demo — JetSales

Guia rapido para demonstrar o sistema (inclui integracao WhatsApp via Evolution API)
em **outro computador/notebook**, apontando para o ambiente de **producao**.

> Para detalhes tecnicos da integracao, ver [`EVOLUTION_API.md`](./EVOLUTION_API.md).
> Para deploy, ver [`DEPLOY.md`](./DEPLOY.md).

---

## 1. Visao geral da demo

A demo roda **no navegador do notebook**, usando o ambiente publico:

- Frontend (Vercel): `https://squad-2-jetsales-wheat.vercel.app`
- Backend (Render): `https://squad-2-jetsales-api.onrender.com` — branch `evolutionapi`

Fluxo completo:

```
Notebook (navegador)
  -> Vercel /api/v1/...
  -> Render backend (evolutionapi)
  -> Evolution API (WhatsApp)

Evolution API -> webhook -> Render backend -> PostgreSQL
  (persiste contato + conversa + mensagem)
```

O frontend nunca chama a Evolution API direto e nunca recebe a API key.

---

## 2. Dependencia importante: onde a Evolution API esta rodando

Hoje a Evolution API roda **localmente no PC de desenvolvimento** (Docker) e e exposta
publicamente por um **tunel cloudflared**. O Render alcanca a Evolution por essa URL de tunel
(configurada em `EVOLUTION_API_BASE_URL`, no painel do Render — fora do Git).

**Consequencia:** o PC de desenvolvimento precisa ficar **ligado e disponivel durante a demo**.
Se ele suspender/desligar, ou o tunel cair, o WhatsApp da demo para de funcionar.

### Precisa ficar rodando no PC de desenvolvimento (NAO desligar)

- Docker Desktop com os containers da Evolution (`evolution_api` v2.3.7 + `evolution_postgres`).
- O processo do tunel (cloudflared) que publica a Evolution.
- Energia: desativar suspensao/bloqueio de tela.

> Se o tunel reiniciar, a URL publica muda. Nesse caso, atualizar `EVOLUTION_API_BASE_URL`
> no Render com a nova URL e fazer redeploy. (Solucao duravel: subir a Evolution em um host
> fixo — Render/VPS — e apontar `EVOLUTION_API_BASE_URL` para la.)

---

## 3. Checklist antes da apresentacao

Pode rodar do proprio notebook (apenas `curl`, sem segredos):

```bash
# 1) Backend Render no ar
curl -i https://squad-2-jetsales-api.onrender.com/health
# esperado: 200 {"status":"ok",...}

# 2) Login (gera cookies de sessao)
curl -c cookies.txt -i -X POST https://squad-2-jetsales-wheat.vercel.app/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<EMAIL_DEMO>","password":"<SENHA_DEMO>"}'

# 3) Evolution configurada e acessivel pelo backend
curl -b cookies.txt -i https://squad-2-jetsales-wheat.vercel.app/api/v1/whatsapp-connections/status
# esperado: 200, "configured":true

# 4) Instancia conectada
curl -b cookies.txt -i https://squad-2-jetsales-wheat.vercel.app/api/v1/whatsapp-connections/instances/jetsales-demo/status
# esperado: "status":"connected"

# limpeza
rm cookies.txt
```

Credenciais de demo (`<EMAIL_DEMO>` / `<SENHA_DEMO>`) ficam com o time / no gerenciador de
segredos — **nao sao versionadas**.

Se algum passo falhar, ver a secao 6 (Troubleshooting).

---

## 4. Passo a passo da demo (no notebook)

1. Abrir `https://squad-2-jetsales-wheat.vercel.app` no navegador.
2. Fazer login com a conta de demo.
3. **Dashboard**: mostrar a visao geral (tickets, conexoes ativas, mensagens, chatbots).
4. **Conexoes WhatsApp**: mostrar a conexao `jetsales-demo` como **conectada**,
   vinculada ao chatbot `Teste CLI`.
5. **Envio**: enviar uma mensagem de teste para o numero autorizado e mostrar a chegada no celular.
6. **Recebimento + persistencia**: enviar uma mensagem **de outro numero** para o WhatsApp conectado
   e mostrar a **conversa/mensagem aparecendo** no sistema (persistida e vinculada ao chatbot).
7. (Opcional) Abrir o DevTools (aba Network) e evidenciar que todas as chamadas vao para
   `/api/v1/...` no dominio da Vercel — nenhuma chamada direta a Render/Evolution pelo navegador.

---

## 5. Reconectar o WhatsApp na hora (se necessario)

Se a instancia cair ou pedir QR novamente:

1. Gerar QR fresco:
   `GET /api/v1/whatsapp-connections/instances/jetsales-demo/qrcode`
   (ou `POST /api/v1/whatsapp-connections/:id/refresh-qr`).
2. Escanear imediatamente no WhatsApp (Aparelhos conectados -> Conectar um aparelho).
   O QR expira em poucos segundos.
3. Conferir `.../instances/jetsales-demo/status` ate ficar `connected`.

> Se a Evolution local foi reiniciada do zero, e preciso recriar a instancia e reconfigurar
> o webhook na Evolution (formato v2). Ver `EVOLUTION_API.md`.

---

## 6. Troubleshooting rapido

| Sintoma | Causa provavel | Acao |
| --- | --- | --- |
| `/whatsapp-connections/status` retorna `503` | Envs da Evolution ausentes no Render | Conferir envs no Render e redeploy |
| `status` da conexao nao fica `connected` | Tunel/Evolution fora do ar no PC dev | Verificar Docker + cloudflared no PC dev |
| Erro de conexao com a Evolution (502/504) | URL do tunel mudou | Atualizar `EVOLUTION_API_BASE_URL` no Render |
| QR nao aparece / `count:0` | Versao do WhatsApp Web desatualizada na Evolution | Usar imagem da Evolution atualizada (ex.: v2.3.x) |
| Endpoint WhatsApp retorna `501 NOT_IMPLEMENTED` | Render rodando branch sem o modulo | Garantir Render na branch `evolutionapi` |
| Mensagem recebida nao persiste | Conexao sem `chatbot_id` | Vincular a conexao a um chatbot |

---

## 7. Seguranca

- Nunca commitar `.env`, `.env.local`, `.vercel/`, tokens, API keys ou o segredo do webhook.
- Nao versionar a URL privada do tunel nem cookies/JWT.
- Credenciais de demo e segredos ficam no Render (env) e com o time, fora do Git.
- O frontend continua usando apenas `/api/v1/...`.
