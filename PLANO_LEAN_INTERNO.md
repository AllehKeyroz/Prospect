# Plano Lean — Análise de Mercado e Concorrentes com Dados de CNPJ

**Contexto:** uso interno, análise de mercado/concorrentes, API em TypeScript/Node, servidor já existente.  
**Objetivo:** carregar os dados uma vez no banco, consultar sem descompactar nada e filtrar empresas com mais de 3 anos — sem superdimensionar RAM.

---

## 1. Correções importantes

### 1.1 O ZIP é lido uma vez, não a cada consulta

O fluxo correto é:

```
ZIP (download mensal)
  → descompacta uma vez
  → converte Latin-1 → UTF-8
  → normaliza campos
  → grava no banco
  → descarta (ou arquiva) ZIP/CSV
```

As consultas leem **tabelas do banco**, não arquivos. O Parquet que citei antes é apenas uma etapa opcional de staging/backup; se você for direto para o banco, ele não é necessário.

### 1.2 RAM não é para “ler arquivo”

A RAM é usada pelo banco para joins, ordenações, cache, agregações e concorrência. Para uso interno:

| RAM | Situação |
|---:|---|
| 8 GB | Apertado; só com subconjunto ativo ou DuckDB |
| **16 GB** | **Mínimo viável** para uso interno |
| **32 GB** | **Confortável** para 5–50 usuários e consultas de mercado |
| 64 GB | Só com muitos usuários simultâneos ou busca textual pesada |

O volume de 26 GB descomprimidos não exige 64 GB. Um banco colunar como ClickHouse comprime bem e trabalha com 16–32 GB sem problema para baixa concorrência.

### 1.3 “Dados a partir de 2023” é o limite dos snapshots, não das empresas

Esse é o ponto mais importante: **o snapshot atual é cumulativo**. Ele contém empresas abertas em 1901, 1965, 1990 etc., com o campo `data_inicio_atividade`. A pasta `2023-05` é apenas o snapshot mais antigo disponível no servidor — não significa que só existam empresas de 2023 para cá.

Amostra de ~569 mil registros do snapshot `2026-10`:

| Indicador | Resultado |
|---|---:|
| Registros com abertura antes de 14/11/2023 (mais de 3 anos) | **70,5%** |
| Empresas ativas (`situacao = 02`) | 41,6% |
| Empresas baixadas (`situacao = 08`) | 43,8% |
| Baixadas antes de 2023 | 168.535 registros |
| Data de abertura mais antiga | **1901-01-01** |
| Data de baixa mais antiga | **1965-12-31** |
| Abertura máxima observada | 2026-10-05 |

> Amostra dos primeiros 4 MB de cada um dos 10 arquivos `Estabelecimentos*.zip`. Serve para provar que os dados antigos existem; não é um censo. A distribuição real pode variar.

**Conclusão:** para prospectar empresas com mais de 3 anos, basta filtrar `data_inicio_atividade <= hoje - 3 anos` no snapshot atual. Não é necessário buscar histórico pré-2023.

### 1.4 O snapshot também contém empresas fechadas

A base não é só de empresas ativas: há `situacao = 08` (baixada), `04` (inapta), `03` (suspensa) etc., com datas antigas. Isso é útil para análise de concorrentes que fecharam, taxa de mortalidade e comparação de mercado.

Para prospecção, filtre `situacao = '02'`. Para análise de mercado, use todas as situações.

---

## 2. Onde encontrar dados anteriores a 2023?

### 2.1 Para idade das empresas: não precisa

O snapshot atual já traz a data de abertura. Exemplo de empresa de 1995: ela aparece no arquivo `2026-10` com `data_inicio_atividade = 19950101`. Você consegue filtrar, ordenar e agregar por idade sem nenhum snapshot antigo.

### 2.2 Para comparar 2020/2021/2022: o Wayback tem algo, mas é limitado

O Internet Archive tem capturas de ZIPs antigos do antigo endereço da Receita:

- `DADOS_ABERTOS_CNPJ_01.zip` a `DADOS_ABERTOS_CNPJ_20.zip`;
- capturas de 25/09/2019 e 26/01/2020;
- cerca de 4 GB no total;
- capturas de 2021 e 2022 existem para a **página HTML**, mas não para todos os ZIPs.

Limitações:

- cobertura incompleta e não contínua;
- downloads grandes no Wayback podem ser lentos, truncados ou instáveis;
- layout antigo pode ser diferente do atual;
- não há garantia de integridade dos arquivos.

**Recomendação:** não depender do Wayback agora. Use:

1. **Snapshot atual `2026-10`** para idade, prospecção e análise estática.
2. **Snapshot `2023-05`** como baseline para comparar 3,4 anos (novas empresas, fechadas, mudanças de situação/CNAE).
3. Se no futuro precisar de 2019/2020, podemos investigar o Wayback com validação de integridade — mas isso é um projeto separado.

### 2.3 Alternativa oficial para histórico

Os 42 snapshots mensais (`2023-05` a `2026-10`) são suficientes para:

- aberturas e fechamentos por mês;
- evolução de concorrentes;
- mudanças de situação, CNAE, endereço e sócios;
- comparação 2023 vs. 2026.

Não é necessário carregar os 42 snapshots completos. O ideal é:

- **snapshot atual completo** no banco;
- **snapshot 2023-05** para o baseline;
- **change log** (diff entre os dois) para análises de mudança;
- **agregados mensais** para séries temporais.

---

## 3. Stack lean recomendada

### 3.1 Decisão rápida

| Situação | Recomendação |
|---|---|
| Já existe PostgreSQL no servidor e 32 GB RAM | **PostgreSQL + Node/TS** (mais simples, um banco só) |
| Precisa de filtros/agregações rápidos e 16–32 GB RAM | **ClickHouse + Node/TS** (melhor custo/benefício analítico) |
| Servidor pequeno (8–16 GB), 1–3 usuários | **DuckDB + Node/TS** (arquivo local, sem servidor de banco) |
| Muitos usuários simultâneos / busca textual pesada | 64 GB + ClickHouse, ou search engine dedicado |

**Minha recomendação para o seu caso:** se o servidor já tem PostgreSQL e pelo menos 32 GB, comece por ele. Se as consultas de mercado com vários filtros passarem de 5–10 segundos, migre a camada analítica para ClickHouse. Se o servidor tem 16 GB e você quer agilidade desde o início, vá direto de **ClickHouse com 16–32 GB**.

### 3.2 Comparativo

| Critério | PostgreSQL | ClickHouse | DuckDB |
|---|---|---|---|
| Facilidade | Alta | Média | Alta |
| Filtros combinados em 72 M linhas | Boa com índices | **Excelente** | Muito boa (single-user) |
| Agregações de mercado | Boa | **Excelente** | Excelente |
| Busca textual “contém” | `pg_trgm` (ok) | `ngrambf`/`tokenbf` (bom) | `ILIKE`/full-text (ok) |
| Concorrência multiusuário | **Alta** | Alta | Limitada |
| RAM para uso interno | 32 GB | **16–32 GB** | 8–16 GB |
| Disco para 215 M linhas | 100–200 GB | **20–50 GB** | 20–40 GB |
| Complexidade operacional | Baixa | Média | Baixa |
| Melhor uso | App + dados | Analytics | Análise local |

### 3.3 Stack sugerida (Node/TypeScript)

- **API:** Fastify ou NestJS.
- **Banco principal:** PostgreSQL (se já existe) ou ClickHouse (analytics).
- **Ingestão:** Node/TS + `child_process` para `unzip -p` + `COPY`/`clickhouse-client`; ou `unzipper` + streams.
- **Frontend:** Next.js (se precisar de interface) ou apenas API + Metabase/Grafana para uso interno.
- **Agendamento:** cron/Task Scheduler + script Node `ingest`.
- **Sem Python obrigatório.** Dá para fazer tudo em TS + SQL.

---

## 4. Ingestão: uma vez, direto no banco

### 4.1 Fluxo

1. Detectar novo snapshot via WebDAV (`PROPFIND`).
2. Baixar os 37 ZIPs (4–6 conexões, `Range`, retry).
3. Para cada ZIP:
   - `unzip -p arquivo.zip` → stream do CSV;
   - converter Latin-1 → UTF-8;
   - carregar em uma tabela de staging (todas as colunas como texto);
   - transformar com SQL (datas, decimal, arrays, normalização);
   - inserir na tabela final;
   - apagar staging e CSV temporário.
4. Criar/recriar índices depois da carga.
5. Rodar `ANALYZE`/`OPTIMIZE`.
6. Publicar (troca atômica) e invalidar cache.

### 4.2 PostgreSQL: `COPY` direto do ZIP

```sql
-- staging com todas as colunas como texto
CREATE UNLOGGED TABLE est_staging (
  cnpj_base text, cnpj_ordem text, cnpj_dv text, matriz_filial text,
  nome_fantasia text, situacao text, data_situacao text, motivo text,
  nome_cidade_exterior text, pais text, data_inicio text,
  cnae_principal text, cnae_secundaria text, tipo_logradouro text,
  logradouro text, numero text, complemento text, bairro text, cep text,
  uf text, municipio text, ddd1 text, telefone1 text, ddd2 text,
  telefone2 text, ddd_fax text, fax text, email text,
  situacao_especial text, data_situacao_especial text
);

COPY est_staging
FROM PROGRAM 'unzip -p /dados/2026-10/Estabelecimentos0.zip'
WITH (FORMAT csv, DELIMITER ';', QUOTE '"', ENCODING 'LATIN1');
```

Depois:

```sql
INSERT INTO estabelecimentos
SELECT
  upper(trim(cnpj_base)) || upper(trim(cnpj_ordem)) || trim(cnpj_dv) AS cnpj,
  upper(trim(cnpj_base)) AS cnpj_base,
  upper(trim(cnpj_ordem)) AS cnpj_ordem,
  trim(cnpj_dv) AS cnpj_dv,
  nullif(trim(matriz_filial), '') AS matriz_filial,
  nullif(trim(nome_fantasia), '') AS nome_fantasia,
  nullif(trim(situacao), '') AS situacao,
  CASE WHEN data_situacao IN ('0', '00000000', '') THEN NULL
       ELSE to_date(data_situacao, 'YYYYMMDD') END AS data_situacao,
  ...
  CASE WHEN data_inicio IN ('0', '00000000', '') THEN NULL
       ELSE to_date(data_inicio, 'YYYYMMDD') END AS data_inicio,
  nullif(trim(cnae_principal), '') AS cnae_principal,
  string_to_array(nullif(trim(cnae_secundaria), ''), ',') AS cnaes_secundarios,
  ...
FROM est_staging;
```

Vantagens:

- `COPY` é o caminho mais rápido no Postgres;
- `ENCODING 'LATIN1'` converte direto;
- não precisa de Parquet nem DuckDB;
- o ZIP é lido uma vez.

Cuidados:

- `COPY FROM PROGRAM` exige superusuário ou role com `pg_execute_server_program`; se não puder, use `unzip -p` no Node e `pg-copy-streams`.
- `COPY` não aceita `NULL ''` para distinguir vazio de nulo; carregue como texto e trate no `INSERT`.
- Crie a tabela final como `UNLOGGED` durante a carga? Não: a final precisa ser durável. Use staging `UNLOGGED`, final normal.
- Crie índices **depois** da carga; isso reduz muito o tempo.
- Ajuste `maintenance_work_mem`, `work_mem`, `max_wal_size` durante a carga.

### 4.3 ClickHouse: `clickhouse-client` direto

```bash
unzip -p Estabelecimentos0.zip \
  | iconv -f LATIN1 -t UTF-8 \
  | clickhouse-client \
      --query "INSERT INTO cnpj.estabelecimentos_staging FORMAT CSV" \
      --format_csv_delimiter=';'
```

Depois:

```sql
INSERT INTO cnpj.estabelecimentos
SELECT
  upper(trim(cnpj_base)) || upper(trim(cnpj_ordem)) || trim(cnpj_dv) AS cnpj,
  ...
  if(data_inicio IN ('0','00000000',''), NULL, toDate32(data_inicio)) AS data_inicio,
  splitByChar(',', nullif(trim(cnae_secundaria), '')) AS cnaes_secundarios,
  ...
FROM cnpj.estabelecimentos_staging;
```

Ou use `INSERT INTO ... SELECT FROM file('...parquet')` se preferir Parquet. Para o seu caso, o caminho direto é suficiente.

### 4.4 Full reload mensal ou incremental?

Para 26 GB e uso interno, **full reload mensal** é mais simples e seguro:

- baixa o snapshot novo;
- carrega em tabelas `*_new`;
- valida;
- troca com `EXCHANGE TABLES` (ClickHouse) ou `ALTER TABLE ... RENAME` (Postgres);
- mantém a versão anterior por alguns dias para rollback.

Incremental (diff por CNPJ) só compensa se a janela de carga for crítica. Para histórico, gere o **change log** depois da carga, comparando com o snapshot anterior.

---

## 5. Modelo mínimo para análise de mercado

### 5.1 Tabela principal

Uma tabela denormalizada por estabelecimento resolve a maior parte das consultas:

```
estabelecimentos_busca
  cnpj, cnpj_base, cnpj_ordem, cnpj_dv, matriz_filial
  razao_social, razao_social_busca
  nome_fantasia, nome_fantasia_busca
  situacao, data_situacao, motivo
  data_inicio, idade_anos, is_ativa, is_mais_3_anos
  cnae_principal, cnaes_secundarios
  uf, municipio_codigo, municipio_nome, cep, bairro
  email, telefones
  natureza_juridica, porte, capital_social
  simples, mei
  snapshot
```

Campos calculados:

- `idade_anos = date_part('year', age(current_date, data_inicio))`;
- `is_ativa = situacao = '02'`;
- `is_mais_3_anos = data_inicio <= current_date - interval '3 years'`.

### 5.2 Índices no PostgreSQL

```sql
-- busca exata
CREATE INDEX ix_est_cnpj ON estabelecimentos (cnpj);
CREATE INDEX ix_est_base ON estabelecimentos (cnpj_base);

-- filtros de mercado
CREATE INDEX ix_est_uf_cnae ON estabelecimentos (uf, cnae_principal) WHERE situacao = '02';
CREATE INDEX ix_est_situacao_inicio ON estabelecimentos (situacao, data_inicio);
CREATE INDEX ix_est_inicio_brin ON estabelecimentos USING brin (data_inicio);

-- CNAE secundária como array
CREATE INDEX ix_est_cnaes_sec ON estabelecimentos USING gin (cnaes_secundarios);

-- nome/fantasia
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX ix_est_razao_trgm ON estabelecimentos USING gin (razao_social_busca gin_trgm_ops);
CREATE INDEX ix_est_fantasia_trgm ON estabelecimentos USING gin (nome_fantasia_busca gin_trgm_ops);

-- contatos
CREATE INDEX ix_est_email ON estabelecimentos (email) WHERE email <> '';
```

### 5.3 Índices no ClickHouse

- `ORDER BY cnpj` para busca exata;
- projeção `ORDER BY (uf, municipio_codigo, cnae_principal, situacao, cnpj)` para filtros;
- `bloom_filter` em `cnpj_base` e `cep`;
- `ngrambf_v1` em `razao_social_busca`/`nome_fantasia_busca`;
- `minmax` em `data_inicio` e `capital_social`;
- `LowCardinality` em `uf`, `situacao`, `porte`, `natureza_juridica`, `cnae_principal`;
- materialized views para contagens por CNAE/UF/mês.

### 5.4 Agregados

Crie materialized views/tabelas para as perguntas mais frequentes:

- `mv_cnae_uf`: quantidade de empresas ativas por CNAE e UF;
- `mv_aberturas_mes`: aberturas por mês;
- `mv_baixas_mes`: baixas por mês;
- `mv_porte_uf`: distribuição por porte;
- `mv_simples_mei`: optantes por UF/CNAE.

Isso evita varrer 72 M linhas a cada dashboard.

---

## 6. Consultas que respondem às suas perguntas

### 6.1 Empresas ativas com mais de 3 anos, por CNAE e UF

```sql
SELECT cnae_principal, uf, count(*) AS empresas
FROM estabelecimentos_busca
WHERE situacao = '02'
  AND data_inicio <= CURRENT_DATE - INTERVAL '3 years'
GROUP BY cnae_principal, uf
ORDER BY empresas DESC
LIMIT 50;
```

### 6.2 Empresas mais antigas ainda ativas

```sql
SELECT cnpj, razao_social, data_inicio, uf, cnae_principal
FROM estabelecimentos_busca
WHERE situacao = '02'
  AND data_inicio >= DATE '1900-01-01'
ORDER BY data_inicio ASC
LIMIT 100;
```

### 6.3 Concorrentes em um segmento/cidade

```sql
SELECT cnpj, razao_social, nome_fantasia, data_inicio, capital_social,
       email, telefones, simples, mei
FROM estabelecimentos_busca
WHERE situacao = '02'
  AND cnae_principal = ANY (ARRAY['5611201','5611202','5611203'])
  AND uf = 'SP'
  AND municipio_codigo = '7107'
  AND data_inicio <= CURRENT_DATE - INTERVAL '3 years'
ORDER BY capital_social DESC NULLS LAST, data_inicio ASC;
```

### 6.4 Empresas novas (últimos 3 anos)

```sql
SELECT date_trunc('month', data_inicio) AS mes, count(*) AS aberturas
FROM estabelecimentos_busca
WHERE data_inicio > CURRENT_DATE - INTERVAL '3 years'
GROUP BY 1
ORDER BY 1;
```

### 6.5 Taxa de fechamento por ano

```sql
SELECT date_part('year', data_situacao) AS ano, count(*) AS baixas
FROM estabelecimentos_busca
WHERE situacao = '08' AND data_situacao IS NOT NULL
GROUP BY 1
ORDER BY 1;
```

### 6.6 Market share por CNAE

```sql
WITH base AS (
  SELECT cnae_principal, count(*) AS total
  FROM estabelecimentos_busca
  WHERE situacao = '02' AND data_inicio <= CURRENT_DATE - INTERVAL '3 years'
  GROUP BY 1
)
SELECT cnae_principal, total,
       round(100.0 * total / sum(total) OVER (), 2) AS pct
FROM base
ORDER BY total DESC
LIMIT 30;
```

---

## 7. Dimensionamento para o seu caso

### 7.1 Perfis

| Perfil | RAM | Disco | O que esperar |
|---|---:|---:|---|
| Enxuto | 8 GB | 200 GB | DuckDB ou ClickHouse com limites; 1–3 usuários; consultas simples |
| **Mínimo interno** | **16 GB** | **300 GB** | ClickHouse ou Postgres; 1–10 usuários; consultas de segundos |
| **Confortável** | **32 GB** | **500 GB–1 TB** | 5–50 usuários; filtros e agregações rápidos |
| Escala | 64 GB+ | 2 TB | Muitos usuários, buscas textuais pesadas, histórico completo |

### 7.2 O que ocupa espaço

| Item | Tamanho |
|---|---:|
| ZIPs brutos (1 mês) | 7,3 GB |
| CSV descomprimido (temporário) | 26 GB |
| PostgreSQL (tabelas + índices) | 100–200 GB |
| ClickHouse (comprimido + índices) | 20–50 GB |
| DuckDB (arquivo) | 20–40 GB |
| Snapshot 2023-05 adicional | +20–40 GB (ClickHouse) / +100 GB (Postgres) |

**Se o disco for apertado:** carregue apenas estabelecimentos ativos + empresas/sócios relacionados na tabela quente; mantenha o snapshot completo em ZIP/Parquet no disco frio. Para análise de concorrentes ativos, isso resolve. Se precisar analisar fechadas, carregue todas.

### 7.3 Configuração do servidor

- **CPU:** 8 cores é suficiente; 16 acelera a carga.
- **RAM:** 16 GB mínimo; 32 GB recomendado.
- **Disco:** NVMe, 300–500 GB livre; 1 TB se guardar 2–3 snapshots.
- **Rede:** 100 Mbps+; o download de 7,3 GB leva ~15 min a 9 MB/s.
- **SO:** Linux é mais confortável para `unzip`, `iconv`, `clickhouse-client` e cron. Windows funciona, mas dá mais atrito.

---

## 8. MVP em Node/TypeScript

### Fase 1 — Carga e consulta (1–2 semanas)

1. Script `ingest` em Node/TS:
   - WebDAV discovery;
   - download 4–6 em paralelo;
   - `unzip -p` + `COPY`/`clickhouse-client`;
   - staging → transformação → tabela final;
   - índices e `ANALYZE`.
2. API Fastify/NestJS:
   - `GET /cnpj/:cnpj`;
   - `GET /empresas?uf=&cnae=&situacao=&idade_min=&...`;
   - `GET /estatisticas?group_by=cnae|uf|municipio&idade_min=3`;
   - `GET /export.csv` com os mesmos filtros.
3. Query builder com filtros tipados (Zod) e SQL parametrizado.
4. Paginação e ordenação.
5. Logs e healthcheck.

### Fase 2 — Análise (1–2 semanas)

1. Ingestão do snapshot `2023-05` + change log.
2. Materialized views de mercado.
3. Dashboard simples (Metabase, Grafana ou Next.js).
4. Busca salva e exportação.
5. Atualização mensal automática.

### Fase 3 — Diferenciais

- Ranking de concorrentes por CNAE/cidade.
- Score de prospecção (idade, porte, capital, contato, Simples/MEI).
- Comparação 2023 vs. 2026.
- Alertas de mudanças.
- Rede societária.

---

## 9. O que eu preciso saber para fechar a arquitetura

1. **Configuração do servidor:** CPU, RAM, disco livre e sistema operacional.
2. **Banco que já existe:** PostgreSQL, MySQL, SQL Server ou nenhum? Qual versão?
3. **Docker disponível?** Podemos instalar ClickHouse/DuckDB ou usar só o banco existente?
4. **Volume de uso:** quantos usuários e consultas por dia? Precisa de interface web ou API + planilha basta?
5. **Escopo da carga:** todos os estabelecimentos ou só ativos? Precisa do baseline `2023-05`?
6. **Prioridade:** velocidade de consulta ou simplicidade operacional?

Com essas respostas, o próximo passo é montar a ingestão do snapshot `2026-10` no banco escolhido e a API Node/TS com os filtros de idade, CNAE, UF e situação.

---

## 10. Resumo em uma frase

Você **não precisa de 64 GB nem de dados anteriores a 2023** para prospectar empresas com mais de 3 anos: o snapshot atual já traz a data de abertura de empresas desde 1901. Descompacte uma vez, grave no banco e consulte por `data_inicio_atividade`; para o resto, 16–32 GB de RAM e 300–500 GB de disco são suficientes para uso interno.
