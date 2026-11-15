# Banco de dados — PostgreSQL

## Decisão

O banco principal passa a ser **PostgreSQL 17**.

Motivos:

- é o banco mais comum e conhecido que tem template no EasyPanel;
- SQL relacional com joins, janelas, CTEs, JSONB e transações;
- bom para o cadastro CNPJ, para o grafo de evidências e para o estado da aplicação;
- dispensa serviço proprietário e pode rodar no mesmo servidor;
- deixa a porta aberta para PostGIS/trigram/particionamento sem trocar de banco.

Não escolhemos ClickHouse agora porque ele é excelente para varredura analítica, mas é pior para o CRUD da aplicação, transações, atualizações e joins menos previsíveis. Se um dia a escala analítica exigir, ClickHouse entra como camada secundária, não como banco principal.

## EasyPanel

1. Crie um template **PostgreSQL** (versão 17, se disponível).
2. Nome sugerido: `prospect-db`.
3. Disco: **200 GB** para a carga completa; 300 GB é mais confortável.
4. Memória: **4 GB** para o serviço e **16 GB** no servidor.
5. Ative backup automático do volume.
6. Anote host interno, porta, banco, usuário e senha.
7. Opcional: instale o template **pgweb** ou **Adminer** para inspecionar o banco.

Configuração inicial recomendada (16 GB de RAM no servidor):

```conf
shared_buffers = 4GB
effective_cache_size = 10GB
maintenance_work_mem = 2GB
work_mem = 64MB
max_wal_size = 8GB
random_page_cost = 1.1
max_connections = 80
```

O `docker-compose.db.yml` deste repositório sobe uma versão local com 2 GB de
`shared_buffers`; os valores acima são para o servidor real.

## Rodar localmente

```bash
cp .env.example .env
docker compose -f docker-compose.db.yml up -d
docker compose -f docker-compose.db.yml logs -f postgres
```

Conexão local:

```text
postgresql://prospect:prospect_dev@localhost:5433/prospect
```

Aplicar o schema:

```bash
npm run db:migrate
```

Ou, se preferir `psql`:

```bash
psql "postgresql://prospect:prospect_dev@localhost:5433/prospect" \
  -f db/migrations/001_init.sql
```

No EasyPanel, rode `npm run db:migrate` no terminal do serviço da aplicação
(usa a `DATABASE_URL` configurada). O runner registra cada arquivo em
`app.schema_migrations`, então pode ser executado novamente sem reaplicar.

No Windows, se não houver `psql`, use o terminal do container:

```powershell
docker compose -f docker-compose.db.yml exec -T postgres `
  psql -U prospect -d prospect -f - < db/migrations/001_init.sql
```

## Estrutura

| Schema | Uso |
|---|---|
| `core` | Empresas, estabelecimentos, sócios, Simples e dimensões |
| `read` | Tabelas denormalizadas para a UI (`estabelecimentos_busca`, `rede_contatos`) |
| `app` | Buscas salvas, workspaces e estado da aplicação |
| `history` | Snapshots oficiais e change log |
| `enrich` | Fatos e arestas de fontes externas, com fonte, validade, confiança e evidência |

### Por que `core.estabelecimentos` é particionada por UF

Consultas de mapa, dashboard e concorrência filtram UF. Cada UF vira uma
partição, o que reduz o volume lido e facilita manutenção. Consultas por CNPJ
usam o índice `(cnpj, uf)` dentro de cada partição.

### Por que `read.estabelecimentos_busca` é uma tabela, não uma view

É o modelo de leitura da API. Reconstruir depois de cada carga é mais rápido e
previsível do que fazer join de 70M de linhas em tempo de request.

### Busca textual

O schema já habilita `pg_trgm`. O índice trigram em 70M de nomes é opcional e
grande; comece com busca por prefixo (`razao_social_busca LIKE 'termo%'`) e
avalie o índice GIN depois de medir o volume real.

## Carga completa (implementada)

A carga é idempotente e roda em duas etapas:

```bash
npm run db:migrate          # 001_init + 002_load_helpers
npm run db:load:snapshot    # COPY dos CSVs em data/extracted/<snapshot>/
npm run db:load:sample      # validação rápida com data/sample
```

Fluxo do `db:load:snapshot`:

1. aplica migrações pendentes;
2. `TRUNCATE` das tabelas de destino e remoção dos 24 índices;
3. `COPY ... FROM STDIN` de cada CSV para tabelas temporárias (tudo texto);
4. `INSERT ... SELECT` com parsing em SQL (`core.parse_date`,
   `core.parse_numeric`, `core.normalize_text`) para `core.empresas`,
   `core.estabelecimentos` (particionada por UF), `core.socios`,
   `core.simples` e dimensões;
5. de-para município RFB → IBGE (`core.municipio_rfb_ibge`);
6. contagem de sócios (`core.socios_count`);
7. reconstrução de `read.estabelecimentos_busca` e `read.rede_contatos`;
8. criação dos índices e `ANALYZE`;
9. registro em `core.meta` e `history.snapshots`.

A amostra de 50 mil leva ~45 s no total (migração, carga, read model e índices).

### Rodar dentro do EasyPanel

Use `docker-compose.load.yml`: container descartável que baixa o snapshot,
extrai e carrega no Postgres interno. Precisa de ~40 GB livres no servidor e da
`DATABASE_URL` configurada. Ao terminar, o container sai.

### Download acelerado

`prepare:snapshot` usa `aria2c` quando disponível (`--split` e várias conexões
por arquivo); a imagem Docker já inclui o aria2. Para desligar: `USE_ARIA2=false`.
Ajustes: `ARIA2_CONNECTIONS` (padrão 16) e `ARIA2_JOBS` (padrão 4).

### Notas de dados

- DDD vem com zero à esquerda (`011`) e às vezes com lixo (`0532`, `9011`).
  A carga mantém apenas 2 dígitos válidos; o resto vira `NULL`.
- `uf` vazia vira `XX` e cai na partição default.
- `capital_social` e datas passam por funções tolerantes a erro, então valor
  inválido vira `NULL` em vez de derrubar a carga.

O app atual ainda usa DuckDB. A troca das queries para PostgreSQL é a próxima
etapa, feita por camadas:

1. conexão e healthcheck;
2. empresas/estabelecimentos/sócios;
3. busca e filtros;
4. contatos/rede;
5. mapa, mercado e timeline;
6. buscas salvas;
7. importador/backfill;
8. aposentar o DuckDB.

## Regras

- CNPJ é texto; nunca inteiro.
- Não criar score composto.
- Fato externo entra em `enrich.company_facts`; relação entra em `enrich.company_edges`.
- Toda aresta precisa de `evidence` e `confidence`.
- Fonte incerta não sobrescreve fonte oficial.
- Dado pessoal (CPF, contatos, sanções, dívida) exige acesso controlado e retenção definida.
