import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import pg from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import { config } from '../config.js';
import { runMigrations } from './migrate.js';

const { Client } = pg;
type Client = pg.Client;

/**
 * Carga dos CSVs da Receita no PostgreSQL.
 *
 * Uso:
 *   npm run db:migrate                       # aplica o schema
 *   npm run db:load:sample                   # amostra de 50 mil (validação rápida)
 *   npm run db:load:snapshot                 # snapshot completo em data/extracted/<snapshot>
 *
 * Fluxo por tabela: COPY do CSV para uma tabela temporária (tudo texto) e
 * INSERT ... SELECT com o parsing/normalização em SQL. Isso evita cast linha a
 * linha no Node e deixa o Postgres fazer o trabalho em bloco.
 *
 * O log é incremental e cada etapa informa o tempo. Se o processo cair, basta
 * rodar de novo: as tabelas são truncadas no início.
 */

interface LoadPaths {
  empresas: string[];
  estabelecimentos: string[];
  socios: string[];
  simples: string[];
  dims: Array<{ table: string; file: string }>;
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

const SQL_EMPRESAS = `
INSERT INTO core.empresas (
  cnpj_base, razao_social, razao_social_busca, natureza_juridica,
  qualificacao_responsavel, capital_social, porte, ente_federativo, snapshot
)
SELECT
  upper(btrim(c0)),
  nullif(btrim(c1), ''),
  coalesce(core.normalize_text(c1), ''),
  nullif(btrim(c2), ''),
  nullif(btrim(c3), ''),
  core.parse_numeric(c4),
  nullif(btrim(c5), ''),
  nullif(btrim(c6), ''),
  $1
FROM stg_empresas
WHERE btrim(c0) <> ''
ON CONFLICT (cnpj_base) DO NOTHING`;

const SQL_ESTABELECIMENTOS = `
INSERT INTO core.estabelecimentos (
  cnpj, cnpj_base, cnpj_ordem, cnpj_dv, matriz_filial,
  nome_fantasia, nome_fantasia_busca, situacao, data_situacao, motivo,
  nome_cidade_exterior, pais, data_inicio, cnae_principal, cnaes_secundarios,
  tipo_logradouro, logradouro, numero, complemento, bairro, cep, uf,
  municipio_codigo, ddd1, telefone1, ddd2, telefone2, ddd_fax, fax, email,
  situacao_especial, data_situacao_especial, snapshot
)
SELECT
  upper(btrim(c0)) || upper(btrim(c1)) || btrim(c2),
  upper(btrim(c0)),
  upper(btrim(c1)),
  btrim(c2),
  nullif(btrim(c3), ''),
  nullif(btrim(c4), ''),
  coalesce(core.normalize_text(c4), ''),
  nullif(btrim(c5), ''),
  core.parse_date(c6),
  nullif(btrim(c7), ''),
  nullif(btrim(c8), ''),
  nullif(btrim(c9), ''),
  core.parse_date(c10),
  nullif(btrim(c11), ''),
  coalesce(string_to_array(nullif(btrim(c12), ''), ','), '{}'),
  nullif(btrim(c13), ''),
  nullif(btrim(c14), ''),
  nullif(btrim(c15), ''),
  nullif(btrim(c16), ''),
  nullif(btrim(c17), ''),
  nullif(btrim(c18), ''),
  coalesce(nullif(btrim(c19), ''), 'XX'),
  nullif(btrim(c20), ''),
  -- DDD vem ora com zero à esquerda ('011'), ora com lixo ('0532', '9011').
  -- Só aceitamos 2 dígitos depois de remover zeros à esquerda.
  case when ltrim(btrim(c21), '0') ~ '^[0-9]{2}$' then ltrim(btrim(c21), '0') end,
  nullif(btrim(c22), ''),
  case when ltrim(btrim(c23), '0') ~ '^[0-9]{2}$' then ltrim(btrim(c23), '0') end,
  nullif(btrim(c24), ''),
  case when ltrim(btrim(c25), '0') ~ '^[0-9]{2}$' then ltrim(btrim(c25), '0') end,
  nullif(btrim(c26), ''),
  lower(nullif(btrim(c27), '')),
  nullif(btrim(c28), ''),
  core.parse_date(c29),
  $1
FROM stg_estabelecimentos
WHERE btrim(c0) <> ''
ON CONFLICT DO NOTHING`;

const SQL_SOCIOS = `
INSERT INTO core.socios (
  cnpj_base, identificador_socio, nome_socio, nome_socio_busca, cpf_cnpj_socio,
  qualificacao_socio, data_entrada, pais, representante_legal, nome_representante,
  qualificacao_representante, faixa_etaria, snapshot
)
SELECT
  upper(btrim(c0)),
  nullif(btrim(c1), ''),
  nullif(btrim(c2), ''),
  coalesce(core.normalize_text(c2), ''),
  nullif(btrim(c3), ''),
  nullif(btrim(c4), ''),
  core.parse_date(c5),
  nullif(btrim(c6), ''),
  nullif(btrim(c7), ''),
  nullif(btrim(c8), ''),
  nullif(btrim(c9), ''),
  nullif(btrim(c10), ''),
  $1
FROM stg_socios
WHERE btrim(c0) <> ''`;

const SQL_SIMPLES = `
INSERT INTO core.simples (
  cnpj_base, opcao_simples, data_opcao_simples, data_exclusao_simples,
  opcao_mei, data_opcao_mei, data_exclusao_mei, snapshot
)
SELECT
  upper(btrim(c0)),
  nullif(btrim(c1), ''),
  core.parse_date(c2),
  core.parse_date(c3),
  nullif(btrim(c4), ''),
  core.parse_date(c5),
  core.parse_date(c6),
  $1
FROM stg_simples
WHERE btrim(c0) <> ''
ON CONFLICT (cnpj_base) DO NOTHING`;

const DIM_TABLES: Record<string, string> = {
  cnae: 'core.dim_cnae',
  municipio: 'core.dim_municipio',
  natureza: 'core.dim_natureza',
  qualificacao: 'core.dim_qualificacao',
  motivo: 'core.dim_motivo',
  pais: 'core.dim_pais',
};

const SQL_MUNICIPIO_IBGE = `
INSERT INTO core.municipio_ibge (codigo, nome, uf, regiao, regiao_codigo)
SELECT btrim(c0), btrim(c1), upper(btrim(c2)), nullif(btrim(c3), ''), nullif(btrim(c4), '')
FROM stg_municipio_ibge
WHERE btrim(c0) <> ''
ON CONFLICT (codigo) DO NOTHING`;

const SQL_MUNICIPIO_DE_PARA = `
INSERT INTO core.municipio_rfb_ibge (municipio_codigo, uf, municipio_ibge, regiao)
WITH pares AS (
  SELECT DISTINCT municipio_codigo, uf
  FROM core.estabelecimentos
  WHERE municipio_codigo IS NOT NULL AND uf IS NOT NULL AND uf <> ''
)
SELECT DISTINCT ON (p.municipio_codigo, p.uf)
  p.municipio_codigo, p.uf, i.codigo, i.regiao
FROM pares p
JOIN core.dim_municipio m ON m.codigo = p.municipio_codigo
JOIN core.municipio_ibge i
  ON i.uf = p.uf
 AND core.normalize_text(i.nome) = core.normalize_text(m.descricao)
ORDER BY p.municipio_codigo, p.uf, i.codigo
ON CONFLICT (municipio_codigo, uf) DO NOTHING`;

const SQL_SOCIOS_COUNT = `
INSERT INTO core.socios_count (cnpj_base, socios_count)
SELECT cnpj_base, count(*)::int
FROM core.socios
GROUP BY 1
ON CONFLICT (cnpj_base) DO UPDATE SET socios_count = EXCLUDED.socios_count`;

const SQL_BUSCA = `
INSERT INTO read.estabelecimentos_busca (
  cnpj, cnpj_base, cnpj_ordem, cnpj_dv, matriz_filial, nome_fantasia,
  nome_fantasia_busca, situacao, data_situacao, motivo, data_inicio,
  cnae_principal, cnaes_secundarios, tipo_logradouro, logradouro, numero,
  complemento, bairro, cep, uf, municipio_codigo, municipio_ibge, regiao,
  ddd1, telefone1, ddd2, telefone2, email, situacao_especial,
  data_situacao_especial, snapshot, razao_social, razao_social_busca,
  natureza_juridica, qualificacao_responsavel, capital_social, porte,
  ente_federativo, socios_count, opcao_simples, opcao_mei, cnae_descricao,
  municipio_nome, natureza_descricao, porte_descricao, situacao_descricao,
  matriz_filial_descricao, idade_anos, is_ativa, is_mais_3_anos
)
SELECT
  e.cnpj, e.cnpj_base, e.cnpj_ordem, e.cnpj_dv, e.matriz_filial, e.nome_fantasia,
  e.nome_fantasia_busca, e.situacao, e.data_situacao, e.motivo, e.data_inicio,
  e.cnae_principal, e.cnaes_secundarios, e.tipo_logradouro, e.logradouro, e.numero,
  e.complemento, e.bairro, e.cep, e.uf, e.municipio_codigo, mi.municipio_ibge, mi.regiao,
  e.ddd1, e.telefone1, e.ddd2, e.telefone2, e.email, e.situacao_especial,
  e.data_situacao_especial, e.snapshot,
  coalesce(emp.razao_social, ''), coalesce(emp.razao_social_busca, ''),
  emp.natureza_juridica, emp.qualificacao_responsavel, emp.capital_social, emp.porte,
  emp.ente_federativo,
  coalesce(sc.socios_count, 0),
  coalesce(s.opcao_simples, 'N'), coalesce(s.opcao_mei, 'N'),
  c.descricao, m.descricao, n.descricao,
  CASE emp.porte
    WHEN '01' THEN 'Microempresa'
    WHEN '03' THEN 'Empresa de Pequeno Porte'
    WHEN '05' THEN 'Demais'
    ELSE 'Não informado'
  END,
  CASE e.situacao
    WHEN '01' THEN 'Nula'
    WHEN '02' THEN 'Ativa'
    WHEN '03' THEN 'Suspensa'
    WHEN '04' THEN 'Inapta'
    WHEN '08' THEN 'Baixada'
    ELSE 'Outra'
  END,
  CASE e.matriz_filial
    WHEN '1' THEN 'Matriz'
    WHEN '2' THEN 'Filial'
    ELSE 'Não informado'
  END,
  CASE
    WHEN e.data_inicio IS NULL THEN NULL
    ELSE extract(year from age(current_date, e.data_inicio))::int
  END,
  (e.situacao = '02'),
  coalesce(e.data_inicio <= (current_date - interval '3 years'), false)
FROM core.estabelecimentos e
LEFT JOIN core.empresas emp ON emp.cnpj_base = e.cnpj_base
LEFT JOIN core.simples s ON s.cnpj_base = e.cnpj_base
LEFT JOIN core.socios_count sc ON sc.cnpj_base = e.cnpj_base
LEFT JOIN core.dim_cnae c ON c.codigo = e.cnae_principal
LEFT JOIN core.dim_municipio m ON m.codigo = e.municipio_codigo
LEFT JOIN core.municipio_rfb_ibge mi
  ON mi.municipio_codigo = e.municipio_codigo
 AND mi.uf = e.uf
LEFT JOIN core.dim_natureza n ON n.codigo = emp.natureza_juridica`;

const SQL_REDE = `
INSERT INTO read.rede_contatos (cnpj_base, tipo, valor, rotulo)
WITH base AS (
  SELECT
    cnpj_base,
    lower(btrim(email)) AS email,
    ddd1,
    ddd2,
    telefone1,
    telefone2,
    regexp_replace(coalesce(ddd1, '') || coalesce(telefone1, ''), '[^0-9]', '', 'g') AS tel1,
    regexp_replace(coalesce(ddd2, '') || coalesce(telefone2, ''), '[^0-9]', '', 'g') AS tel2,
    regexp_replace(coalesce(cep, ''), '[^0-9]', '', 'g') AS cep,
    core.normalize_text(coalesce(logradouro, '')) AS logradouro_norm,
    core.normalize_text(coalesce(numero, '')) AS numero_norm,
    core.normalize_text(coalesce(complemento, '')) AS complemento_norm,
    btrim(concat_ws(' ', tipo_logradouro, logradouro, numero, complemento, bairro, cep)) AS endereco_rotulo,
    nome_fantasia,
    nome_fantasia_busca
  FROM core.estabelecimentos
),
emails AS (
  SELECT cnpj_base, 'email' AS tipo, email AS valor, min(email) AS rotulo
  FROM base
  WHERE email IS NOT NULL
    AND email <> ''
    AND email LIKE '%@%'
    AND email NOT IN ('0', '-', 'nao tem', 'nao possui', 'nenhum', 'sem email')
    AND email ~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$'
  GROUP BY 1, 2, 3
),
telefones AS (
  SELECT cnpj_base, 'telefone' AS tipo, tel1 AS valor,
         min(btrim(coalesce(ddd1, '') || ' ' || coalesce(telefone1, ''))) AS rotulo
  FROM base
  WHERE char_length(tel1) BETWEEN 10 AND 11
    AND tel1 NOT IN ('0000000000', '00000000000', '1111111111', '11111111111', '9999999999', '99999999999')
  GROUP BY 1, 2, 3
  UNION ALL
  SELECT cnpj_base, 'telefone' AS tipo, tel2 AS valor,
         min(btrim(coalesce(ddd2, '') || ' ' || coalesce(telefone2, ''))) AS rotulo
  FROM base
  WHERE char_length(tel2) BETWEEN 10 AND 11
    AND tel2 NOT IN ('0000000000', '00000000000', '1111111111', '11111111111', '9999999999', '99999999999')
  GROUP BY 1, 2, 3
),
enderecos AS (
  SELECT cnpj_base, 'endereco' AS tipo,
         logradouro_norm || '|' || numero_norm || '|' || complemento_norm || '|' || cep AS valor,
         min(endereco_rotulo) AS rotulo
  FROM base
  WHERE char_length(cep) = 8
    AND cep <> '00000000'
    AND numero_norm NOT IN ('', '0', 's n', 'sn', 's/n')
  GROUP BY 1, 2, 3
),
marcas AS (
  SELECT cnpj_base, 'marca' AS tipo, nome_fantasia_busca AS valor,
         min(btrim(nome_fantasia)) AS rotulo
  FROM base
  WHERE nome_fantasia_busca IS NOT NULL
    AND char_length(nome_fantasia_busca) >= 4
    AND nome_fantasia_busca NOT IN ('matriz', 'filial', 'loja', 'comercio', 'servicos', 'empresa', 'grupo')
  GROUP BY 1, 2, 3
)
SELECT * FROM emails
UNION ALL SELECT * FROM telefones
UNION ALL SELECT * FROM enderecos
UNION ALL SELECT * FROM marcas
ON CONFLICT DO NOTHING`;

interface IndexDef {
  drop: string;
  create: string;
}

/**
 * Índices derrubados antes da carga e recriados no fim.
 * Criar 70 milhões de linhas com todos os índices ativos é muito mais lento do
 * que carregar e indexar em bloco.
 */
const INDEXES: IndexDef[] = [
  { drop: 'core.ix_empresas_razao_busca', create: 'CREATE INDEX IF NOT EXISTS ix_empresas_razao_busca ON core.empresas (razao_social_busca)' },
  { drop: 'core.ix_empresas_natureza', create: 'CREATE INDEX IF NOT EXISTS ix_empresas_natureza ON core.empresas (natureza_juridica)' },
  { drop: 'core.ix_estabelecimentos_cnpj_base', create: 'CREATE INDEX IF NOT EXISTS ix_estabelecimentos_cnpj_base ON core.estabelecimentos (cnpj_base)' },
  { drop: 'core.ix_estabelecimentos_municipio', create: 'CREATE INDEX IF NOT EXISTS ix_estabelecimentos_municipio ON core.estabelecimentos (municipio_codigo)' },
  { drop: 'core.ix_estabelecimentos_cnae', create: 'CREATE INDEX IF NOT EXISTS ix_estabelecimentos_cnae ON core.estabelecimentos (cnae_principal)' },
  { drop: 'core.ix_estabelecimentos_inicio', create: 'CREATE INDEX IF NOT EXISTS ix_estabelecimentos_inicio ON core.estabelecimentos (data_inicio)' },
  { drop: 'core.ix_estabelecimentos_situacao', create: 'CREATE INDEX IF NOT EXISTS ix_estabelecimentos_situacao ON core.estabelecimentos (situacao)' },
  { drop: 'core.ix_estabelecimentos_email', create: "CREATE INDEX IF NOT EXISTS ix_estabelecimentos_email ON core.estabelecimentos (lower(email)) WHERE email IS NOT NULL AND email <> ''" },
  { drop: 'core.ix_socios_cnpj_base', create: 'CREATE INDEX IF NOT EXISTS ix_socios_cnpj_base ON core.socios (cnpj_base)' },
  { drop: 'core.ix_socios_cpf', create: 'CREATE INDEX IF NOT EXISTS ix_socios_cpf ON core.socios (cpf_cnpj_socio)' },
  { drop: 'core.ix_socios_nome', create: 'CREATE INDEX IF NOT EXISTS ix_socios_nome ON core.socios (nome_socio_busca)' },
  { drop: 'core.ix_municipio_ibge_uf', create: 'CREATE INDEX IF NOT EXISTS ix_municipio_ibge_uf ON core.municipio_ibge (uf)' },
  { drop: 'core.ix_municipio_ibge_nome', create: 'CREATE INDEX IF NOT EXISTS ix_municipio_ibge_nome ON core.municipio_ibge (core.normalize_text(nome))' },
  { drop: 'read.ix_busca_base', create: 'CREATE INDEX IF NOT EXISTS ix_busca_base ON read.estabelecimentos_busca (cnpj_base)' },
  { drop: 'read.ix_busca_uf', create: 'CREATE INDEX IF NOT EXISTS ix_busca_uf ON read.estabelecimentos_busca (uf)' },
  { drop: 'read.ix_busca_municipio_codigo', create: 'CREATE INDEX IF NOT EXISTS ix_busca_municipio_codigo ON read.estabelecimentos_busca (municipio_codigo)' },
  { drop: 'read.ix_busca_municipio_ibge', create: 'CREATE INDEX IF NOT EXISTS ix_busca_municipio_ibge ON read.estabelecimentos_busca (municipio_ibge)' },
  { drop: 'read.ix_busca_cnae', create: 'CREATE INDEX IF NOT EXISTS ix_busca_cnae ON read.estabelecimentos_busca (cnae_principal)' },
  { drop: 'read.ix_busca_situacao', create: 'CREATE INDEX IF NOT EXISTS ix_busca_situacao ON read.estabelecimentos_busca (situacao)' },
  { drop: 'read.ix_busca_inicio', create: 'CREATE INDEX IF NOT EXISTS ix_busca_inicio ON read.estabelecimentos_busca (data_inicio)' },
  { drop: 'read.ix_busca_socios', create: 'CREATE INDEX IF NOT EXISTS ix_busca_socios ON read.estabelecimentos_busca (socios_count)' },
  { drop: 'read.ix_busca_razao', create: 'CREATE INDEX IF NOT EXISTS ix_busca_razao ON read.estabelecimentos_busca (razao_social_busca)' },
  { drop: 'read.ix_rede_contatos_valor', create: 'CREATE INDEX IF NOT EXISTS ix_rede_contatos_valor ON read.rede_contatos (tipo, valor)' },
  { drop: 'read.ix_rede_contatos_base', create: 'CREATE INDEX IF NOT EXISTS ix_rede_contatos_base ON read.rede_contatos (cnpj_base)' },
];

const STAGING_DDL = [
  `CREATE TEMP TABLE IF NOT EXISTS stg_empresas (c0 text, c1 text, c2 text, c3 text, c4 text, c5 text, c6 text)`,
  `CREATE TEMP TABLE IF NOT EXISTS stg_estabelecimentos (
     c0 text, c1 text, c2 text, c3 text, c4 text, c5 text, c6 text, c7 text, c8 text, c9 text,
     c10 text, c11 text, c12 text, c13 text, c14 text, c15 text, c16 text, c17 text, c18 text,
     c19 text, c20 text, c21 text, c22 text, c23 text, c24 text, c25 text, c26 text, c27 text,
     c28 text, c29 text)`,
  `CREATE TEMP TABLE IF NOT EXISTS stg_socios (
     c0 text, c1 text, c2 text, c3 text, c4 text, c5 text, c6 text, c7 text, c8 text, c9 text, c10 text)`,
  `CREATE TEMP TABLE IF NOT EXISTS stg_simples (c0 text, c1 text, c2 text, c3 text, c4 text, c5 text, c6 text)`,
  `CREATE TEMP TABLE IF NOT EXISTS stg_dim (codigo text, descricao text)`,
  `CREATE TEMP TABLE IF NOT EXISTS stg_municipio_ibge (c0 text, c1 text, c2 text, c3 text, c4 text)`,
];

const STAGING_COLUMNS: Record<string, string[]> = {
  stg_empresas: ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6'],
  stg_estabelecimentos: Array.from({ length: 30 }, (_, i) => `c${i}`),
  stg_socios: Array.from({ length: 11 }, (_, i) => `c${i}`),
  stg_simples: Array.from({ length: 7 }, (_, i) => `c${i}`),
  stg_dim: ['codigo', 'descricao'],
  stg_municipio_ibge: ['c0', 'c1', 'c2', 'c3', 'c4'],
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function log(message: string): void {
  const stamp = new Date().toISOString().slice(11, 19);
  console.log(`[${stamp}] ${message}`);
}

function ms(started: number): string {
  return `${((Date.now() - started) / 1000).toFixed(1)}s`;
}

function existsWithData(file: string): boolean {
  try {
    return fs.statSync(file).size > 0;
  } catch {
    return false;
  }
}

function csvFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.csv'))
    .sort()
    .map((name) => path.join(dir, name))
    .filter(existsWithData);
}

function buildPaths(root: string): LoadPaths {
  const single = (name: string): string[] => {
    const file = path.join(root, name);
    return existsWithData(file) ? [file] : [];
  };

  return {
    empresas: csvFiles(path.join(root, 'empresas')).length
      ? csvFiles(path.join(root, 'empresas'))
      : single('empresas.csv'),
    estabelecimentos: csvFiles(path.join(root, 'estabelecimentos')).length
      ? csvFiles(path.join(root, 'estabelecimentos'))
      : single('estabelecimentos.csv'),
    socios: csvFiles(path.join(root, 'socios')).length
      ? csvFiles(path.join(root, 'socios'))
      : single('socios.csv'),
    simples: csvFiles(path.join(root, 'simples')).length
      ? csvFiles(path.join(root, 'simples'))
      : single('simples.csv'),
    dims: Object.keys(DIM_TABLES).map((key) => ({
      table: DIM_TABLES[key],
      file: path.join(root, `dim_${key}.csv`),
    })),
  };
}

async function copyCsv(client: Client, table: string, file: string, delimiter = ';'): Promise<void> {
  const columns = STAGING_COLUMNS[table];
  const sql = `COPY ${table} (${columns.join(', ')}) FROM STDIN WITH (FORMAT csv, DELIMITER '${delimiter}', QUOTE '"', ENCODING 'UTF8')`;
  await client.query(`TRUNCATE ${table}`);
  const copyStream = copyFrom(sql);
  const writable = client.query(copyStream as never) as unknown as NodeJS.WritableStream;
  await pipeline(fs.createReadStream(file), writable);
}

async function query(
  client: Client,
  sql: string,
  params: unknown[] = [],
): Promise<pg.QueryResult> {
  return client.query(sql, params);
}

async function count(client: Client, table: string): Promise<string> {
  const result = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`);
  return result.rows[0]?.n ?? '0';
}

async function alreadyLoaded(
  client: Client,
  snapshot: string,
  section: string,
  file: string,
): Promise<boolean> {
  const result = await client.query(
    'SELECT 1 FROM core.load_progress WHERE snapshot = $1 AND section = $2 AND file = $3',
    [snapshot, section, file],
  );
  return (result.rowCount ?? 0) > 0;
}

async function markLoaded(
  client: Client,
  snapshot: string,
  section: string,
  file: string,
): Promise<void> {
  await client.query(
    `INSERT INTO core.load_progress (snapshot, section, file) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [snapshot, section, file],
  );
}

/**
 * Carrega um CSV: COPY para a staging e INSERT dentro de uma transação.
 * A transação garante que um arquivo nunca fique pela metade se o processo
 * cair, e o progresso gravado permite retomar sem truncar o que já entrou.
 */
async function loadTableFile(options: {
  client: Client;
  snapshot: string;
  section: string;
  file: string;
  staging: string;
  sql: string;
  reset: boolean;
}): Promise<void> {
  const { client, snapshot, section, file, staging, sql, reset } = options;
  const name = path.basename(file);

  if (!reset && (await alreadyLoaded(client, snapshot, section, name))) {
    log(`[skip] ${section}/${name} (já carregado)`);
    return;
  }

  const started = Date.now();
  await copyCsv(client, staging, file);

  await query(client, 'BEGIN');
  try {
    const result = await query(client, sql, [snapshot]);
    await markLoaded(client, snapshot, section, name);
    await query(client, 'COMMIT');
    log(`${section} ${name} -> +${result.rowCount ?? 0} (${ms(started)})`);
  } catch (error) {
    await query(client, 'ROLLBACK');
    throw error;
  }
}

// ---------------------------------------------------------------------------
// carga
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useSample = args.includes('--sample');
  const skipMigrate = args.includes('--skip-migrate');
  const reset = args.includes('--reset');
  const snapshot = config.snapshot;
  const root = useSample
    ? path.join(config.dataDir, 'sample')
    : path.join(config.dataDir, 'extracted', snapshot);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL não configurada.');
    process.exit(1);
  }

  if (!fs.existsSync(root)) {
    console.error(`Diretório não encontrado: ${root}`);
    console.error(
      useSample
        ? 'Rode antes: npm run sample'
        : 'Rode antes: npm run prepare:snapshot',
    );
    process.exit(1);
  }

  log(`origem: ${root}`);
  log(`snapshot: ${snapshot}`);

  if (!skipMigrate) {
    await runMigrations({ connectionString, log });
  }

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 30_000,
    application_name: 'prospect-load',
  });
  await client.connect();
  log('conectado ao PostgreSQL');

  const paths = buildPaths(root);
  const missing = [
    ['empresas', paths.empresas.length],
    ['estabelecimentos', paths.estabelecimentos.length],
    ['socios', paths.socios.length],
    ['simples', paths.simples.length],
  ].filter(([, count]) => count === 0);
  if (missing.length) {
    log(`AVISO: sem arquivos para ${missing.map(([name]) => name).join(', ')}`);
  }

  try {
    await query(client, 'SET statement_timeout = 0');
    await query(client, 'SET synchronous_commit = off');
    await query(client, `SET maintenance_work_mem = '${process.env.PG_LOAD_MAINTENANCE_MEM ?? '512MB'}'`);
    await query(client, `SET work_mem = '${process.env.PG_LOAD_WORK_MEM ?? '128MB'}'`);

    const startedAll = Date.now();

    // 1. staging
    for (const statement of STAGING_DDL) await query(client, statement);
    log('tabelas temporárias criadas');

    // 2. limpeza e índices
    const progress = await client.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM core.load_progress WHERE snapshot = $1',
      [snapshot],
    );
    const loadedCount = Number(progress.rows[0]?.n ?? '0');
    const resume = loadedCount > 0 && !reset;

    if (resume) {
      log(`retomando: ${loadedCount} arquivo(s) já carregados; nada será truncado`);
      await query(client, 'TRUNCATE read.estabelecimentos_busca, read.rede_contatos');
    } else {
      log('limpando tabelas de destino');
      await query(
        client,
        `TRUNCATE core.estabelecimentos, core.empresas, core.socios, core.simples,
                 core.dim_cnae, core.dim_municipio, core.dim_natureza,
                 core.dim_qualificacao, core.dim_motivo, core.dim_pais,
                 core.municipio_ibge, core.municipio_rfb_ibge, core.socios_count,
                 read.estabelecimentos_busca, read.rede_contatos
         RESTART IDENTITY`,
      );
      await query(client, 'DELETE FROM core.load_progress WHERE snapshot = $1', [snapshot]);
    }

    log('removendo índices para acelerar a carga');
    for (const index of INDEXES) await query(client, `DROP INDEX IF EXISTS ${index.drop}`);

    // 3. dimensões
    for (const dim of paths.dims) {
      if (!existsWithData(dim.file)) {
        log(`AVISO: dimensão ausente: ${dim.file}`);
        continue;
      }
      const started = Date.now();
      await copyCsv(client, 'stg_dim', dim.file);
      await query(
        client,
        `INSERT INTO ${dim.table} (codigo, descricao)
         SELECT nullif(btrim(codigo), ''), max(nullif(btrim(descricao), ''))
         FROM stg_dim
         WHERE btrim(codigo) <> ''
         GROUP BY 1
         ON CONFLICT (codigo) DO UPDATE SET descricao = EXCLUDED.descricao`,
      );
      log(`${dim.table} (${ms(started)})`);
    }

    // 4. municípios IBGE (arquivo local, vírgula e cabeçalho)
    const ibgeFile = path.join(config.publicDir, 'geo', 'municipios_ibge.csv');
    if (existsWithData(ibgeFile)) {
      const started = Date.now();
      await query(client, 'TRUNCATE stg_municipio_ibge');
      const copySql = `COPY stg_municipio_ibge (c0, c1, c2, c3, c4) FROM STDIN WITH (FORMAT csv, HEADER true, DELIMITER ',', QUOTE '"', ENCODING 'UTF8')`;
      const copyStream = copyFrom(copySql);
      const writable = client.query(copyStream as never) as unknown as NodeJS.WritableStream;
      await pipeline(fs.createReadStream(ibgeFile), writable);
      await query(client, SQL_MUNICIPIO_IBGE);
      log(`core.municipio_ibge (${ms(started)})`);
    } else {
      log('AVISO: public/geo/municipios_ibge.csv ausente; mapa ficará sem município IBGE');
    }

    // 5. empresas
    for (const file of paths.empresas) {
      await loadTableFile({
        client,
        snapshot,
        section: 'empresas',
        file,
        staging: 'stg_empresas',
        sql: SQL_EMPRESAS,
        reset,
      });
    }

    // 6. estabelecimentos
    for (const file of paths.estabelecimentos) {
      await loadTableFile({
        client,
        snapshot,
        section: 'estabelecimentos',
        file,
        staging: 'stg_estabelecimentos',
        sql: SQL_ESTABELECIMENTOS,
        reset,
      });
    }

    // 7. sócios
    for (const file of paths.socios) {
      await loadTableFile({
        client,
        snapshot,
        section: 'socios',
        file,
        staging: 'stg_socios',
        sql: SQL_SOCIOS,
        reset,
      });
    }

    // 8. simples
    for (const file of paths.simples) {
      await loadTableFile({
        client,
        snapshot,
        section: 'simples',
        file,
        staging: 'stg_simples',
        sql: SQL_SIMPLES,
        reset,
      });
    }

    // 9. de-para RFB -> IBGE e contagem de sócios
    let started = Date.now();
    await query(client, SQL_MUNICIPIO_DE_PARA);
    log(`core.municipio_rfb_ibge -> ${await count(client, 'core.municipio_rfb_ibge')} (${ms(started)})`);

    started = Date.now();
    await query(client, SQL_SOCIOS_COUNT);
    log(`core.socios_count (${ms(started)})`);

    // 10. modelo de leitura
    started = Date.now();
    log('montando read.estabelecimentos_busca (pode levar bastante tempo)');
    await query(client, SQL_BUSCA);
    log(`read.estabelecimentos_busca -> ${await count(client, 'read.estabelecimentos_busca')} (${ms(started)})`);

    started = Date.now();
    log('montando read.rede_contatos');
    await query(client, SQL_REDE);
    log(`read.rede_contatos -> ${await count(client, 'read.rede_contatos')} (${ms(started)})`);

    // 11. índices
    started = Date.now();
    log(`criando ${INDEXES.length} índices`);
    for (const index of INDEXES) {
      const indexStarted = Date.now();
      await query(client, index.create);
      log(`  ${index.drop.split('.').pop()} (${ms(indexStarted)})`);
    }
    log(`índices concluídos (${ms(started)})`);

    // 12. estatísticas e metadados
    log('ANALYZE');
    await query(client, 'ANALYZE');

    const counts = {
      empresas: await count(client, 'core.empresas'),
      estabelecimentos: await count(client, 'core.estabelecimentos'),
      socios: await count(client, 'core.socios'),
      simples: await count(client, 'core.simples'),
      estabelecimentos_busca: await count(client, 'read.estabelecimentos_busca'),
      rede_contatos: await count(client, 'read.rede_contatos'),
      municipios_rfb_ibge: await count(client, 'core.municipio_rfb_ibge'),
    };

    const meta: Array<[string, string]> = [
      ['snapshot', snapshot],
      ['generated_at', new Date().toISOString()],
      ['source', config.sourceBase],
      ['sample', String(useSample)],
      ['origin', root],
      ...Object.entries(counts),
    ];
    for (const [key, value] of meta) {
      await query(
        client,
        `INSERT INTO core.meta (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, value],
      );
    }

    await query(
      client,
      `INSERT INTO history.snapshots (snapshot, source, downloaded_at, rows_empresas, rows_estabelecimentos, rows_socios, rows_simples, notes)
       VALUES ($1, $2, now(), $3, $4, $5, $6, $7)
       ON CONFLICT (snapshot) DO UPDATE SET
         source = EXCLUDED.source,
         downloaded_at = EXCLUDED.downloaded_at,
         rows_empresas = EXCLUDED.rows_empresas,
         rows_estabelecimentos = EXCLUDED.rows_estabelecimentos,
         rows_socios = EXCLUDED.rows_socios,
         rows_simples = EXCLUDED.rows_simples,
         notes = EXCLUDED.notes`,
      [
        snapshot,
        config.sourceBase,
        counts.empresas,
        counts.estabelecimentos,
        counts.socios,
        counts.simples,
        useSample ? 'amostra (não é o Brasil)' : 'snapshot completo',
      ],
    );

    log('concluído');
    console.log(counts);
    log(`tempo total: ${ms(startedAll)}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[load] falha:', error instanceof Error ? error.message : error);
  process.exit(1);
});
