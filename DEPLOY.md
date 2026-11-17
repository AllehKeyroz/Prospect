# Deploy no EasyPanel — passo a passo

Guia operacional do que fazer (e do que verificar) para o app ficar **no ar e pronto** no EasyPanel.
Para arquitetura e comandos locais, veja `README.md` e `AGENTS.md`.

---

## 0. Modo atual: diagnóstico sem banco

O `Dockerfile` da raiz agora sobe **apenas Fastify + UI estática**. Ele não instala nem importa DuckDB, PostgreSQL ou módulos nativos (`package.minimal.json` + `src/api/server.minimal.ts`).

Objetivo: separar “app/banco” de “plataforma/build”.

- Configure o serviço com **Build = Dockerfile** e porta `3000`. Volume não é necessário neste modo.
- `GET /health` deve responder:

  ```json
  {"ok":true,"mode":"no-db","db_enabled":false,"db_ready":false,...}
  ```

- `GET /` e `GET /admin` mostram a página de diagnóstico.
- `GET /app` mostra o shell real da UI (sem dados).
- `GET /api/*` responde 503.

Interpretação:

| Resultado | Conclusão |
|---|---|
| Container sobe e o servidor fica estável | O travamento vinha do app completo/banco ou do build nativo |
| Servidor continua travando | Problema de plataforma/build/rede, não do DuckDB |
| Container não sobe / sem log `boot` | Imagem, porta, recursos ou registry |

Para voltar ao app completo: no EasyPanel, troque o caminho do Dockerfile para **`Dockerfile.full`** (ou use a imagem `ghcr.io/allehkeyroz/prospect:full`), monte o volume em `/data` e siga as seções 2–6.

---

## 1. O que significa “deploy funciona, app não fica no ar”

O EasyPanel pode mostrar **Success** mesmo quando nada está atendendo. Separe em três camadas:

| Camada | Sintoma | Onde ver |
|---|---|---|
| Container não roda | Deploy em segundos, nenhum log `boot` | Recursos, volume, porta, imagem |
| Container roda, proxy não chega | `502` do EasyPanel | Porta do serviço × porta do app (3000) |
| App roda, base ausente | Página “A base ainda não foi carregada” | `/admin` → carregar amostra |

O app foi feito para **nunca entrar em restart loop**: sem base, ele sobe, `/health` responde 200 e as rotas `/api/*` respondem 503 até a carga. A página `/` mostra o estado atual.

---

## 2. Checklist do serviço no EasyPanel

- [ ] **Source**: repositório GitHub (branch `master` ou `main`).
- [ ] **Build**: `Dockerfile` (não use Compose; não existe `docker-compose.yml` na raiz).
- [ ] **Porta**: `3000`.
- [ ] **Healthcheck**: `GET /health` na porta `3000`.
      Não use `/ready` como healthcheck: ele retorna 503 durante a carga.
- [ ] **Volume**: montado em `/data` (obrigatório para a base sobreviver a redeploys).
- [ ] **Memória do container**: 2 GB (amostra) ou 4 GB (snapshot completo).
      Nunca maior que a RAM da máquina — o Swarm não agenda a tarefa e o deploy “passa” sem container.
- [ ] **Environment**:
      - `ADMIN_TOKEN` — recomendado; protege `/admin` (sem ele o painel é aberto).
      - `DATABASE_URL` — opcional; só para a carga paralela no Postgres.
      - Não defina `PORT` diferente de `3000` sem ajustar a porta do serviço.
- [ ] **Domínio**: anexado ao serviço na aba **Domains**.
- [ ] **Réplicas**: `1` (zero réplicas = deploy sem container).

Os caminhos de dados derivam de `DATA_DIR` (definido no Dockerfile como `/data`):

```env
DATA_DIR=/data
# DUCKDB_PATH=/data/cnpj.duckdb
# APP_DB_PATH=/data/app.duckdb
# DUCKDB_TEMP_DIR=/data/tmp
MEMORY_LIMIT=2GB
THREADS=4
```

Se você sobrescrever `DUCKDB_PATH` com algo fora de `/data`, a base será perdida a cada redeploy.

---

## 3. Primeiro deploy

1. Faça o deploy e abra `https://SEU-DOMINIO/health`.
   Esperado no primeiro boot:

   ```json
   {"ok":true,"status":"degraded","db_ready":false,"duckdb_exists":false,
    "reason":"arquivo não encontrado: /data/cnpj.duckdb"}
   ```

   Isso é **liveness**, não falha: o processo está no ar e o proxy funciona.

2. Abra `https://SEU-DOMINIO/admin`.
   - Se `ADMIN_TOKEN` estiver definido, use `https://SEU-DOMINIO/admin?token=SEU_TOKEN`.
   - O cartão “App (DuckDB)” mostra o motivo de ainda não estar pronto.

3. Clique em **Carregar amostra (app)**.
   - Baixa ~500 MB, monta a amostra e recria `/data/cnpj.duckdb`.
   - Leva ~3–5 minutos; o log aparece ao vivo.
   - Ao terminar, o app recarrega a base sozinho. **Não precisa reiniciar.**

4. Confirme:

   ```bash
   curl -s https://SEU-DOMINIO/health
   # {"ok":true,"status":"ok","db_ready":true,...,"rows":{...}}

   curl -s -o /dev/null -w '%{http_code}\n' https://SEU-DOMINIO/ready
   # 200

   curl -s -o /dev/null -w '%{http_code}\n' "https://SEU-DOMINIO/api/empresas?page_size=1"
   # 200
   ```

5. Abra `https://SEU-DOMINIO/` — deve aparecer o app (Mapa/Busca/Rede/Dashboard/Dados),
   não a página de estado.

### Alternativa por terminal

No terminal do serviço:

```bash
npm run setup:sample
```

Depois clique em **Recarregar base** no `/admin` (ou reinicie o serviço).

> No Windows local a API mantém o arquivo travado. Pare o servidor antes de rodar a carga.

---

## 4. Se o container não subir

### 4.1 Deploy “Success” em segundos, nenhum log

Quase sempre é o Swarm sem nó disponível:

- limite de memória/CPU maior que a máquina (ex.: 12 GB em VPS de 4 GB);
- volume apontando para um mount que não existe mais;
- réplicas = 0.

Ajuste recursos/mounts e implante de novo. No servidor:

```bash
docker service ls
docker service ps NOME_DO_SERVICO --no-trunc
```

### 4.2 `502` no domínio

O domínio está roteado, mas nenhum container atende a porta. Confira:

- porta do serviço = `3000`;
- o log do container tem a linha `"msg":"boot"`;
- se não tem `boot`, o processo não executou (imagem/porta/plataforma).

### 4.3 `404` no domínio

O domínio não está anexado ao serviço. Aba **Domains** → adicionar/recriar.

### 4.4 Usando imagem do GHCR

Se o serviço usa `ghcr.io/allehkeyroz/prospect:latest` e o container não sobe:

- o pacote precisa ser **público**: GitHub → **Packages** → `prospect` →
  *Package settings* → *Change visibility* → **Public**;
- ou configure credenciais de registry no EasyPanel.

### 4.5 Container reiniciando

O app não deve morrer por base ausente/corrompida — ele entra em modo degradado.
Se ainda reiniciar:

- veja o motivo em `/health` (`reason`) e no log;
- suspeite de OOM: reduza `MEMORY_LIMIT`/limite do container;
- confirme que o volume `/data` é gravável.

---

## 5. Snapshot completo (Brasil)

No `/admin`, use **Baixar + carregar snapshot (app)**. Requisitos:

- ~40 GB livres para ZIPs + CSVs; banco final de ~10–25 GB;
- 4 GB de RAM no container e `MEMORY_LIMIT=8GB`/`THREADS=8`;
- tempo de 1–3 h (download + extração + carga).

O download usa `aria2c` (já incluso na imagem). Para desligar: `USE_ARIA2=false`.
O WebDAV da Receita limita conexões por IP; acima de ~8 conexões o download costuma estagnar.

Não apresente resultado local como “Brasil inteiro”: a amostra cobre só a faixa
`00000000–04631960`.

---

## 6. PostgreSQL (opcional)

O app **não lê do Postgres** ainda; ele lê o DuckDB. Carregar o Postgres não deixa o app pronto.

Com `DATABASE_URL` configurada, no `/admin`:

- **Aplicar migrações (Postgres)** → cria schemas/tabelas.
- **Baixar/extrair snapshot** → deixa os CSVs em `/data/extracted/<SNAPSHOT>`.
- **Carregar no Postgres** → COPY + read model + índices.

Ou no terminal:

```bash
npm run db:migrate
npm run db:load:sample     # validação rápida
npm run db:load:snapshot   # snapshot extraído
```

Se o Postgres estiver fora, o app continua no ar com o DuckDB.

---

## 7. Segurança do `/admin`

Sem `ADMIN_TOKEN`, qualquer pessoa com a URL pode disparar downloads de vários GB.
Em domínio público, **defina `ADMIN_TOKEN`** e abra o painel com `?token=...`.
O token fica salvo no `localStorage` do navegador.

---

## 8. O que foi corrigido para o deploy ficar de pé

- Caminhos de dados agora derivam de `DATA_DIR`; no container tudo fica em `/data`
  (antes o app procurava `/app/data/cnpj.duckdb`, fora do volume).
- O `/admin` agora carrega a base que o app realmente usa (DuckDB), não só o Postgres.
- O estado dos jobs funciona mesmo sem `DATABASE_URL` (fallback em memória).
- A base é recarregada automaticamente ao fim da carga, sem restart.
- As rotas existem desde o boot e respondem 503 até a base abrir; não há mais
  dois conjuntos de rotas.
- Base ausente, vazia ou corrompida vira modo degradado — o processo não morre.
- Migrações do Postgres rodam depois do `listen`; um Postgres fora do ar não atrasa
  o healthcheck.
- O Dockerfile fixa os caminhos em `/data` e usa limites conservadores de memória.

---

## 9. Rollback rápido

Se uma atualização piorar algo:

1. No EasyPanel, faça deploy do commit anterior (ou da tag `:sha` anterior do GHCR).
2. O volume `/data` é preservado; a base continua lá.
3. Confirme `/health` com `db_ready:true`.

---

## 10. Sincronizar ZIPs para o Supabase Storage

O Storage self-hosted aceita **50 MB por objeto** por padrão. Por isso os ZIPs são enviados em partes de 40 MB e o manifesto guarda o tamanho de cada parte.

No terminal do serviço da app (EasyPanel), rode:

```bash
SUPABASE_URL=https://sistemas-supabase-prospect.aoi8gd.easypanel.host \
SUPABASE_SERVICE_ROLE_KEY='COLE_A_SERVICE_ROLE_KEY' \
SUPABASE_BUCKET=cnpj-raw \
SNAPSHOT=2026-10 \
SYNC_CHUNK_MB=40 \
node dist/src/tools/syncStorage.js
```

- `SYNC_ONLY=Cnaes.zip` testa um único arquivo.
- `SYNC_CHUNK_MB` deve ficar entre 5 e 49.
- O script baixa da Receita **no servidor** e envia direto ao Storage; não passa pela sua máquina.
- Manifesto: `cnpj-raw/2026-10/manifest.json`.
- Partes: `cnpj-raw/2026-10/_parts/<arquivo>/part-00000`.
- Se cair, rode de novo: ele retoma das partes já enviadas.
- O loader futuro deve concatenar as partes usando `chunk_size` e `parts` de cada arquivo do manifesto.

Antes de rodar em produção, troque a `SUPABASE_SERVICE_ROLE_KEY` temporária e mantenha o bucket privado.

