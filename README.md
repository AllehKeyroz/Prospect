# CNPJ Prospect — MVP

Sistema interno de consulta e análise de mercado/concorrentes com os Dados Abertos de CNPJ da Receita Federal.

**Status:** MVP funcional com amostra local. A carga do snapshot completo é a próxima etapa.

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
  - filtros de UF, CNAE, situação, porte, idade mínima, capital mínimo;
  - filtros de Simples, MEI, com e-mail, com telefone, somente matriz;
  - cards de resumo;
  - ranking de CNAEs e UFs;
  - ficha cadastral com estabelecimentos, sócios e Simples/MEI;
  - exportação CSV.
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
| `DUCKDB_PATH` | `./data/cnpj.duckdb` | Arquivo do banco |
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
| `GET` | `/api/empresas` | Listagem com filtros, paginação e resumo |
| `GET` | `/api/estatisticas` | Agregações por UF, CNAE, situação, porte, município ou natureza |
| `GET` | `/api/cnpj/:cnpj` | Ficha 360º (aceita 8 ou 14 caracteres) |
| `GET` | `/api/export.csv` | Exportação CSV com os mesmos filtros |

### Exemplos

```bash
# Empresas ativas, com mais de 3 anos, em SP, do CNAE de restaurantes
curl "http://localhost:3000/api/empresas?situacao=02&idade_min=3&uf=SP&cnae=5611201&page_size=25"

# Busca livre
curl "http://localhost:3000/api/empresas?q=padaria&situacao=02"

# Ficha de uma empresa (matriz ou filial)
curl "http://localhost:3000/api/cnpj/00000000000191"

# Top CNAEs
curl "http://localhost:3000/api/estatisticas?situacao=02&idade_min=3&group_by=cnae&limit=10"

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
| `cnae` | `5611201` | Principal ou secundária; 4–7 dígitos |
| `situacao` | `02` | `01` nula, `02` ativa, `03` suspensa, `04` inapta, `08` baixada |
| `porte` | `01` | `01` micro, `03` pequena, `05` demais |
| `natureza` | `2062` | Código de natureza jurídica |
| `idade_min` | `3` | Anos desde a abertura |
| `idade_max` | `20` | Anos desde a abertura |
| `capital_min` | `100000` | Capital social mínimo |
| `capital_max` | `5000000` | Capital social máximo |
| `simples` | `true` | Somente optantes do Simples |
| `mei` | `true` | Somente MEI |
| `com_email` | `true` | Somente com e-mail |
| `com_telefone` | `true` | Somente com telefone |
| `matriz` | `true` | Somente matriz |
| `page` | `1` | Página |
| `page_size` | `25` | Máximo 200 |
| `sort` | `razao_social` | `razao_social`, `data_inicio`, `capital_social`, `uf`, `cnae`, `situacao`, `idade` |
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
    "com_telefone": 4948
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
| `meta` | Snapshot, data de geração e contagens |

A tabela `estabelecimentos_busca` já traz:

- razão social e nome fantasia normalizados para busca;
- descrição de CNAE, município e natureza;
- situação/porte/matriz traduzidos;
- `idade_anos`, `is_ativa`, `is_mais_3_anos`;
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

---

## 8. Limitações conhecidas

- **Amostra:** 50 mil estabelecimentos da faixa `00000000–04631960`; não é o Brasil inteiro.
- **Simples/MEI:** a amostra tem 10.846 registros; a carga completa terá todos.
- **Histórico:** o MVP usa um snapshot. Comparações 2023 vs. 2026 e change log ficam para a próxima fase.
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
  db/
    duckdb.ts          # pool de conexões
    schema.ts          # DDL e transformações
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
test/
  cnpj.test.ts
  queryBuilder.test.ts
data/
  sample/              # CSVs da amostra (ignorado no git)
  raw/                 # ZIPs baixados (ignorado no git)
  cnpj.duckdb          # banco (ignorado no git)
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
