import fs from 'node:fs';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { config } from '../config.js';
import { closeDatabase, exec, openDatabase, queryOne } from '../db/duckdb.js';
import {
  EMPTY_EMPRESAS_SQL,
  EMPTY_ESTABELECIMENTOS_SQL,
  EMPTY_SIMPLES_SQL,
  EMPTY_SOCIOS_SQL,
  INDEX_SQL,
  MACRO_SQL,
  META_TABLE_SQL,
  MUNICIPIO_IBGE_SQL,
  SEARCH_TABLE_SQL,
  dimSql,
  empresasSql,
  estabelecimentosSql,
  ibgeMunicipiosSql,
  simplesSql,
  sociosSql,
} from '../db/schema.js';

export interface LoadPaths {
  empresas: string;
  estabelecimentos: string;
  socios: string;
  simples: string;
  dims: {
    cnae: string;
    municipio: string;
    natureza: string;
    qualificacao: string;
    motivo: string;
    pais: string;
  };
}

function hasData(fileOrGlob: string): boolean {
  if (!fileOrGlob.includes('*')) {
    try {
      return fs.statSync(fileOrGlob).size > 0;
    } catch {
      return false;
    }
  }

  const dir = path.dirname(fileOrGlob);
  try {
    return fs
      .readdirSync(dir)
      .some(
        (file) =>
          file.toLowerCase().endsWith('.csv') &&
          fs.statSync(path.join(dir, file)).size > 0,
      );
  } catch {
    return false;
  }
}

async function insertMeta(key: string, value: string): Promise<void> {
  await exec('INSERT INTO meta VALUES ($key, $value)', { key, value });
}

async function loadWithPaths(
  paths: LoadPaths,
  snapshot: string,
  reset: boolean,
  sampleMeta: Record<string, unknown>,
): Promise<void> {
  const started = Date.now();

  if (reset) {
    for (const suffix of ['', '.wal', '.tmp']) {
      await rm(`${config.dbPath}${suffix}`, { force: true });
    }
  }

  await openDatabase({ readOnly: false });
  console.log(`[db] ${config.dbPath}`);
  console.log(`[db] threads=${config.threads} memory_limit=${config.memoryLimit}`);

  await exec('SET preserve_insertion_order = false');
  for (const statement of MACRO_SQL) await exec(statement);

  const dims: Array<[string, string]> = [
    ['dim_cnae', paths.dims.cnae],
    ['dim_municipio', paths.dims.municipio],
    ['dim_natureza', paths.dims.natureza],
    ['dim_qualificacao', paths.dims.qualificacao],
    ['dim_motivo', paths.dims.motivo],
    ['dim_pais', paths.dims.pais],
  ];

  for (const [table, file] of dims) {
    if (!hasData(file)) throw new Error(`Arquivo de domínio ausente/vazio: ${file}`);
    console.log(`[load] ${table}`);
    await exec(dimSql(table, file));
  }

  if (hasData(paths.empresas)) {
    console.log('[load] empresas');
    await exec(empresasSql(paths.empresas, snapshot));
  } else {
    console.warn('[load] empresas vazio; criando tabela vazia');
    await exec(EMPTY_EMPRESAS_SQL);
  }

  if (hasData(paths.estabelecimentos)) {
    console.log('[load] estabelecimentos');
    await exec(estabelecimentosSql(paths.estabelecimentos, snapshot));
  } else {
    console.warn('[load] estabelecimentos vazio; criando tabela vazia');
    await exec(EMPTY_ESTABELECIMENTOS_SQL);
  }

  console.log('[geo] municípios IBGE e de-para RFB');
  await exec(ibgeMunicipiosSql(path.resolve('public/geo/municipios_ibge.csv')));
  await exec(MUNICIPIO_IBGE_SQL);

  if (hasData(paths.socios)) {
    console.log('[load] socios');
    await exec(sociosSql(paths.socios, snapshot));
  } else {
    console.warn('[load] socios vazio; criando tabela vazia');
    await exec(EMPTY_SOCIOS_SQL);
  }

  if (hasData(paths.simples)) {
    console.log('[load] simples');
    await exec(simplesSql(paths.simples, snapshot));
  } else {
    console.warn('[load] simples ausente; criando tabela vazia');
    await exec(EMPTY_SIMPLES_SQL);
  }

  console.log('[build] estabelecimentos_busca');
  await exec(SEARCH_TABLE_SQL);

  console.log('[index] criando índices');
  for (const statement of INDEX_SQL) await exec(statement);

  try {
    await exec('ANALYZE');
  } catch (error) {
    console.warn('[analyze] ignorado:', (error as Error).message);
  }

  await exec(META_TABLE_SQL);

  const counts = await queryOne<Record<string, unknown>>(`
    SELECT
      (SELECT count(*) FROM empresas) AS empresas,
      (SELECT count(*) FROM estabelecimentos) AS estabelecimentos,
      (SELECT count(*) FROM socios) AS socios,
      (SELECT count(*) FROM simples) AS simples,
      (SELECT count(*) FROM estabelecimentos_busca) AS estabelecimentos_busca,
      (SELECT count(*) FROM dim_municipio_ibge) AS municipios_mapeados,
      (SELECT count(*) FROM (
        SELECT DISTINCT municipio_codigo, uf
        FROM estabelecimentos
        WHERE municipio_codigo IS NOT NULL AND uf IS NOT NULL AND uf <> ''
      )) AS municipios_rfb
  `);

  await insertMeta('snapshot', snapshot);
  await insertMeta('generated_at', new Date().toISOString());
  await insertMeta('source', config.sourceBase);
  await insertMeta('sample', String(Boolean(sampleMeta.snapshot)));
  for (const [key, value] of Object.entries(sampleMeta)) {
    if (key !== 'generated_at') await insertMeta(`sample_${key}`, String(value));
  }
  for (const [key, value] of Object.entries(counts ?? {})) {
    await insertMeta(key, String(value));
  }

  await exec('CHECKPOINT');
  await closeDatabase();

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log('\n[ok] banco carregado em', `${elapsed}s`);
  console.log(counts);
}

export async function loadFromCsvDir(options: {
  dir: string;
  snapshot: string;
  reset?: boolean;
}): Promise<void> {
  const { dir, snapshot, reset = true } = options;
  const metaFile = path.join(dir, 'meta.json');
  const sampleMeta = fs.existsSync(metaFile)
    ? (JSON.parse(fs.readFileSync(metaFile, 'utf8')) as Record<string, unknown>)
    : {};

  await loadWithPaths(
    {
      empresas: path.join(dir, 'empresas.csv'),
      estabelecimentos: path.join(dir, 'estabelecimentos.csv'),
      socios: path.join(dir, 'socios.csv'),
      simples: path.join(dir, 'simples.csv'),
      dims: {
        cnae: path.join(dir, 'dim_cnae.csv'),
        municipio: path.join(dir, 'dim_municipio.csv'),
        natureza: path.join(dir, 'dim_natureza.csv'),
        qualificacao: path.join(dir, 'dim_qualificacao.csv'),
        motivo: path.join(dir, 'dim_motivo.csv'),
        pais: path.join(dir, 'dim_pais.csv'),
      },
    },
    snapshot,
    reset,
    sampleMeta,
  );
}

export async function loadFromSnapshotDir(options: {
  dir: string;
  snapshot: string;
  reset?: boolean;
}): Promise<void> {
  const { dir, snapshot, reset = true } = options;
  await loadWithPaths(
    {
      empresas: path.join(dir, 'empresas', '*.csv'),
      estabelecimentos: path.join(dir, 'estabelecimentos', '*.csv'),
      socios: path.join(dir, 'socios', '*.csv'),
      simples: path.join(dir, 'simples', '*.csv'),
      dims: {
        cnae: path.join(dir, 'dim_cnae.csv'),
        municipio: path.join(dir, 'dim_municipio.csv'),
        natureza: path.join(dir, 'dim_natureza.csv'),
        qualificacao: path.join(dir, 'dim_qualificacao.csv'),
        motivo: path.join(dir, 'dim_motivo.csv'),
        pais: path.join(dir, 'dim_pais.csv'),
      },
    },
    snapshot,
    reset,
    {},
  );
}

export async function loadSample(): Promise<void> {
  await loadFromCsvDir({
    dir: path.join(config.dataDir, 'sample'),
    snapshot: config.snapshot,
    reset: true,
  });
}
