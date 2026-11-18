# CNPJ Prospect — MVP

Sistema interno de consulta e análise de mercado/concorrentes com os Dados Abertos de CNPJ da Receita Federal.

**Status:** MVP funcional com amostra local, passaporte histórico (H2), mapa de ligações (N1) e Data Trust Lab (N5). A carga do snapshot completo é a próxima etapa de escala.

> **Deploy atual (diagnóstico):** o `Dockerfile` da raiz sobe a estrutura HTTP + UI **sem banco** — não instala nem importa DuckDB/PostgreSQL. É para isolar travamentos do servidor. O app completo está em `Dockerfile.full`; veja `DEPLOY.md`.

---

## 1. O que já funciona

- Ingestão de uma amostra coerente do snapshot `2026-10`:
  - 50.000 estabelecimentos;
  - 162.230 empresas;
  - 40.977 sócios;
  - 10.846 registros de Simples/MEI;
  - tabelas de domínio (CNAE, município, natureza, qualificação, motivo, país).
- Banco **DuckDB** embutido no Node — sem serviço de banco separado.
- API em **TypeScript/Node** com Fastify.
- UI em HTML/CSS/JS (sem build de frontend) com:
  - busca por razão social, nome fantasia ou CNPJ;
  - filtros de UF, cidade, CNAE, situação, porte, idade mínima, capital mínimo e máximo, número de sócios;
  - **dropdowns pesquisáveis** para CNAE (código ou nome), cidade e UF;
  - filtros de Simples, MEI, com e-mail, com telefone, somente matriz;
  - contato separado em **e-mail** e **telefone**;
  - cards de resumo;
  - ranking de CNAEs e UFs;
  - ordenação por nome, abertura, capital ou sócios;
  - **buscas salvas** (perfis reutilizáveis);
  - **passaporte histórico da empresa** com fatos, eventos datados, cobertura e resumo da rede;
  - **mapa de ligações** com sócios, e-mails, telefones, endereços, marcas, hubs e confiança por aresta;
  - **redes identificadas automaticamente**: lista de hubs de contato, filtros por tipo/UF/CNAE e exploração sem precisar saber CNPJ;
  - **mapa geográfico da rede** com o Brasil visível e lista de empresas conectadas;
  - ficha cadastral com estabelecimentos, sócios e Simples/MEI;
  - exportação CSV;
  - **mapa do Brasil** com hover/clique em região, estado e cidade, lista sincronizada, métricas e raio-X competitivo;
  - **gráfico de nascimentos e fechamentos** por ano, global e por território;
  - **dashboard** com KPIs e gráficos de situação, porte, UFs, CNAEs, cidades, aberturas, idade, capital e número de sócios;
  - **Data Trust Lab** com matriz de cobertura histórica 2000–2026 e validação por amostragem do pacote 2019 do Wayback.
- Testes unitários de CNPJ (numérico e alfanumérico) e do query builder.

### Números do teste local

| Item | Resultado |
|---|---:|
| Estabelecimentos na amostra | 50.000 |
| Empresas na amostra | 162.230 |
| Sócios na amostra | 40.977 |
| Simples/MEI na amostra | 10.846 |
| Tempo de geração da amostra | ~3 min (download + parsing) |
| Tempo de carga do banco | ~4–7 s |
| Consulta de listagem | ~30–100 ms |
| Memória da API em repouso | ~100–150 MB |
| Limite de memória do DuckDB | 8 GB |
| Threads | 8 |

> A amostra cobre a faixa de CNPJ base `00000000–04631960` (shard 1 de Empresas do snapshot `2026-10`). Os totais servem para validar a aplicação; **não representam o Brasil**. Para outro snapshot, use a carga completa (`prepare:snapshot` + `ingest:snapshot`).

---

## 2. Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js 24 + TypeScript |
| API | Fastify 5 + Zod |
| Banco de destino | **PostgreSQL 17** (self-hosted / EasyPanel) |
| Banco atual (legado) | DuckDB 2.x em arquivo local, até a migração das queries |
| Ingestão | TypeScript + `yauzl`, `csv-parse`, `iconv-lite` |
| UI | HTML + CSS + JavaScript puro |
| Testes | Vitest |
| Deploy | Docker / EasyPanel |

### Banco de dados

O banco principal será **PostgreSQL 17**, rodando como serviço self-hosted no
EasyPanel. O DuckDB continua sendo usado temporariamente pelo app atual, mas
não é o destino da arquitetura.

A fundação já está versionada:

- `docker-compose.db.yml` — PostgreSQL local;
- `db/migrations/001_init.sql` — schemas `core`, `read`, `app`, `history` e `enrich`;
- `db/README.md` — instalação no EasyPanel, dimensionamento, carga e migração.

O schema já nasce com:

- CNPJ como texto;
- `core.estabelecimentos` particionada por UF;
- `read.estabelecimentos_busca` como modelo de leitura;
- `read.rede_contatos` para o grafo;
- `history.change_events` para o change log;
- `enrich.company_facts` e `enrich.company_edges` com fonte, validade, confiança e evidência.

A troca efetiva das queries para PostgreSQL será feita por etapas; até lá, a
aplicação continua funcionando com a amostra DuckDB.

**Dimensionamento do PostgreSQL:** 16 GB de RAM no servidor, 4 GB para o
serviço, 200–300 GB de disco para a carga completa. O DuckDB legado fica
limitado a 8 GB durante a transição.

---

## 3. Rodar localmente

### Pré-requisitos

- Node.js 22+ (recomendado 24)
- ~1 GB de disco para a amostra
- Acesso à internet para baixar os arquivos da Receita

### Passos

```bash
npm install
cp .env.example .env       # no Windows: Copy-Item .env.example .env
npm run sample             # baixa e monta a amostra (~500 MB de download)
npm run ingest:sample      # cria data/cnpj.duckdb
npm run dev                # http://localhost:3000
```

No Windows, se `npm run sample` reclamar de permissão, execute o terminal como usuário normal (não é necessário administrador).

### Uso local no dia a dia (Windows)

Depois da primeira carga, use o atalho da raiz:

```bat
iniciar.cmd
```

Ele confere `data/cnpj.duckdb`, compila o TypeScript, sobe a API em
`http://localhost:3000` (bind em `127.0.0.1`) e abre o navegador. Feche a janela
ou use `Ctrl+C` para parar. No PowerShell, o equivalente:

```powershell
npm run build; $env:NODE_ENV='production'; npm start
```

### Comandos

| Comando | O que faz |
|---|---|
| `npm run db:up` | Sobe o PostgreSQL local para desenvolvimento |
| `npm run db:down` | Para o PostgreSQL local (mantém o volume) |
| `npm run db:logs` | Acompanha os logs do PostgreSQL local |
| `npm run db:migrate` | Aplica as migrações pendentes na `DATABASE_URL` |
| `npm run geo:build` | Baixa/atualiza a malha IBGE e gera os arquivos estáticos do mapa |
| `npm run history:download-2019` | Baixa o pacote 2019 do Wayback para `data/wayback/2019/` |
| `npm run history:validate-2019` | Valida o pacote 2019 por amostragem contra o snapshot local |
| `npm run sample` | Baixa dimensões + amostra do shard 1 e grava em `data/sample/` |
| `npm run ingest:sample` | Cria/recria `data/cnpj.duckdb` a partir da amostra |
| `npm run setup:sample` | `sample` + `ingest:sample` em um comando |
| `npm run setup:snapshot` | `prepare:snapshot` + `ingest:snapshot` em um comando |
| `npm run dev` | API + UI em modo desenvolvimento (`tsx watch`) |
| `npm run build` | Compila TypeScript para `dist/` |
| `npm start` | Sobe a API compilada |
| `npm test` | Roda os testes |
| `npm run typecheck` | Checagem de tipos |
| `npm run prepare:snapshot` | Baixa e extrai o snapshot completo (ver seção 7) |
| `npm run ingest:snapshot` | Carrega o snapshot extraído no DuckDB |

### Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta da API |
| `HOST` | `0.0.0.0` | Host de escuta |
| `DATABASE_URL` | `postgresql://prospect:prospect_dev@localhost:5433/prospect` | Conexão do PostgreSQL (destino) |
| `POSTGRES_DB` | `prospect` | Banco do compose local |
| `POSTGRES_USER` | `prospect` | Usuário do compose local |
| `POSTGRES_PASSWORD` | `prospect_dev` | Senha local; trocar em produção |
| `DUCKDB_PATH` | `./data/cnpj.duckdb` | Arquivo do DuckDB legado |
| `APP_DB_PATH` | `./data/app.duckdb` | Banco local de buscas salvas/workspaces |
| `DUCKDB_TEMP_DIR` | `./data/tmp` | Diretório de spill temporário do DuckDB |
| `DATA_DIR` | `./data` | Diretório de dados/amostra |
| `MEMORY_LIMIT` | `8GB` | Limite de memória do DuckDB |
| `THREADS` | `8` | Threads do DuckDB |
| `SNAPSHOT` | `2026-10` | Snapshot de referência |
| `SOURCE_BASE` | WebDAV da Receita | URL base da fonte |
| `SOURCE_TOKEN` | `YggdBLfdninEJX9` | Token público da pasta |
| `SAMPLE_LINES` | `50000` | Estabelecimentos na amostra |
| `SAMPLE_SHARD` | `1` | Shard de Empresas usado na amostra |
| `SAMPLE_INCLUDE_SIMPLES` | `true` | Inclui Simples/MEI na amostra |

---

## 4. API

### Endpoints

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/health` | Saúde, snapshot e contagens |
| `GET` | `/api/meta` | Metadados do banco |
| `GET` | `/api/opcoes` | UFs, CNAEs, naturezas, situações e portes |
| `GET` | `/api/municipios?uf=SP` | Cidades de uma UF (código RFB, nome e total) |
| `GET` | `/api/mapa?nivel=uf` | Métricas agregadas por região, UF ou município |
| `GET` | `/api/mercado?nivel=uf&codigo=SP` | Raio-X competitivo do território |
| `GET` | `/api/timeline` | Nascimentos e fechamentos por ano |
| `GET` | `/api/rede/empresa/:cnpj` | Grafo de ligações (sócios, contatos, endereços e marcas) + empresas para o mapa |
| `GET` | `/api/rede/hubs` | Hubs identificados automaticamente (e-mail, telefone, endereço, marca) |
| `GET` | `/api/rede/hub` | Grafo de um hub: contato + empresas conectadas |
| `GET` | `/api/historico/cobertura` | Matriz de cobertura histórica e relatório de validação 2019 |
| `GET` | `/api/empresas` | Listagem com filtros, paginação e resumo |
| `GET` | `/api/estatisticas` | Agregações por UF, CNAE, situação, porte, município ou natureza |
| `GET` | `/api/dashboard` | KPIs e séries para o dashboard |
| `GET` | `/api/cnpj/:cnpj` | Ficha 360º (aceita 8 ou 14 caracteres) |
| `GET` | `/api/export.csv` | Exportação CSV com os mesmos filtros |
| `GET` | `/api/buscas` | Lista buscas/perfis salvos |
| `POST` | `/api/buscas` | Salva um perfil de busca |
| `DELETE` | `/api/buscas/:id` | Exclui um perfil salvo |

### Exemplos

```bash
# Empresas ativas, com mais de 3 anos, em SP, do CNAE de restaurantes
curl "http://localhost:3000/api/empresas?situacao=02&idade_min=3&uf=SP&cnae=5611201&page_size=25"

# Busca livre
curl "http://localhost:3000/api/empresas?q=padaria&situacao=02"

# Ficha de uma empresa (matriz ou filial)
curl "http://localhost:3000/api/cnpj/00000000000191"

# Busca por nome do CNAE
curl "http://localhost:3000/api/empresas?cnae=restaurante&situacao=02"

# Cidades de uma UF
curl "http://localhost:3000/api/municipios?uf=SP"

# Top CNAEs
curl "http://localhost:3000/api/estatisticas?situacao=02&idade_min=3&group_by=cnae&limit=10"

# Dashboard
curl "http://localhost:3000/api/dashboard?situacao=02&idade_min=3&uf=SP"

# Mapa por UF
curl "http://localhost:3000/api/mapa?nivel=uf&situacao=02"

# Mapa por município
curl "http://localhost:3000/api/mapa?nivel=municipio&uf=SP&situacao=02"

# Raio-X competitivo
curl "http://localhost:3000/api/mercado?nivel=uf&codigo=SP&situacao=02"

# Nascimentos e fechamentos
curl "http://localhost:3000/api/timeline?uf=SP"

# Mapa de ligações de uma empresa
curl "http://localhost:3000/api/rede/empresa/03444384"

# Hubs identificados automaticamente
curl "http://localhost:3000/api/rede/hubs?tipo=email&min_empresas=3"

# Grafo de um hub (sem precisar saber o CNPJ)
curl "http://localhost:3000/api/rede/hub?tipo=email&valor=contex%40tca.com.br"

# Cobertura histórica e validação 2019
curl "http://localhost:3000/api/historico/cobertura"

# Exportar CSV
curl -o empresas.csv "http://localhost:3000/api/export.csv?situacao=02&idade_min=3&uf=SP"
```

### Filtros de `/api/empresas`

| Parâmetro | Exemplo | Observação |
|---|---|---|
| `q` | `padaria` | Razão social, nome fantasia ou CNPJ |
| `cnpj` | `00000000000191` ou `00000000` | 14 ou 8 caracteres; aceita pontuação |
| `uf` | `SP` | 2 letras |
| `municipio` | `7107` ou `São Paulo` | Código RFB ou nome |
| `cnae` | `5611201` ou `restaurante` | Código (4–7 dígitos) ou nome do CNAE; busca principal e secundária |
| `situacao` | `02` | `01` nula, `02` ativa, `03` suspensa, `04` inapta, `08` baixada |
| `porte` | `01` | `01` micro, `03` pequena, `05` demais |
| `natureza` | `2062` | Código de natureza jurídica |
| `idade_min` | `3` | Anos desde a abertura |
| `idade_max` | `20` | Anos desde a abertura |
| `capital_min` | `100000` | Capital social mínimo |
| `capital_max` | `5000000` | Capital social máximo |
| `socios_min` | `2` | Número mínimo de sócios |
| `socios_max` | `10` | Número máximo de sócios |
| `simples` | `true` | Somente optantes do Simples |
| `mei` | `true` | Somente MEI |
| `com_email` | `true` | Somente com e-mail |
| `com_telefone` | `true` | Somente com telefone |
| `matriz` | `true` | Somente matriz |
| `page` | `1` | Página |
| `page_size` | `25` | Máximo 200 |
| `sort` | `razao_social` | `razao_social`, `data_inicio`, `capital_social`, `uf`, `cnae`, `situacao`, `idade`, `socios` |
| `order` | `asc` | `asc` ou `desc` |

### Resposta de `/api/empresas`

```json
{
  "data": [
    {
      "cnpj": "00000000000191",
      "cnpj_formatado": "00.000.000/0001-91",
      "razao_social": "BANCO DO BRASIL SA",
      "situacao_descricao": "Ativa",
      "data_inicio": "1966-01-01",
      "idade_anos": 60,
      "cnae_principal": "6422100",
      "cnae_descricao": "Bancos múltiplos, com carteira comercial",
      "uf": "DF",
      "municipio_nome": "BRASILIA",
      "email": "...",
      "capital_social": 120000000000,
      "socios_count": 3,
      "is_ativa": true,
      "is_mais_3_anos": true
    }
  ],
  "total": 7554,
  "page": 1,
  "page_size": 25,
  "total_pages": 303,
  "resumo": {
    "total": 7554,
    "ativas": 7554,
    "mais_3_anos": 7554,
    "com_email": 3324,
    "com_telefone": 4948,
    "com_socios": 3456
  }
}
```

---

## 5. Modelo de dados

O DuckDB contém:

| Tabela | Conteúdo |
|---|---|
| `empresas` | Raiz do CNPJ, razão social, natureza, porte, capital |
| `estabelecimentos` | Endereço, CNAE, situação, contatos, datas |
| `socios` | Quadro societário (CPF mascarado) |
| `simples` | Simples Nacional e MEI |
| `dim_cnae` | Código e descrição de CNAE |
| `dim_municipio` | Código RFB e nome do município |
| `dim_natureza` | Natureza jurídica |
| `dim_qualificacao` | Qualificação de sócio/responsável |
| `dim_motivo` | Motivo de situação cadastral |
| `dim_pais` | Países |
| `estabelecimentos_busca` | Tabela denormalizada usada pela API |
| `rede_contatos` | Contatos normalizados por CNPJ base: e-mail, telefone, endereço e marca |
| `municipio_ibge` / `regiao` | De–para RFB → IBGE e região, usados no mapa |
| `meta` | Snapshot, data de geração e contagens |
| `app.duckdb` | Banco local de buscas/perfis salvos |

### Passaporte histórico e rede

O endpoint `/api/cnpj/:cnpj` devolve um `passaporte` com fatos, eventos datados, cobertura e resumo da rede. O endpoint `/api/rede/empresa/:cnpj` devolve nós e arestas tipadas:

| Aresta | Evidência | Confiança |
|---|---|---|
| `socio_de` | CPF/CNPJ mascarado + nome normalizado | Alta |
| `mesmo_email` | e-mail idêntico | Média |
| `mesmo_telefone` | telefone idêntico | Média |
| `mesmo_endereco` | CEP + número + complemento | Média |
| `mesma_marca` | nome fantasia normalizado | Média |

Contatos repetidos são modelados como **hubs** (um nó de contato ligado a várias empresas), não como pares empresa–empresa. Um contato que aparece em muitas empresas é marcado como hub e pode representar uma contabilidade, escritório, coworking ou grupo econômico.

O grafo exibe o nome em todos os nós. O layout é **radial por camadas**, sempre expandindo para fora do centro: a **primeira camada** é o hub e as empresas diretamente ligadas; a **segunda camada** (roxo) mostra sócios dessas empresas e as **camadas seguintes** (rosa) mostram as outras empresas em que esses sócios participam. Cada empresa continua clicável para abrir a rede completa dela. O grafo permite arrastar nós, mover o pano e aplicar zoom com **Ctrl/Cmd + scroll**; o scroll normal continua rolando a página. O botão **Expandir** abre o grafo em tela cheia. O mapa usa `cooperativeGestures` pelo mesmo motivo, e a lista de hubs mostra 8 redes por vez com **Ver mais**, sem rolagem interna.

### Buscas salvas

Cada busca salva funciona como um **perfil de ICP**: nome + filtros. Fica em `data/app.duckdb` (banco local, sem serviço externo) e pode ser aberta/excluída pela interface. Endpoints: `GET/POST /api/buscas` e `DELETE /api/buscas/:id`.

A tabela `estabelecimentos_busca` já traz:

- razão social e nome fantasia normalizados para busca;
- descrição de CNAE, município e natureza;
- situação/porte/matriz traduzidos;
- `idade_anos`, `is_ativa`, `is_mais_3_anos`;
- `socios_count` (quantidade de sócios da empresa);
- flags de Simples e MEI.

---

## 6. Deploy no EasyPanel

### 6.0 Modo diagnóstico sem banco (Dockerfile padrão)

O `Dockerfile` da raiz é o **minimal**: instala só Fastify + arquivos estáticos, sem DuckDB, sem PostgreSQL e sem módulos nativos. Ele existe para descobrir se o travamento do servidor vem do banco/build nativo ou da plataforma.

- Rotas: `/` e `/admin` → página de diagnóstico; `/app` → shell da UI; `/health` → estado/memória; `/api/*` → 503.
- Build leve e determinístico: usa `package.minimal.json`, `tsconfig.minimal.json` e `src/api/server.minimal.ts`.
- Se o servidor ficar estável nesse modo, o problema está no app completo/banco. Se ainda travar, é plataforma/build/rede.

Para voltar ao app completo, aponte o build do EasyPanel para **`Dockerfile.full`** (ou renomeie-o para `Dockerfile`). As seções 6.1–6.7 descrevem o app completo.

### 6.1 Criar o serviço (app completo)

O app completo usa **DuckDB em arquivo** como base de leitura: não é necessário criar PostgreSQL para ele subir. O único requisito é um serviço Node com **volume persistente em `/data`**.

1. No EasyPanel, crie um novo **App**.
2. Conecte o repositório (GitHub) ou faça upload do projeto.
3. Build: **`Dockerfile.full`** (não use o `Dockerfile` da raiz, que é o modo diagnóstico sem banco; e não existe `docker-compose.yml` na raiz).
4. Porta: `3000` (é a porta em que o processo escuta; não altere `PORT` sem alterar aqui).
5. Healthcheck: `GET /health` na porta `3000`. **Não use `/ready` como healthcheck** — ele retorna 503 durante a carga e o EasyPanel reiniciaria o container.
6. Crie um **volume persistente** montado em `/data` com pelo menos **20 GB** para a amostra. Para o snapshot completo, 100–200 GB.
7. Variáveis: nenhuma é obrigatória. Recomendado definir apenas:

```env
ADMIN_TOKEN=troque-por-um-token-longo
# DATABASE_URL=postgres://usuario:senha@host:5432/banco?sslmode=disable
```

`DATA_DIR` já vem do Dockerfile como `/data`; `DUCKDB_PATH`, `APP_DB_PATH` e `DUCKDB_TEMP_DIR` derivam dele. Se você sobrescrever `DUCKDB_PATH` com um caminho fora de `/data`, a base será perdida a cada redeploy.

8. Memória do container: **2 GB** basta para a amostra; **4 GB** para o snapshot completo. O Dockerfile limita o DuckDB a 2 GB/4 threads por padrão; para carga completa defina `MEMORY_LIMIT=8GB` e `THREADS=8`.
   > **Atenção:** limite de memória maior que a máquina faz o Swarm **não agendar** a tarefa: o deploy aparece como sucesso em segundos, nenhum contêiner é criado e não há log de runtime. Em VPS de 4 GB, use limite de container de 2 GB.
9. Faça o deploy.

### 6.2 Primeiro deploy e carga da base

Um deploy novo abre a **página de estado** (“A base ainda não foi carregada”). Isso é esperado: o processo está no ar e o proxy funciona; falta a base.

1. Abra `https://seu-dominio/admin`.
2. Clique em **Carregar amostra (app)**. Leva ~3–5 minutos (download + parsing).
3. O log acompanha ao vivo. Ao terminar, o app recarrega o DuckDB sozinho — **não precisa reiniciar o serviço**.
4. Confirme em `/health`: `db_ready:true` e as contagens; abra `/` e o app real aparece.

Alternativa por terminal (se o botão não estiver disponível):

```bash
npm run setup:sample
```

Depois, no `/admin`, clique em **Recarregar base** — ou reinicie o serviço. O banco fica em `/data/cnpj.duckdb`.

> No Windows local a API mantém o arquivo travado. Pare o servidor antes de rodar `npm run setup:sample`.

### 6.3 Atualização mensal (amostra)

Abra `/admin` e clique em **Carregar amostra (app)** novamente, ou rode `npm run setup:sample` no terminal. O `sample` reaproveita os ZIPs já baixados; só baixa o que falta. A recarga é automática quando a carga é disparada pelo painel.

### 6.4 Volume e backup

- O arquivo `/data/cnpj.duckdb` é a base do app. Faça backup periódico do volume `/data`.
- Os ZIPs em `/data/raw` podem ser apagados depois da carga; eles são reproduzíveis a partir da fonte.
- Se o volume for perdido, rode `npm run setup:sample` ou use o botão do `/admin`.

### 6.5 Deploy por imagem pronta (contorna o build no EasyPanel)

Se o build do EasyPanel termina em segundos e nenhum contêiner aparece, rode a imagem publicada pelo GitHub Actions em vez de compilar no servidor.

- Workflow: `.github/workflows/docker-publish.yml` publica `ghcr.io/allehkeyroz/prospect:latest` (minimal, sem banco) e `:full` (app completo).
- No GitHub, abra **Packages** → `prospect` → *Package settings* → *Change visibility* → **Public**. Se o pacote estiver privado, o EasyPanel não consegue baixar e o container não sobe.
- No EasyPanel, crie um **App** com `Source = Docker Image`, porta `3000`. Use `:latest` para o modo diagnóstico ou `:full` para o app completo; no app completo, monte o volume em `/data`.
- Para rodar o app com Docker na sua máquina, use `docker-compose.local.yml`:
  `docker compose -f docker-compose.local.yml up -d`.

### 6.6 Diagnóstico de 502, 404 e “app fora do ar”

Antes de mexer no `.env`, olhe o status HTTP do domínio:

| Resposta | Significado | Onde resolver |
| --- | --- | --- |
| `502` + HTML do EasyPanel | Domínio roteado, mas nenhum contêiner atende a porta | Deploy/porta/replicas do serviço |
| `404` + HTML do EasyPanel | Nenhuma rota para esse host: domínio não está no serviço | Aba **Domains**: adicionar/recriar o domínio |
| `200` + página “A base ainda não foi carregada” | Aplicação no ar, banco ausente | `/admin` → **Carregar amostra (app)** |
| `200` + JSON `{"ok":true,"db_ready":true,...}` | Aplicação e base prontas | Nada a fazer |

O 404 do EasyPanel e o 404 da aplicação são diferentes: a aplicação sempre responde JSON em `/api/*` e HTML nas rotas de UI.

Com o contêiner de pé, o primeiro log é `"msg":"boot"` com `port`, `host`, `db_ready`, `db_path` e `data_dir`. Se essa linha não aparece, o processo não executou: o problema é imagem/porta/plataforma, não a aplicação.

**Deploy “Success” em poucos segundos, nenhum contêiner e nenhum log** é tarefa do Swarm que não pode ser agendada. Quase sempre é um destes:

- limite de memória/CPU maior que a máquina (ex.: 12 GB em VPS de 4 GB);
- mount apontando para um volume que não existe mais;
- réplicas = 0.

Nesse caso não adianta Redeploy: ajuste os recursos/mounts e implante de novo. No terminal do servidor, `docker service ls` e `docker service ps <serviço> --no-trunc` mostram o motivo (`no suitable node`, mount inválido etc.).

### 6.7 PostgreSQL (opcional, carga paralela)

O PostgreSQL 17 é o banco de destino da migração, mas **o app ainda não lê dele**. Carregar o Postgres não deixa o app pronto; quem deixa é o DuckDB da seção 6.2.

Use o `/admin` (com `DATABASE_URL` configurada) ou o terminal:

```bash
npm run db:migrate          # aplica 001–004
npm run db:load:sample      # validação rápida (50 mil linhas)
npm run db:load:snapshot    # snapshot completo já extraído
```

Para o snapshot completo, baixe/extraia com `/admin` → **Baixar/extrair snapshot** (ou `npm run prepare:snapshot`): são 37 ZIPs (~7,3 GB) e ~26 GB de CSV. Garanta ~40 GB livres no volume e o Postgres acessível pela `DATABASE_URL`.

---

### 6.8 ZIPs no Supabase Storage

O bucket privado `cnpj-raw` guarda os ZIPs em `<SNAPSHOT>/`. O Storage self-hosted limita cada objeto a **50 MB**; por isso o `src/tools/syncStorage.ts` baixa da Receita **no servidor** e envia partes de 40 MB, com manifesto e retomada.

```bash
SUPABASE_URL=https://SEU-SUPABASE \
SUPABASE_SERVICE_ROLE_KEY='...' \
SUPABASE_BUCKET=cnpj-raw \
SNAPSHOT=2026-10 \
node dist/src/tools/syncStorage.js
```

Detalhes e o comando completo estão em `DEPLOY.md` (seção 10). Não faça esse upload pela sua máquina: o gargalo é o uplink.

O loader que baixa do Storage, extrai e carrega no Postgres está em `Dockerfile.loader` (imagem `:loader`, sem DuckDB); veja `DEPLOY.md` seção 11.

---

## 7. Snapshot completo

O MVP atual usa uma amostra. Para carregar o Brasil inteiro, use os dois comandos:

```bash
npm run prepare:snapshot     # baixa 37 ZIPs (~7,27 GB) e extrai ~26 GB de CSV
npm run ingest:snapshot      # carrega no DuckDB e cria a tabela de busca
```

O `prepare:snapshot`:

- descobre os arquivos via WebDAV (`PROPFIND`);
- baixa com 4 conexões, retomada por `Range` e retry;
- extrai cada ZIP convertendo Latin-1 → UTF-8;
- reaproveita arquivos já baixados/extraídos;
- grava `data/extracted/{snapshot}/manifest.json`.

Opções úteis:

```bash
# listar arquivos e tamanhos, sem baixar
npm run prepare:snapshot -- --list

# testar a extração com um único arquivo
npm run prepare:snapshot -- --only=Cnaes.zip

# forçar re-download/re-extração
npm run prepare:snapshot -- --force
```

Estrutura gerada:

```
data/extracted/2026-10/
  empresas/*.csv
  estabelecimentos/*.csv
  socios/*.csv
  simples/*.csv
  dim_cnae.csv
  dim_municipio.csv
  dim_natureza.csv
  dim_qualificacao.csv
  dim_motivo.csv
  dim_pais.csv
  manifest.json
```

Estimativas:

| Item | Valor |
|---|---:|
| Download | 7,27 GB |
| CSV descomprimido | ~26 GB |
| Banco DuckDB final | ~10–25 GB (depende dos índices) |
| Tempo de download | 15–60 min (depende da conexão) |
| Tempo de extração | 20–60 min |
| Tempo de carga | 1–3 h (16 GB RAM, NVMe) |
| Disco recomendado | 100–200 GB |
| RAM | 8 GB para o DuckDB; 16 GB no servidor é suficiente |

> O arquivo `Estabelecimentos0.zip` sozinho tem 2,17 GB. O download usa 4 conexões e retomada; se uma falhar, rode novamente e ele continua do ponto anterior.

### 7.1 Data Trust Lab (histórico)

O pacote 2019 do Wayback usa um layout **fixed-width de 1.200 caracteres**, com registros `1F` (empresa/estabelecimento) e `2F` (sócio). Ele não é o CSV moderno da Receita e não é mesclado automaticamente ao banco.

```bash
# baixar (padrão: 20 arquivos; use --only=1 para um arquivo)
npm run history:download-2019

# validar por amostragem contra o snapshot local
npm run history:validate-2019
```

O validador lê o ZIP em streaming, faz amostragem uniforme dos registros de empresa e compara CNPJ, razão social, situação, abertura, CNAE e UF com `estabelecimentos_busca`. O relatório fica em `docs/historico/2019-validacao.{json,md}` e aparece na aba **Dados**.

Cobertura declarada:

| Período | Camada | Uso |
|---|---|---|
| 2000–2018 | Reconstruído | Foto aproximada por datas de abertura/fechamento do snapshot atual |
| 2019 | Validado | Retrato do Wayback, após validação por amostragem |
| 2020 | Parcial | Captura incompleta; apenas complemento |
| 2021–2022 | Sem fonte | Metadados de diretório, sem ZIP recuperável |
| 2023-03/04 | Espelho | Casa dos Dados; validar antes de tratar como oficial |
| 2023-05+ | Oficial | Snapshots mensais da Receita Federal |

---

## 8. Limitações conhecidas

- **Amostra:** 50 mil estabelecimentos da faixa `00000000–04631960`; não é o Brasil inteiro.
- **Simples/MEI:** a amostra tem 10.846 registros; a carga completa terá todos.
- **Histórico:** o passaporte e o gráfico usam as datas do snapshot atual. O pacote 2019 está em validação; 2000–2018 é reconstrução aproximada. O change log mensal 2023→2026 é a próxima fase.
- **Rede:** o grafo usa uma amostra limitada de empresas por sócio/contato; os totais do resumo são completos, mas o desenho não é. Não há mescla de snapshots históricos na rede ainda.
- **Hubs:** a classificação de contabilidade/escritório/franquia é inferida por sinais (CNAE, nome, domínio, repetição) e exige curadoria manual.
- **Mapa:** usa a malha estática do IBGE e o de–para RFB→IBGE por nome+UF. Na amostra, 3.943 de 3.955 municípios foram mapeados; na carga completa, os não encontrados devem ser revisados.
- **CPF de sócio:** sempre mascarado pela Receita; não é possível reconstruir.
- **Sem faturamento/nº de funcionários:** capital social não é receita.
- **CNPJ alfanumérico:** suportado como texto; validação de DV inclusa.
- **LGPD:** dados públicos, mas nomes/CPF mascarado/contatos são dados pessoais. Uso interno deve ter base legal, acesso controlado e retenção definida.
- **Fonte mensal:** não há atualização em tempo real; o snapshot mais recente pode ter 2–6 semanas de defasagem.

---

## 9. Estrutura do projeto

```
src/
  api/
    server.ts          # Fastify + static UI
    routes.ts          # endpoints
    schemas.ts         # validação Zod
    queryBuilder.ts    # SQL parametrizado
    geoQueries.ts      # mapa, mercado e timeline
    networkQueries.ts  # sócios, contatos e resumo da rede
    networkGraph.ts    # nós/arestas, hubs e confiança
    passport.ts        # fatos e eventos do passaporte histórico
  history/
    wayback2019.ts     # parser fixed-width do pacote 2019
    downloadWayback2019.ts
    validateWayback2019.ts
    coverage.ts        # matriz de cobertura histórica
  db/
    duckdb.ts          # pool legado de conexões analíticas
    appDb.ts           # banco local legado de buscas/perfis salvos
    schema.ts          # DDL e transformações do DuckDB legado
db/
  migrations/
    001_init.sql       # schema PostgreSQL (core/read/app/history/enrich)
  README.md            # EasyPanel, dimensionamento e migração
  geo/
    buildGeo.ts        # malha IBGE + CSV de municípios (estático)
  ingest/
    makeSample.ts      # baixa e monta a amostra
    load.ts            # carga do CSV no DuckDB
    loadSample.ts      # carga da amostra
    loadSnapshot.ts    # carga de snapshot extraído
  lib/
    cnpj.ts            # normalização/validação (numérico + alfanumérico)
    text.ts            # normalização de texto/CSV
public/
  index.html
  styles.css
  app.js
  geo/                 # malhas IBGE e de-para estáticos
  vendor/              # MapLibre local (sem CDN)
test/
  cnpj.test.ts
  queryBuilder.test.ts
  passport.test.ts
  networkGraph.test.ts
  wayback2019.test.ts
docs/
  historico/           # relatórios de validação versionados
data/
  sample/              # CSVs da amostra (ignorado no git)
  raw/                 # ZIPs baixados (ignorado no git)
  cnpj.duckdb          # banco analítico (ignorado no git)
  app.duckdb           # buscas/perfis salvos (ignorado no git)
  wayback/2019/        # pacote histórico baixado (ignorado no git)
  extracted/           # snapshot completo extraído (ignorado no git)
```

---

## 10. Comandos úteis de diagnóstico

```bash
# saúde da API
curl http://localhost:3000/health

# contagens do banco
curl http://localhost:3000/api/meta

# tamanho dos arquivos de amostra
du -sh data/sample data/raw data/cnpj.duckdb

# verificar o banco com DuckDB CLI (se instalado)
duckdb data/cnpj.duckdb "select count(*) from estabelecimentos_busca;"
```

---

## 11. Decisões de arquitetura

- **DuckDB em vez de PostgreSQL/ClickHouse agora:** menos um serviço para operar, cabe em 16 GB, consultas analíticas rápidas e o arquivo é fácil de copiar/backupar.
- **Sem ORM:** SQL explícito e parametrizado, com query builder pequeno e testável.
- **Sem React/Next.js no MVP:** a UI em HTML/JS reduz build e dependências; se o produto crescer, migra para Next.js.
- **API TypeScript:** atende à preferência do projeto; o mesmo runtime faz ingestão e serving.
- **Migração futura:** se houver muitos usuários simultâneos ou necessidade de busca textual fuzzy, a camada de serving pode ir para ClickHouse/Meilisearch mantendo os endpoints.

---

## 12. Licença e fonte

Dados: Receita Federal do Brasil — Dados Abertos de CNPJ.
Este projeto é de uso interno; revise termos de uso, LGPD e políticas da empresa antes de expor os dados a terceiros.
