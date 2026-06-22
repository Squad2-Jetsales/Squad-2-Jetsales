# Teste de Validação Strict - Guia Rápido

## O que foi corrigido

✅ `searchSchema` — agora rejeita campos desconhecidos com HTTP 400
✅ `createDocSchema` — agora rejeita campos desconhecidos com HTTP 400

Antes: `{"query":"x","topk":10}` passava silenciosamente (typo ignorado)
Agora: retorna 400 com erro de validação

---

## Como testar no Postman

### Opção 1: Importar a collection
1. Abra o Postman
2. `File → Import`
3. Selecione: `docs/POSTMAN_TESTS_STRICT_VALIDATION.json`
4. Define as variáveis: `kb_id` e `csrf_token` (obter de uma request anterior ou do cookie)
5. Execute cada teste

### Opção 2: Teste manual rápido

**Pré-requisito:** Start server
```bash
cd server
npm run dev
```

---

## Testes esperados

### ✓ DEVE PASSAR (HTTP 200/202)

**POST** `/api/v1/knowledge-bases/{kb_id}/search`
```json
{
  "query": "como funciona a integração",
  "topK": 5,
  "minSimilarity": 0.7
}
```
**Resultado esperado:** HTTP 200 com citações

**POST** `/api/v1/knowledge-bases/{kb_id}/documents`
```json
{
  "title": "Manual",
  "content": "...",
  "sourceUrl": "https://example.com"
}
```
**Resultado esperado:** HTTP 202 com objeto do documento

---

### ✗ DEVE FALHAR (HTTP 400)

**POST** `/api/v1/knowledge-bases/{kb_id}/search` com **typo em `topK`**
```json
{
  "query": "como funciona",
  "topk": 5
}
```
**Resultado esperado:**
```json
{
  "error": "Validation failed",
  "fields": [
    {
      "path": "topk",
      "message": "Unrecognized key in object: 'topk'"
    }
  ]
}
```

**POST** `/api/v1/knowledge-bases/{kb_id}/search` com **campo extra desconhecido**
```json
{
  "query": "como funciona",
  "topK": 5,
  "debugMode": true
}
```
**Resultado esperado:** HTTP 400 rejeitando `debugMode`

**POST** `/api/v1/knowledge-bases/{kb_id}/documents` com **campo extra `priority`**
```json
{
  "title": "Manual",
  "sourceUrl": "https://example.com",
  "priority": "high"
}
```
**Resultado esperado:** HTTP 400 rejeitando `priority`

---

## Verificação via CLI (alternativa ao Postman)

```bash
# 1. Login e obter CSRF token
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@jetgo.local","password":"jetgo123"}' \
  -c cookies.txt

# 2. Extrair CSRF token do cookie
CSRF_TOKEN=$(grep csrf_token cookies.txt | awk '{print $NF}')
KB_ID="<seu-kb-id>"

# 3. Teste VÁLIDO (deve retornar 200)
curl -X POST http://localhost:3001/api/v1/knowledge-bases/$KB_ID/search \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF_TOKEN" \
  -b cookies.txt \
  -d '{
    "query": "teste",
    "topK": 5
  }' | jq .

# 4. Teste INVÁLIDO com typo (deve retornar 400)
curl -X POST http://localhost:3001/api/v1/knowledge-bases/$KB_ID/search \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF_TOKEN" \
  -b cookies.txt \
  -d '{
    "query": "teste",
    "topk": 5
  }' | jq .
```

---

## Checklist de validação

- [ ] Teste válido de search retorna 200 com citações
- [ ] Teste com `topk` (typo) retorna 400 com mensagem de campo desconhecido
- [ ] Teste com campo extra em search retorna 400
- [ ] Teste válido de create document retorna 202
- [ ] Teste com campo extra em create document retorna 400
- [ ] Error middleware enriquece a resposta 400 com estrutura `{error, fields}`
