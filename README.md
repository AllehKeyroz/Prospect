# CNPJ Prospect — MVP

Sistema interno de consulta e análise de mercado/concorrentes com os Dados Abertos de CNPJ da Receita Federal.

**Status:** MVP funcional com amostra local, passaporte histórico (H2), mapa de ligações (N1) e Data Trust Lab (N5). A carga do snapshot completo é a próxima etapa de escala.

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
| Banco analítico | DuckDB 2.x (embutido, arquivo local) |
| Ingestão | TypeScript + `yauzl`, `csv-parse`, `iconv-lite` |
| UI | HTML + CSS + JavaScript puro |
| Testes | Vitest |
| Deploy | Docker / EasyPanel |

### Por que DuckDB?

- É um banco colunar embutido: não precisa de um serviço separado, usuário, porta ou backup de servidor.
- Lê e agrega 215 milhões de linhas com pouca RAM, usando disco quando necessário.
- O arquivo do banco fica em um volume persistente; as consultas não descompactam ZIP.
- Para uso interno (1–10 usuários), é o caminho mais enxuto.
- Se no futuro houver muita concorrência, a camada analítica pode migrar para ClickHouse sem mudar a API.

**16 GB de RAM são suficientes para o MVP.** O DuckDB está limitado a 8 GB; o restante fica para o sistema, Node e cache de disco. 64 GB não é necessário para uso interno.

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

### Comandos

| Comando | O que faz |
|---|---|
| `npm run geo:build` | Baixa/atualiza a malha IBGE e gera os arquivos estáticos do mapa |
| `npm run history:download-2019` | Baixa o pacote 2019 do Wayback para `data/wayback/2019/` |
| `npm run history:validate-2019` | Valida o pacote 2019 por amostragem contra o snapshot local |
| `npm run sample` | Baixa dimensões + amostra do shard 1 e grava em `data/sample/` |
| `npm run ingest:sample` | Cria/recria `data/cnpj.duckdb` a partir da amostra |
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
| `DUCKDB_PATH` | `./data/cnpj.duckdb` | Arquivo do banco analítico |
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

O MVP usa **DuckDB em arquivo**: não é necessário criar PostgreSQL, MySQL ou ClickHouse. Basta um serviço Node com volume persistente.

### 6.1 Criar o serviço

1. No EasyPanel, crie um novo **App**.
2. Conecte o repositório (GitHub) ou faça upload do projeto.
3. Build: **Dockerfile** (o arquivo `Dockerfile` já está no projeto).
4. Porta: `3000`.
5. Healthcheck: `GET /health`.
6. Crie um **volume persistente** montado em `/data` com pelo menos **20 GB** (para a amostra). Para o snapshot completo, 100–200 GB.
7. Configure as variáveis:

```env
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
DUCKDB_PATH=/data/cnpj.duckdb
APP_DB_PATH=/data/app.duckdb
DUCKDB_TEMP_DIR=/data/tmp
DATA_DIR=/data
MEMORY_LIMIT=8GB
THREADS=8
SNAPSHOT=2026-10
SAMPLE_SHARD=1
SAMPLE_LINES=50000
SAMPLE_INCLUDE_SIMPLES=true
```

8. Limite de memória do container: **12 GB** (deixa 4 GB para o sistema). O DuckDB usará no máximo 8 GB.
9. Faça o deploy.

### 6.2 Primeira carga

O app encerra se o banco ainda não existe. Antes de subir, abra o **terminal do serviço** no EasyPanel e rode:

```bash
npm run sample
npm run ingest:sample
```

A amostra leva **~3–5 minutos** (download + parsing). Depois reinicie o serviço. O banco estará em `/data/cnpj.duckdb`.

> Se o serviço entrar em restart loop por causa do banco ausente, use o terminal do EasyPanel ou um job one-off com os dois comandos acima. O volume `/data` precisa estar montado antes da carga.

### 6.3 Atualização mensal (amostra)

No terminal do serviço:

```bash
npm run sample
npm run ingest:sample
```

Reinicie o serviço. O `sample` reaproveita os ZIPs já baixados; só baixa o que falta.

### 6.4 Volume e backup

- O arquivo `data/cnpj.duckdb` é o banco inteiro. Faça backup periódico do volume `/data`.
- Os ZIPs em `/data/raw` podem ser apagados depois da carga; eles são reproduzíveis a partir da fonte.
- Se o volume for perdido, basta rodar `npm run sample && npm run ingest:sample` novamente.

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
    duckdb.ts          # pool de conexões analíticas
    appDb.ts           # banco local de buscas/perfis salvos
    schema.ts          # DDL e transformações
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
