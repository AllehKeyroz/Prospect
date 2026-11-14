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
psql "postgresql://prospect:prospect_dev@localhost:5433/prospect" \
  -f db/migrations/001_init.sql
```

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

## Carga completa

Para 215M de linhas, não use `INSERT` linha a linha:

1. baixe e extraia os CSVs;
2. `COPY ... FROM STDIN` para tabelas `UNLOGGED` de staging;
3. faça a normalização;
4. carregue `core` e `read` em lotes;
5. crie índices e materialized views **depois** da carga;
6. rode `ANALYZE`;
7. registre snapshot, hash e contagens em `history.snapshots` e `core.meta`.

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
