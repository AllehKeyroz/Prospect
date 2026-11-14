# Análise — Plataforma de Dados Abertos de CNPJ (Receita Federal)

**Data da análise:** 14/11/2026  
**Fonte:** https://arquivos.receitafederal.gov.br/index.php/s/YggdBLfdninEJX9  
**Último snapshot disponível:** `2026-10` (publicado em 13/10/2026)  
**Status:** viável construir uma plataforma de busca, prospecção e análise sobre os dados. O gargalo não é o volume (≈26 GB por mês), e sim modelagem, indexação de texto e operação do pipeline mensal.

---

## 1. Resumo executivo

A Receita Federal publica, mensalmente, um **snapshot completo** da base de CNPJ em arquivos ZIP/CSV. Não é uma API incremental e não há webhook: a atualização é detectada por polling no servidor de arquivos (WebDAV público).

O que foi validado diretamente na fonte:

| Item | Resultado |
|---|---|
| Acesso programático | Funciona via WebDAV público (`PROPFIND`, `GET`, `Range`, `ETag`, `Last-Modified`) |
| Snapshots disponíveis | 42 meses: `2023-05` até `2026-10` |
| Arquivos no snapshot mais recente | 37 arquivos, **7,27 GB comprimidos** |
| Volume descomprimido estimado | **≈26,4 GB**, **≈215 milhões de linhas** |
| Entidades | Empresas, Estabelecimentos, Sócios, Simples/MEI + 6 tabelas de domínio |
| Formato | CSV Latin-1 (ISO-8859-1), delimitador `;`, campos entre `"`, sem cabeçalho |
| Periodicidade | Mensal, geralmente entre os dias 9 e 14 (não garantido) |
| Latência dos dados | Amostra do snapshot `2026-10` com datas de situação até 28/09/2026 (referência de fim de setembro/2026) |
| Backfill | Sim, 42 snapshots; schema estável desde 2023-05 |
| Mudança crítica | **CNPJ alfanumérico em produção desde 31/07/2026** — tratar CNPJ como texto, nunca como número |

**Recomendação:** pipeline mensal com DuckDB para parsing/transformação em Parquet + ClickHouse para busca e agregações + PostgreSQL para dados da aplicação + API e frontend. Em uma única máquina de 16 vCPU / **32 GB RAM** / 1 TB NVMe, o snapshot inteiro cabe com folga e as consultas ficam na casa de milissegundos a poucos segundos. **64 GB só faz sentido para muitos usuários simultâneos ou busca textual pesada.** Para uso interno, ver o plano enxuto em `PLANO_LEAN_INTERNO.md`.

---

## 2. A fonte de dados

### 2.1 Acesso

O link é uma pasta pública do Nextcloud. O endpoint WebDAV é:

```
https://arquivos.receitafederal.gov.br/public.php/webdav/
Usuário: YggdBLfdninEJX9
Senha: (vazia)
```

Exemplos:

```bash
BASE="https://arquivos.receitafederal.gov.br/public.php/webdav"
TOKEN="YggdBLfdninEJX9"

# listar snapshots
curl -s -u "$TOKEN:" -X PROPFIND -H "Depth: 1" "$BASE/" 

# listar arquivos de um snapshot
curl -s -u "$TOKEN:" -X PROPFIND -H "Depth: 1" "$BASE/2026-10/"

# baixar um arquivo
curl -L -u "$TOKEN:" -o Estabelecimentos0.zip "$BASE/2026-10/Estabelecimentos0.zip"
```

O servidor responde `206 Partial Content` para requisições `Range`, o que permite **download retomável**. O `ETag` e o `Last-Modified` servem para detectar mudanças.

### 2.2 Estrutura dos arquivos

Cada pasta mensal contém:

| Arquivo | Conteúdo | Linhas estimadas | Tamanho comprimido | Tamanho descomprimido estimado |
|---|---|---:|---:|---:|
| `Empresas0..9.zip` | Dados da pessoa jurídica (raiz do CNPJ) | 66,5 M | 1,42 GB | 4,8 GB |
| `Estabelecimentos0..9.zip` | Endereços, CNAE, situação, contatos | 72,7 M | 5,17 GB | 16,1 GB |
| `Socios0..9.zip` | Quadro societário | 28,5 M | 0,80 GB | 2,7 GB |
| `Simples.zip` | Opção pelo Simples Nacional / MEI | 47,2 M | 0,30 GB | 2,8 GB |
| `Cnaes.zip` | Domínio de CNAE | ~1.300 | 22 KB | 88 KB |
| `Motivos.zip` | Motivos de situação cadastral | ~20 | 1 KB | 3 KB |
| `Municipios.zip` | Domínio de municípios (código RFB) | ~5.570 | 43 KB | 120 KB |
| `Naturezas.zip` | Naturezas jurídicas | ~90 | 1,5 KB | 4 KB |
| `Paises.zip` | Países | ~250 | 2,7 KB | 5 KB |
| `Qualificacoes.zip` | Qualificações de sócios/responsáveis | ~60 | 1 KB | 2,3 KB |

> Volumes estimados por amostragem de 8 MB por arquivo (taxa de linhas/byte comprimido). A margem é de aproximadamente ±3–5%. O total do snapshot `2026-10` é 7,27 GB comprimidos; a soma descomprimida estimada é 26,4 GB.

### 2.3 Layout dos arquivos principais

Todos os arquivos principais têm **7, 11 ou 30 colunas**, sem cabeçalho, com campos entre aspas e separador `;`. Campos vazios vêm como `""`. Datas vêm como `AAAAMMDD` e usam `0` ou `00000000` para “sem data”.

#### Empresas (7 colunas)

| # | Campo | Observação |
|---:|---|---|
| 1 | `cnpj_base` | 8 primeiros dígitos; hoje numérico, mas armazenar como texto |
| 2 | `razao_social` | Texto |
| 3 | `natureza_juridica` | Código de 4 dígitos |
| 4 | `qualificacao_responsavel` | Código de 2 dígitos |
| 5 | `capital_social` | Decimal com vírgula (ex.: `5000,00`) |
| 6 | `porte` | Código (01 = micro, 03 = pequena, 05 = demais etc.) |
| 7 | `ente_federativo_responsavel` | Geralmente vazio |

#### Estabelecimentos (30 colunas)

| # | Campo | Observação |
|---:|---|---|
| 1 | `cnpj_base` | 8 posições |
| 2 | `cnpj_ordem` | 4 posições; **pode conter letras** (CNPJ alfanumérico) |
| 3 | `cnpj_dv` | 2 dígitos verificadores |
| 4 | `identificador_matriz_filial` | `1` = matriz, `2` = filial |
| 5 | `nome_fantasia` | Texto |
| 6 | `situacao_cadastral` | `01` nula, `02` ativa, `03` suspensa, `04` inapta, `08` baixada etc. |
| 7 | `data_situacao_cadastral` | `AAAAMMDD` |
| 8 | `motivo_situacao_cadastral` | Código de 2 dígitos |
| 9 | `nome_cidade_exterior` | Para endereço no exterior |
| 10 | `pais` | Código de 3 dígitos |
| 11 | `data_inicio_atividade` | `AAAAMMDD` |
| 12 | `cnae_fiscal_principal` | 7 dígitos |
| 13 | `cnae_fiscal_secundaria` | Lista separada por vírgula dentro do campo (ex.: `4781400,5229099`) |
| 14 | `tipo_logradouro` | Rua, Avenida etc. |
| 15 | `logradouro` | Texto |
| 16 | `numero` | Texto |
| 17 | `complemento` | Texto |
| 18 | `bairro` | Texto |
| 19 | `cep` | 8 dígitos, com zeros à esquerda |
| 20 | `uf` | 2 letras |
| 21 | `municipio` | Código RFB de 4 dígitos (**não é o código IBGE**) |
| 22 | `ddd_1` | 2 dígitos |
| 23 | `telefone_1` | 8 dígitos |
| 24 | `ddd_2` | 2 dígitos |
| 25 | `telefone_2` | 8 dígitos |
| 26 | `ddd_fax` | 2 dígitos |
| 27 | `fax` | 8 dígitos |
| 28 | `email` | Texto |
| 29 | `situacao_especial` | Código |
| 30 | `data_situacao_especial` | `AAAAMMDD` |

#### Sócios (11 colunas)

| # | Campo | Observação |
|---:|---|---|
| 1 | `cnpj_base` | 8 posições |
| 2 | `identificador_socio` | 1 = PF, 2 = PJ, 3 = estrangeiro (validar no layout oficial) |
| 3 | `nome_socio` | Texto |
| 4 | `cpf_cnpj_socio` | **Mascarado** (`***428156**`); não há CPF completo |
| 5 | `qualificacao_socio` | Código de 2 dígitos |
| 6 | `data_entrada_sociedade` | `AAAAMMDD` |
| 7 | `pais` | Código de 3 dígitos (sócio estrangeiro) |
| 8 | `representante_legal` | CPF mascarado, quando aplicável |
| 9 | `nome_representante` | Texto |
| 10 | `qualificacao_representante` | Código de 2 dígitos |
| 11 | `faixa_etaria` | Código de 1 dígito |

#### Simples (7 colunas)

| # | Campo | Observação |
|---:|---|---|
| 1 | `cnpj_base` | 8 posições |
| 2 | `opcao_simples` | `S` / `N` |
| 3 | `data_opcao_simples` | `AAAAMMDD` |
| 4 | `data_exclusao_simples` | `AAAAMMDD` |
| 5 | `opcao_mei` | `S` / `N` |
| 6 | `data_opcao_mei` | `AAAAMMDD` |
| 7 | `data_exclusao_mei` | `AAAAMMDD` |

#### Tabelas de domínio

Todas têm 2 colunas (código e descrição), sem cabeçalho, em Latin-1 e separador `;`. Exemplo:

```csv
"0111301";"Cultivo de arroz"
"0111302";"Cultivo de milho"
```

### 2.4 Codificação e qualidade

- **Encoding:** Latin-1 (ISO-8859-1). Converter para UTF-8 na ingestão.
- **Separador:** `;`.
- **Aspas:** campos entre `"`, com escape padrão CSV (`""`).
- **Sem cabeçalho:** o layout é posicional; valide o número de colunas por linha.
- **Datas:** `AAAAMMDD`; `0`, `00000000` e vazio significam nulo.
- **Capital social:** decimal com vírgula; converter para `DECIMAL`.
- **CNAE secundária:** lista separada por vírgula dentro de um único campo.
- **Telefones:** DDD e número em colunas separadas; vários campos vazios.
- **E-mail:** presente em parte dos estabelecimentos; qualidade variável.
- **Município:** código de 4 dígitos da RFB. Não confundir com o código IBGE de 7 dígitos.
- **CPF de sócio:** sempre mascarado. Não é possível reconstruir o CPF completo (e não se deve tentar).
- **CNPJ alfanumérico:** novas inscrições podem ter letras nas 12 primeiras posições. O primeiro CNPJ alfanumérico (`00.000.000/E08G-12`) foi gerado em 31/07/2026. Use `String`, `upper()`, validação `[0-9A-Z]{12}[0-9]{2}` e **nunca** converta para inteiro.

### 2.5 Frequência e detecção de atualização

O snapshot é **mensal e completo** (não é delta). Datas observadas:

| Snapshot | Pasta modificada em | Situação |
|---|---|---|
| `2026-08` | 09/08/2026 | Disponível |
| `2026-09` | 14/09/2026 | Disponível |
| `2026-10` | 13/10/2026 | **Último disponível** |
| `2026-11` | — | Ainda não publicado em 14/11/2026 |

Conclusão: não existe dia fixo garantido. **Monitore diariamente** e processe quando a pasta aparecer. A latência típica dos dados é de 2 a 6 semanas em relação à data corrente.

Há também um `cnpj.tar.gz` de **63,95 GB** (modificado em 28/01/2026) contendo pastas mensais compactadas. Serve para backfill em bloco, mas **não** para atualização corrente; os arquivos mensais são mais recentes.

### 2.6 Desempenho de download observado

| Conexões paralelas | Throughput agregado |
|---:|---:|
| 1 | ~2,5 MB/s |
| 4 | ~9 MB/s |
| 10 | conexão resetada pelo servidor |

Recomendação: **4 a 6 conexões paralelas**, com retry e `Range` para retomar. O snapshot de 7,27 GB leva cerca de **15 minutos** a 9 MB/s (ou ~50 minutos em uma conexão). O arquivo `Estabelecimentos0.zip` sozinho tem 2,17 GB e deve ser baixado primeiro ou em paralelo com os demais.

---

## 3. O que é possível construir

### 3.1 Busca cadastral 360º

Dado um CNPJ (com ou sem pontuação, numérico ou alfanumérico):

- dados da empresa (razão social, natureza, porte, capital);
- todos os estabelecimentos (matriz e filiais), com endereço, CNAE, situação, contatos;
- quadro de sócios e representantes;
- opção pelo Simples/MEI e datas;
- histórico de mudanças (se o change log for implementado).

### 3.2 Busca avançada com múltiplos filtros

Combinações com `AND`/`OR`/`NOT`, facetas e ordenação:

| Dimensão | Exemplos de filtro |
|---|---|
| Identificação | CNPJ exato, CNPJ base, matriz/filial |
| Nome | razão social, nome fantasia, prefixo, “contém”, fuzzy/typo (opcional) |
| Sócios | nome do sócio, CPF/CNPJ mascarado, qualificação, data de entrada, faixa etária |
| Atividade | CNAE principal, CNAE secundária, lista de CNAEs, divisão/grupo/classe |
| Localização | UF, município (código ou nome), CEP exato/prefixo, bairro, logradouro |
| Situação | ativa, baixada, suspensa, inapta, nula; motivo; data da situação |
| Porte | micro, pequena, demais, não informado |
| Natureza jurídica | MEI, LTDA, SA, associação, etc. |
| Capital social | faixa mínima/máxima |
| Data de abertura | período, idade da empresa |
| Simples/MEI | optante, não optante, data de opção/exclusão |
| Contato | possui e-mail, possui telefone, DDD, domínio de e-mail |
| Flags | matriz/filial, endereço no exterior, situação especial |

### 3.3 Produtos e casos de uso

1. **Consulta e due diligence cadastral** — ficha completa, sócios, situação, mudanças.
2. **Prospecção B2B** — filtros por CNAE + cidade + situação + porte + contato; listas exportáveis; enriquecimento de CRM.
3. **Análise de mercado** — contagem por CNAE/UF/município, aberturas por mês, taxa de encerramento, densidade empresarial, ranking de cidades.
4. **Inteligência de rede societária** — sócios em comum, grupos econômicos, conexões entre empresas (com cautela pelo CPF mascarado).
5. **Monitoramento de carteira** — alertas mensais de mudança de situação, CNAE, endereço ou sócios.
6. **Enriquecimento de base** — casar leads/CNPJs com dados cadastrais, preencher CNAE, porte, endereço, contatos e Simples/MEI.
7. **API de consulta** — endpoint para outras aplicações, com chave, rate limit e versionamento de dados.
8. **Dashboards** — painéis por segmento, região, porte e regime tributário.

### 3.4 Índices que fazem sentido

| Necessidade | Técnica |
|---|---|
| CNPJ exato | chave primária / `ORDER BY cnpj`; `bloom_filter` para o CNPJ base |
| Nome/fantasia “contém” | coluna normalizada (sem acento, minúscula) + `ngrambf_v1` ou `tokenbf_v1`; opcionalmente índice `full_text` |
| Prefixo/autocomplete | índice primário sobre a coluna normalizada; `ngrambf_v1` |
| UF/município/CNAE/situação | `LowCardinality`, projeções com `ORDER BY (uf, municipio, cnae, situacao, cnpj)` |
| Faixa de capital/data | `minmax` |
| CNAE secundária | `Array(String)` + `hasAny`; tabela ponte ou materialized view para analytics |
| Sócio por nome/CPF mascarado | `ngrambf_v1` no nome; `bloom_filter` no CPF; projeção ordenada por CPF |
| Agregações | materialized views (`AggregatingMergeTree`) |
| Fuzzy/typo | mecanismo de busca dedicado (Meilisearch, Typesense ou Quickwit) — opcional |
| Geo/raio | geocodificação do CEP + índice geográfico — fase futura |

---

## 4. Limites e cuidados

### 4.1 O que os dados não têm

- **Faturamento, lucro ou número de funcionários.** Capital social não é receita.
- **CPF completo dos sócios.** Só o mascarado (`***428156**`).
- **Percentual de participação societária.** O arquivo lista sócios, mas não quotas.
- **Dados de crédito, score, sanções, processos ou certidões.**
- **Atualização em tempo real.** É um snapshot mensal.
- **Geolocalização precisa.** Só CEP e endereço; para raio, é preciso geocodificar.
- **Contatos completos.** E-mail e telefone têm cobertura e qualidade variáveis.
- **Garantia de exactidão.** A base pública pode conter erros; não substitui certidão oficial.

### 4.2 LGPD

Os dados são públicos, mas nomes de sócios, CPF mascarado, e-mail e telefone são **dados pessoais**. Para uso comercial:

- defina base legal (ex.: legítimo interesse para prospecção B2B) e finalidade;
- pratique minimização: não exponha CPF mascarado sem necessidade;
- controle acesso, registre auditoria e defina retenção;
- atenda solicitações de titulares (DSR) e tenha política de privacidade;
- não tente reconstruir CPF nem cruzar com bases ilícitas;
- se for oferecer API a terceiros, revise contratos, termos e responsabilidades.

### 4.3 Fragilidades da fonte

- Layout e nomes de arquivos podem mudar sem aviso (já ocorreu em versões anteriores).
- O servidor é público, sem SLA; pode ficar lento ou indisponível.
- O CNPJ alfanumérico exige mudanças em validação, ordenação e busca.
- Arquivos grandes (2,17 GB) exigem download retomável e validação de integridade.

**Mitigação:** validação de schema a cada snapshot, checksums, versão do parser, retries, alertas e cópia dos ZIPs brutos.

---

## 5. Arquitetura recomendada

### 5.1 Visão geral

```
┌─────────────────────────────────────────────────────────────────────┐
│ Fonte: Nextcloud público (WebDAV)                                   │
│ 2026-10/Empresas*.zip, Estabelecimentos*.zip, Socios*.zip, ...      │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ descoberta diária + download mensal
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Ingestão / transformação                                            │
│ Node/TS ou Python + DuckDB                                          │
│ - descompacta e converte Latin-1 → UTF-8                            │
│ - normaliza CNPJ, datas, capital, CNAEs                             │
│ - valida schema, contagens e chaves                                 │
│ - grava Parquet (ZSTD) por entidade                                 │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
              ┌─────────────────┴─────────────────┐
              ▼                                   ▼
┌───────────────────────────┐       ┌───────────────────────────────┐
│ ClickHouse                │       │ PostgreSQL                     │
│ - empresas                │       │ - usuários, listas, buscas     │
│ - estabelecimentos        │       │   salvas, tags, notas, API keys│
│ - sócios                  │       │ - auditoria, exportações       │
│ - simples                 │       └───────────────────────────────┘
│ - dimensões               │
│ - change log / agregados  │       ┌───────────────────────────────┐
│ - projeções e MV          │       │ Redis (opcional)               │
└─────────────┬─────────────┘       │ cache de CNPJ e facetas        │
              │                     └───────────────────────────────┘
              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ API (FastAPI ou NestJS) + Frontend (Next.js)                        │
│ - /v1/cnpj/{cnpj}                                                   │
│ - /v1/companies?filtros...                                          │
│ - /v1/stats?group_by=...                                            │
│ - /v1/exports                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 Por que ClickHouse

- 215 milhões de linhas e 26 GB descomprimidos cabem em uma máquina só.
- Filtros combinados e agregações (CNAE × UF × situação) são a especialidade de um banco colunar.
- Compressão alta (ZSTD) e custo de armazenamento baixo.
- Vários tipos de índice: `minmax`, `set`, `bloom_filter`, `tokenbf_v1`, `ngrambf_v1`, projeções, materialized views e, nas versões recentes, índice `full_text`.
- Um único componente para busca estruturada + analytics, reduzindo a complexidade operacional.

**Limitação:** busca textual com tolerância a erros de digitação e ranking sofisticado não é o ponto forte do ClickHouse. Para o MVP, `ngrambf`/`tokenbf` + normalização resolvem. Se “fuzzy/autocomplete” for requisito de produto, adicione Meilisearch/Quickwit em uma segunda fase — de preferência indexando apenas empresas ativas com contato, para não criar um índice de 72 milhões de documentos.

### 5.3 Alternativas e trade-offs

| Opção | Prós | Contras | Quando usar |
|---|---|---|---|
| **ClickHouse + Parquet** (recomendado) | Rápido em filtros/agregações, barato, muitos índices, um só componente | Curva de aprendizado; texto fuzzy limitado | Produto com muitos filtros e analytics |
| **PostgreSQL + pg_trgm** | ACID, maturidade, equipe costuma conhecer | 215 M linhas e muitos índices → 200 GB+, agregações mais lentas, tuning | MVP pequeno, equipe Postgres, consultas por CNPJ |
| **Elasticsearch/OpenSearch** | Melhor full-text/facetas | Caro para 215 M docs; operação pesada; agregações numéricas menos eficientes | Se busca textual for o core e houver orçamento |
| **DuckDB + Parquet** | Simples, rápido para analytics, custo mínimo | Concorrência limitada; não é servidor multiusuário | Análise interna/offline, prototipagem, ETL |
| **BigQuery/Athena/Snowflake** | Serverless, elástico | Custo por consulta, egress, recarga mensal; latência | Analytics corporativo, não API de baixa latência |
| **Neo4j** | Rede societária e caminhos | 28 M arestas; operação adicional | Fase futura, se grafo for produto |

### 5.4 Stack sugerida

| Camada | Escolha | Alternativa |
|---|---|---|
| Ingestão/transformação | DuckDB (CLI/SQL) + scripts Node/TS ou Python | Polars/Python, Spark |
| Serving analítico | ClickHouse (single node) | PostgreSQL, BigQuery |
| App/transacional | PostgreSQL 16 | MySQL |
| Cache | Redis | Memcached |
| API | FastAPI (Python) ou NestJS (Node) | Go, .NET |
| Frontend | Next.js + React + Tailwind + TanStack Table | Vue/Nuxt |
| Orquestração | CLI + cron/Task Scheduler | Prefect, Dagster, Airflow |
| Deploy | Docker Compose em VPS Linux | Kubernetes (só se necessário) |
| Observabilidade | Prometheus + Grafana + alertas Telegram/e-mail | Uptime Kuma, Sentry |

---

## 6. Modelo de dados proposto

### 6.1 Entidades principais (ClickHouse)

```sql
CREATE DATABASE IF NOT EXISTS cnpj;

-- Empresas (raiz do CNPJ)
CREATE TABLE cnpj.empresas (
  cnpj_base String,
  razao_social String,
  razao_social_busca String,              -- lower, sem acento, pontuação removida
  natureza_juridica LowCardinality(String),
  qualificacao_responsavel LowCardinality(String),
  capital_social Decimal(18,2),
  porte LowCardinality(String),
  ente_federativo String,
  snapshot Date
) ENGINE = MergeTree
ORDER BY cnpj_base;

-- Estabelecimentos (CNPJ completo)
CREATE TABLE cnpj.estabelecimentos (
  cnpj String,
  cnpj_base String,
  cnpj_ordem String,                      -- String: aceita letras (CNPJ alfanumérico)
  cnpj_dv String,
  matriz_filial LowCardinality(String),
  nome_fantasia String,
  nome_fantasia_busca String,
  situacao LowCardinality(String),
  data_situacao Nullable(Date32),
  motivo LowCardinality(String),
  nome_cidade_exterior String,
  pais LowCardinality(String),
  data_inicio Nullable(Date32),
  cnae_principal LowCardinality(String),
  cnaes_secundarios Array(String),
  tipo_logradouro LowCardinality(String),
  logradouro String,
  numero String,
  complemento String,
  bairro String,
  cep String,
  uf LowCardinality(String),
  municipio_codigo LowCardinality(String),
  ddd1 String, telefone1 String,
  ddd2 String, telefone2 String,
  ddd_fax String, fax String,
  email String,
  situacao_especial LowCardinality(String),
  data_situacao_especial Nullable(Date32),
  snapshot Date,
  INDEX idx_base cnpj_base TYPE bloom_filter GRANULARITY 4,
  INDEX idx_cep cep TYPE bloom_filter GRANULARITY 4,
  INDEX idx_fantasia nome_fantasia_busca TYPE ngrambf_v1(3, 65536, 3, 0) GRANULARITY 4,
  INDEX idx_inicio data_inicio TYPE minmax GRANULARITY 1
) ENGINE = MergeTree
ORDER BY cnpj;

-- Projeção para filtros geográficos/segmentados
ALTER TABLE cnpj.estabelecimentos
ADD PROJECTION proj_busca (
  SELECT * ORDER BY (uf, municipio_codigo, cnae_principal, situacao, cnpj)
);

-- Sócios
CREATE TABLE cnpj.socios (
  cnpj_base String,
  identificador_socio LowCardinality(String),
  nome_socio String,
  nome_socio_busca String,
  cpf_cnpj_socio String,                  -- mascarado
  qualificacao_socio LowCardinality(String),
  data_entrada Nullable(Date32),
  pais LowCardinality(String),
  representante_legal String,
  nome_representante String,
  qualificacao_representante LowCardinality(String),
  faixa_etaria LowCardinality(String),
  snapshot Date,
  INDEX idx_cpf cpf_cnpj_socio TYPE bloom_filter GRANULARITY 4,
  INDEX idx_nome nome_socio_busca TYPE ngrambf_v1(3, 65536, 3, 0) GRANULARITY 4
) ENGINE = MergeTree
ORDER BY (cnpj_base, cpf_cnpj_socio);

ALTER TABLE cnpj.socios
ADD PROJECTION proj_cpf (SELECT * ORDER BY (cpf_cnpj_socio, cnpj_base));

-- Simples / MEI
CREATE TABLE cnpj.simples (
  cnpj_base String,
  opcao_simples LowCardinality(String),
  data_opcao_simples Nullable(Date32),
  data_exclusao_simples Nullable(Date32),
  opcao_mei LowCardinality(String),
  data_opcao_mei Nullable(Date32),
  data_exclusao_mei Nullable(Date32),
  snapshot Date
) ENGINE = MergeTree
ORDER BY cnpj_base;

-- Change log mensal (diff entre snapshots)
CREATE TABLE cnpj.change_log (
  snapshot Date,
  entidade LowCardinality(String),
  chave String,
  campo LowCardinality(String),
  valor_antes String,
  valor_depois String
) ENGINE = MergeTree
PARTITION BY toYYYYMM(snapshot)
ORDER BY (entidade, chave, campo, snapshot);
```

### 6.2 Dimensões

```sql
CREATE TABLE cnpj.dim_cnae (
  codigo String,
  descricao String
) ENGINE = MergeTree ORDER BY codigo;

CREATE TABLE cnpj.dim_municipio (
  codigo String,        -- código RFB (4 dígitos)
  nome String,
  uf LowCardinality(String),
  ibge String           -- opcional, enriquecido externamente
) ENGINE = MergeTree ORDER BY (codigo, uf);

-- Análogas: dim_natureza, dim_qualificacao, dim_motivo, dim_pais
```

### 6.3 Tabela denormalizada para busca

Para evitar joins em consultas de lista, vale criar uma tabela “estabelecimento enriquecido” com os campos da empresa e do Simples:

```sql
CREATE TABLE cnpj.estabelecimentos_busca (
  cnpj String,
  cnpj_base String,
  razao_social String,
  razao_social_busca String,
  nome_fantasia String,
  nome_fantasia_busca String,
  situacao LowCardinality(String),
  data_situacao Nullable(Date32),
  data_inicio Nullable(Date32),
  cnae_principal LowCardinality(String),
  cnaes_secundarios Array(String),
  uf LowCardinality(String),
  municipio_codigo LowCardinality(String),
  cep String,
  bairro String,
  email String,
  telefones Array(String),
  porte LowCardinality(String),
  natureza_juridica LowCardinality(String),
  capital_social Decimal(18,2),
  simples UInt8,
  mei UInt8,
  matriz_filial LowCardinality(String),
  snapshot Date,
  INDEX idx_base cnpj_base TYPE bloom_filter GRANULARITY 4,
  INDEX idx_nome razao_social_busca TYPE ngrambf_v1(3, 65536, 3, 0) GRANULARITY 4,
  INDEX idx_fantasia nome_fantasia_busca TYPE ngrambf_v1(3, 65536, 3, 0) GRANULARITY 4
) ENGINE = MergeTree
ORDER BY (uf, municipio_codigo, cnae_principal, situacao, cnpj);
```

Essa tabela é a base do endpoint de listagem. Para busca por sócio, use a tabela `socios` e faça uma semijoin por `cnpj_base` (ou mantenha um array de sócios na tabela denormalizada, se o custo compensar).

### 6.4 PostgreSQL (aplicação)

```sql
-- usuários, organizações, permissões
users (id, email, password_hash, role, created_at)
organizations (id, name, plan)
memberships (user_id, org_id, role)

-- buscas salvas e listas
saved_searches (id, org_id, user_id, name, filters JSONB, created_at)
lists (id, org_id, user_id, name, type, filters JSONB, created_at)  -- type: static | dynamic
list_items (list_id, cnpj, status, notes, added_at)

-- tags, notas, exportações, API keys, auditoria
tags (id, org_id, name, color)
entity_tags (org_id, cnpj, tag_id)
notes (id, org_id, cnpj, user_id, body, created_at)
exports (id, org_id, user_id, filters JSONB, status, file_url, created_at)
api_keys (id, org_id, name, key_hash, scopes, last_used_at, revoked_at)
audit_log (id, org_id, user_id, action, entity, entity_id, metadata JSONB, created_at)
```

---

## 7. Pipeline de atualização

### 7.1 Etapas

| Etapa | Frequência | O que faz | Saída |
|---|---|---|---|
| 1. Descobrir | diária | `PROPFIND` na raiz; compara pastas/ETags com o estado | `source_snapshots` |
| 2. Baixar | mensal | 4–6 downloads paralelos, `Range`, retry, checksum | ZIPs + `manifest.json` |
| 3. Validar ZIP | mensal | `unzip -t`, tamanho, CRC, nomes esperados | relatório |
| 4. Extrair | mensal | CSV para staging (26 GB) | `staging/` |
| 5. Transformar | mensal | DuckDB: encoding, datas, decimal, CNAE, normalização | Parquet ZSTD |
| 6. Carregar | mensal | ClickHouse staging (`*_new`) | tabelas novas |
| 7. Validar dados | mensal | contagens, PKs, domínios, nulos, órfãos | relatório |
| 8. Publicar | mensal | `EXCHANGE TABLES` atômico | tabelas atuais |
| 9. Indexar | mensal | projeções, MV, change log, busca | índices atualizados |
| 10. Notificar | mensal | e-mail/Telegram, data version | alerta |
| 11. Limpar | mensal | staging, versões antigas, backup | disco livre |

### 7.2 Detecção de novo snapshot

```text
descobrir():
  root = PROPFIND("/")
  pastas = root onde nome ~ /^\d{4}-\d{2}$/
  para cada pasta:
    etag = ETag da pasta
    se (pasta, etag) não existe em source_snapshots:
      criar run de ingestão
```

Não confie apenas no nome da pasta: compare `ETag`/`Last-Modified`. Uma pasta pode ser republicada com correções.

### 7.3 Download idempotente e retomável

- Um `manifest.json` por snapshot com nome, tamanho, ETag, SHA-256 e status.
- Se o arquivo existe e o SHA-256 confere, pule.
- Se existe parcialmente, use `Range: bytes=<tamanho>-` para retomar.
- Limite de 4–6 conexões; backoff exponencial em 429/5xx/timeout.
- Trate `Estabelecimentos0.zip` (2,17 GB) separadamente; ele é o mais pesado.
- Nunca apague o ZIP bruto antes de validar a publicação.

### 7.4 Transformação com DuckDB

Exemplo de leitura (ajuste nomes/colunas):

```sql
CREATE OR REPLACE TABLE estabelecimentos AS
SELECT
  upper(trim(cnpj_base)) AS cnpj_base,
  upper(trim(cnpj_ordem)) AS cnpj_ordem,
  trim(cnpj_dv) AS cnpj_dv,
  upper(trim(cnpj_base)) || upper(trim(cnpj_ordem)) || trim(cnpj_dv) AS cnpj,
  nullif(trim(identificador_matriz_filial), '') AS matriz_filial,
  nullif(trim(nome_fantasia), '') AS nome_fantasia,
  nullif(trim(situacao_cadastral), '') AS situacao,
  try_strptime(nullif(data_situacao_cadastral, '0'), '%Y%m%d')::DATE AS data_situacao,
  nullif(trim(motivo_situacao_cadastral), '') AS motivo,
  ...
  try_strptime(nullif(data_inicio_atividade, '0'), '%Y%m%d')::DATE AS data_inicio,
  nullif(trim(cnae_fiscal_principal), '') AS cnae_principal,
  string_split(nullif(trim(cnae_fiscal_secundaria), ''), ',') AS cnaes_secundarios,
  ...
FROM read_csv(
  'staging/estabelecimentos/*.ESTABELE',
  delim = ';',
  quote = '"',
  header = false,
  encoding = 'latin1',
  all_varchar = true,
  nullstr = ''
);
```

Recomendações:

- Converta uma vez para UTF-8 e Parquet; não reprocesse CSV em cada consulta.
- Crie colunas normalizadas de busca (`razao_social_busca`, `nome_fantasia_busca`) com `lower`, remoção de acentos e pontuação.
- Valide o CNPJ com suporte a alfanumérico; não use casts numéricos.
- Preserve zeros à esquerda de CEP, telefone e códigos.
- Trate `0`, `00000000` e vazio como `NULL`.
- Para CNAE secundária, faça `trim` em cada item e remova vazios.
- Gere um `row_hash` por linha para facilitar diff entre snapshots.

### 7.5 Carga e publicação atômica

1. Crie tabelas de staging com a mesma estrutura das atuais: `estabelecimentos_new`, `empresas_new`, `socios_new`, `simples_new`.
2. Carregue os Parquet via `clickhouse-client` ou `INSERT INTO ... SELECT FROM file(...)`.
3. Rode as validações e consultas de fumaça.
4. Publique com `EXCHANGE TABLES` (banco Atomic):

```sql
EXCHANGE TABLES cnpj.estabelecimentos AND cnpj.estabelecimentos_new;
EXCHANGE TABLES cnpj.empresas AND cnpj.empresas_new;
EXCHANGE TABLES cnpj.socios AND cnpj.socios_new;
EXCHANGE TABLES cnpj.simples AND cnpj.simples_new;
```

5. Renomeie as tabelas antigas para `*_prev` (rollback) e descarte após N dias.
6. Atualize `data_versions` com snapshot, data de publicação, contagens e status.
7. Invalide cache (Redis) e faça warm-up das consultas mais comuns.

Se preferir manter histórico na mesma tabela, use `PARTITION BY snapshot` e uma view `current` que filtra o snapshot mais recente. Para o MVP, a troca atômica por tabela é mais simples e segura.

### 7.6 Change log e histórico

O snapshot é completo, então o diff mensal é a forma mais eficiente de guardar história:

- **Novas empresas**: `cnpj_base` que aparece pela primeira vez.
- **Encerradas**: mudança para situação `08` (baixada) ou `04` (inapta), com `data_situacao`.
- **Mudanças**: situação, motivo, CNAE, endereço, telefone/e-mail, natureza, porte, capital, sócios.
- **Agregados mensais**: contagens por UF, CNAE, porte, Simples/MEI, aberturas e baixas.

Guardar 42 snapshots completos custaria ~1,1 TB; o change log + agregados fica na casa de poucos GB. Se precisar de filtros históricos arbitrários (ex.: “ativas em jan/2025 por CNAE”), mantenha snapshots compactos mensais apenas com as colunas usadas (cnpj, situação, CNAE, UF, município, porte, Simples/MEI, data) ou Parquet no S3 consultável via DuckDB.

### 7.7 Agendamento

- **Diário, 06:00 America/Sao_Paulo:** descobre novo snapshot.
- Se houver snapshot novo, executa o pipeline completo (ou agenda para a madrugada).
- **Retry:** até 5 tentativas por arquivo; falha isolada não derruba o run.
- **Lock:** impede dois runs simultâneos.
- **SLO de atualidade:** alertar se o snapshot mais recente tiver mais de 45 dias.
- **Alertas:** falha de download, contagem fora da faixa, schema inesperado, disco > 80%, publicação concluída.

### 7.8 Validações obrigatórias

- Número de colunas por linha (7/11/30) e encoding.
- Contagem de linhas por entidade vs. snapshot anterior (ex.: ±5%).
- Duplicidade de PK (`cnpj_base`, `cnpj`).
- CNPJ inválido (dígito verificador) — aceitar formato alfanumérico.
- CNAE/município/UF/país/natureza fora dos domínios.
- Datas futuras ou anteriores a 1900.
- Estabelecimentos órfãos (sem empresa) e sócios órfãos.
- Taxa de nulos em campos críticos.
- `max(data_situacao)` compatível com o mês de referência.
- ZIP íntegro e SHA-256.

### 7.9 Backfill

- 42 snapshots disponíveis (`2023-05` a `2026-10`).
- Para o MVP, carregue apenas o snapshot atual.
- Para histórico, processe os snapshots em ordem e gere change log + agregados; não mantenha todos os CSVs.
- O `cnpj.tar.gz` de 64 GB pode acelerar o backfill, mas está desatualizado (jan/2026); prefira as pastas mensais.

---

## 8. Dimensionamento e custos

### 8.1 Armazenamento

| Item | Tamanho estimado |
|---|---:|
| ZIPs brutos (1 mês) | 7,3 GB |
| ZIPs brutos (3 meses) | 22 GB |
| CSV descomprimido (staging) | 26 GB (temporário) |
| Parquet curado (1 mês) | 3–6 GB |
| ClickHouse atual + índices/projeções | 15–30 GB |
| Change log + agregados (12–42 meses) | 5–20 GB |
| PostgreSQL | < 10 GB |
| Backups e logs | 20–50 GB |
| **Total confortável** | **250–500 GB** (1 TB dá margem) |

### 8.2 Hardware

| Cenário | vCPU | RAM | Disco | Uso |
|---|---:|---:|---:|---|
| MVP/internal | 8 | 16 GB | 300 GB NVMe | 1–5 usuários, consultas moderadas |
| **Recomendado interno** | **16** | **32 GB** | **1 TB NVMe** | **5–50 usuários, filtros e agregações** |
| Escala | 32 | 64 GB | 2 TB NVMe | 50–200 usuários, buscas textuais pesadas |
| Cluster | 3+ nós | 128 GB+ | S3 + NVMe | > 200 usuários, alta disponibilidade |

**Right-sizing:** 16 GB é o mínimo para uso interno; 32 GB é o ponto confortável. A RAM não serve para “ler ZIP” — o ZIP é lido uma vez na ingestão. A RAM é usada pelo banco em joins, ordenações, cache e agregações. 64 GB só se justifica com concorrência alta ou busca textual pesada.

### 8.3 Custos mensais aproximados

| Item | Faixa |
|---|---|
| VPS 16 vCPU / 32 GB / 1 TB | US$ 80–180 |
| VPS 32 vCPU / 64 GB / 2 TB | US$ 200–350 |
| Object storage 100 GB | US$ 2–5 |
| Backup externo | US$ 5–15 |
| Monitoramento/alertas | US$ 0–20 |
| **Total MVP** | **US$ 90–220/mês** |

Desenvolvimento estimado: 4–6 semanas para um MVP de produção com uma pessoa sênior full-stack + apoio de dados; 2–3 semanas para um protótipo funcional.

---

## 9. Segurança e operação

- **Rede:** firewall, TLS, acesso administrativo por VPN/IP allowlist.
- **Banco:** usuários separados para ingestão, API e leitura; senhas fortes; sem exposição pública de ClickHouse/Postgres.
- **API:** chaves, rate limit, quotas, validação de entrada, logs de auditoria, CORS restrito.
- **Dados:** criptografia em repouso e trânsito; backups criptografados.
- **LGPD:** política de privacidade, base legal, retenção, DSR, minimização, auditoria.
- **Observabilidade:** logs estruturados, métricas de ingestão e consulta, dashboards, alertas.
- **Continuidade:** backup do ClickHouse (`clickhouse-backup`), `pg_dump`, manifesto dos ZIPs; teste de restore.
- **Mudanças de schema:** versione o parser; valide antes de publicar; mantenha o snapshot anterior para rollback.

---

## 10. Roadmap sugerido

### Fase 0 — Fundação (2–4 dias)

- Repositório, Docker Compose (ClickHouse, PostgreSQL, Redis, API, web).
- Schema inicial e dimensões.
- Script de descoberta + download de um snapshot.
- Ingestão do snapshot atual em Parquet/ClickHouse.

### Fase 1 — MVP de busca (1–2 semanas)

- Endpoint `GET /v1/cnpj/{cnpj}` (ficha 360º).
- Endpoint `GET /v1/companies` com filtros: CNPJ, nome, UF, município, CNAE, situação, porte, capital, Simples/MEI, contato.
- Facetas e paginação.
- Exportação CSV.
- UI: busca, filtros, tabela, detalhe da empresa.
- Pipeline mensal com validações e publicação atômica.

### Fase 2 — Produto (2–4 semanas)

- Busca salva, listas, tags e notas.
- Histórico/change log, alertas de mudanças.
- Dashboards (aberturas, CNAE, UF, porte).
- Autenticação, organizações, permissões, API keys.
- Monitoramento, backups, deploy de produção.
- Ajuste de índices e benchmark com consultas reais.

### Fase 3 — Diferenciais (contínuo)

- Busca fuzzy/autocomplete dedicada (Meilisearch/Quickwit) se necessário.
- Rede societária e grafo.
- Geocodificação de CEP e busca por raio.
- Score de prospecção e enriquecimento de CRM.
- Integrações (HubSpot, Pipedrive, RD Station).
- API pública/white-label.
- Busca semântica/embeddings (se houver caso de uso).

---

## 11. Decisões que precisam ser tomadas

1. **Uso interno ou produto para terceiros?** Isso define autenticação, multi-tenant, LGPD, SLA e preço.
2. **Onde vai rodar?** VPS Linux, cloud (AWS/GCP/Azure) ou on-premises? Há Docker disponível? Qual o orçamento mensal?
3. **Quantos usuários e qual latência?** 10 usuários internos ou centenas de consultas concorrentes? Precisa de autocomplete com tolerância a erros?
4. **Histórico:** só o snapshot atual ou séries históricas, mudanças e alertas?
5. **Integrações:** CRM, exportação, API, webhooks?
6. **Stack:** preferência por TypeScript/Node ou Python? Isso muda a escolha da API e dos scripts de ingestão.

---

## 12. Conclusão

O projeto é **muito viável** e não exige infraestrutura exagerada: um único servidor com 16 vCPU / 32 GB RAM / 1 TB NVMe processa o snapshot completo e responde consultas com boa latência para uso interno. O ponto de atenção é a **operação mensal** — download de 7,3 GB, transformação de 26 GB, validação de 215 milhões de linhas e publicação atômica — e a **modelagem de busca**, especialmente para nome/fantasia e sócios.

A arquitetura recomendada é:

- **DuckDB** para ingestão e transformação em Parquet;
- **ClickHouse** para busca estruturada, filtros combinados e agregações;
- **PostgreSQL** para dados da aplicação;
- **API + Next.js** para a interface;
- **cron/Task Scheduler + CLI idempotente** para atualização mensal;
- **change log + agregados** para histórico sem armazenar 42 snapshots completos.

Com isso, é possível entregar desde uma consulta cadastral 360º até prospecção B2B, dashboards de mercado, listas exportáveis e uma API de enriquecimento — mantendo os dados atualizados automaticamente todo mês.

---

### Artefatos gerados nesta análise

- `ANALISE_CNPJ.md` — este documento.
- `docs/source_manifest.json` — manifesto do snapshot `2026-10` (37 arquivos, tamanhos, ETags, datas) e lista dos 42 snapshots disponíveis.
- `explore/` — scripts usados para validar acesso WebDAV, schemas, encoding, volumes e throughput (Node.js).
