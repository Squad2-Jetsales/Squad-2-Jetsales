# Integracao Evolution API

## Objetivo

Esta integracao conecta a Evolution API apenas ao backend do JetGO.

Fluxo:

`Browser -> Vercel /api/v1/... -> Render backend -> Evolution API`

O frontend nao chama a Evolution API direto e nunca recebe a API key.

## Variaveis de ambiente

| Variavel | Obrigatoria | Onde configurar | Observacao |
| --- | --- | --- | --- |
| `EVOLUTION_API_BASE_URL` | Sim | Render / `server/.env` | URL base da Evolution API, sem barra final |
| `EVOLUTION_API_KEY` | Sim | Render / `server/.env` | Valor enviado no header `apikey` |
| `EVOLUTION_API_INSTANCE` | Nao | Render / `server/.env` | Instancia padrao para status/testes administrativos |
| `EVOLUTION_WEBHOOK_SECRET` | Nao, mas recomendado | Render / `server/.env` | Segredo validado no webhook recebido |
| `EVOLUTION_WEBHOOK_URL` | Recomendado | Render / `server/.env` | URL publica do webhook, ex.: `https://squad-2-jetsales-api.onrender.com/api/v1/webhooks/evolution` |

Compatibilidade legada:

- `EVOLUTION_API_URL`
- `EVOLUTION_WEBHOOK_TOKEN`

Os nomes acima ainda sao aceitos pelo backend para nao quebrar ambientes antigos, mas novos ambientes devem usar os nomes atuais.

## Endpoints internos

Todos os endpoints abaixo ficam no backend e passam pelo proxy normal da Vercel quando chamados pelo frontend.

| Metodo | Endpoint | Auth | CSRF | Funcao |
| --- | --- | --- | --- | --- |
| `GET` | `/api/v1/whatsapp-connections` | Sim | Nao | Lista conexoes da organizacao e sincroniza status quando possivel |
| `POST` | `/api/v1/whatsapp-connections` | Sim | Sim | Cria conexao local + instancia na Evolution API |
| `GET` | `/api/v1/whatsapp-connections/:id` | Sim | Nao | Consulta uma conexao e atualiza estado/QR quando necessario |
| `POST` | `/api/v1/whatsapp-connections/:id/refresh-qr` | Sim | Sim | Gera novo QR Code para a conexao local |
| `DELETE` | `/api/v1/whatsapp-connections/:id` | Sim | Sim | Remove a conexao local e tenta apagar a instancia remota |
| `GET` | `/api/v1/whatsapp-connections/status` | Sim | Nao | Testa conectividade do backend com a Evolution API |
| `POST` | `/api/v1/whatsapp-connections/instances` | Sim | Sim | Cria instancia usando o fluxo administrativo novo |
| `GET` | `/api/v1/whatsapp-connections/instances/:instanceName/status` | Sim | Nao | Consulta status de uma instancia |
| `GET` | `/api/v1/whatsapp-connections/instances/:instanceName/qrcode` | Sim | Nao | Consulta/gera QR Code para a instancia |
| `POST` | `/api/v1/whatsapp-connections/send-test` | Sim | Sim | Envia mensagem de teste pela instancia informada |
| `POST` | `/api/v1/whatsapp-connections/webhook-config` | Sim | Sim | Configura webhook da Evolution API para a instancia |
| `POST` | `/api/v1/webhooks/evolution` | Nao | Nao | Recebe eventos da Evolution API |

## Webhook

Endpoint publico:

`POST /api/v1/webhooks/evolution`

Comportamento:

- nao exige auth de usuario;
- nao usa CSRF;
- valida `EVOLUTION_WEBHOOK_SECRET` por header `X-Evolution-Webhook-Secret` ou query `?secret=...`;
- responde `200` mesmo para eventos desconhecidos, para nao quebrar a entrega;
- aceita tanto `/api/v1/webhooks/evolution` quanto `/api/v1/webhooks/evolution/<evento>`.

Eventos tratados com logica dedicada:

- `CONNECTION_UPDATE`
- `QRCODE_UPDATED`
- `MESSAGES_UPSERT`

Eventos aceitos de forma neutra:

- `MESSAGES_UPDATE`
- `MESSAGES_DELETE`
- `SEND_MESSAGE`
- outros eventos desconhecidos

## Persistencia

Tabelas aproveitadas sem migration nova:

- `whatsapp_connections`
- `contacts`
- `conversations`
- `messages`

Persistencia minima implementada:

1. A conexao local guarda `evolution_instance`, status, QR e ultima atividade.
2. `MESSAGES_UPSERT` tenta localizar a conexao pelo nome da instancia.
3. Se a conexao tiver `chatbot_id`, o backend cria ou reutiliza `contact` + `conversation` e salva `message`.
4. Se nao houver `chatbot_id`, o webhook responde `200` e apenas registra de forma neutra.

## Como testar localmente

### Backend sem env real

1. Suba o backend local com banco configurado.
2. Chame `GET /api/v1/whatsapp-connections/status`.
3. O retorno esperado sem env valida e um erro controlado `503` informando que a Evolution API nao esta configurada.

### Webhook fake

Exemplo:

```bash
curl -i -X POST http://localhost:3001/api/v1/webhooks/evolution \
  -H "Content-Type: application/json" \
  -H "X-Evolution-Webhook-Secret: test" \
  -d '{"event":"MESSAGES_UPSERT","instance":"test","data":{"key":{"remoteJid":"557999999999@s.whatsapp.net","fromMe":false,"id":"test-message-id"},"message":{"conversation":"oi"}}}'
```

### Evolution real

1. Configure as envs no backend.
2. Crie uma conexao ou use `POST /api/v1/whatsapp-connections/instances`.
3. Escaneie o QR Code.
4. Use `POST /api/v1/whatsapp-connections/send-test`.
5. Configure o webhook com `POST /api/v1/whatsapp-connections/webhook-config`.

## Cuidados de seguranca

- Nunca commite `.env`, `.env.local`, `.vercel/`, tokens ou API keys.
- Nunca exponha a Evolution API no navegador.
- O frontend continua usando apenas `/api/v1/...`.
- O webhook pode usar `?secret=` quando a Evolution nao permitir header customizado no cadastro automatico.

## Troubleshooting

| Sintoma | Causa provavel | Acao |
| --- | --- | --- |
| `503 Evolution API nao configurada` | Env faltando no backend | Defina `EVOLUTION_API_BASE_URL` e `EVOLUTION_API_KEY` |
| QR nao aparece | Instancia criada, mas Evolution nao devolveu `code/qrcode/base64` | Verifique logs do backend e teste o endpoint `GET /instances/:instanceName/qrcode` |
| Webhook retorna `401` | Secret incorreto | Alinhe `EVOLUTION_WEBHOOK_SECRET` com o valor enviado |
| Evento chega mas nao persiste mensagem | Conexao sem `chatbot_id` ou payload sem `remoteJid` utilizavel | Vincule a conexao a um chatbot e reenvie |
| Front continua chamando Render direto | Configuracao antiga no client | Garanta `VITE_API_BASE_URL` vazio em producao |
