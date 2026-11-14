import 'dotenv/config';
import path from 'node:path';

function intFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const dbPath = path.resolve(process.env.DUCKDB_PATH ?? 'data/cnpj.duckdb');

export const config = {
  port: intFromEnv('PORT', 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath,
  dataDir: path.resolve(process.env.DATA_DIR ?? 'data'),
  tempDirectory: path.resolve(
    process.env.DUCKDB_TEMP_DIR ?? path.join(path.dirname(dbPath), 'tmp'),
  ),
  memoryLimit: process.env.MEMORY_LIMIT ?? '8GB',
  threads: intFromEnv('THREADS', 8),
  sourceBase:
    process.env.SOURCE_BASE ??
    'https://arquivos.receitafederal.gov.br/public.php/webdav',
  sourceToken: process.env.SOURCE_TOKEN ?? 'YggdBLfdninEJX9',
  snapshot: process.env.SNAPSHOT ?? '2026-10',
  sampleLines: intFromEnv('SAMPLE_LINES', 50_000),
  sampleShard: intFromEnv('SAMPLE_SHARD', 1),
  sampleIncludeSimples: process.env.SAMPLE_INCLUDE_SIMPLES !== 'false',
  maxPageSize: 200,
  defaultPageSize: 50,
  exportLimit: 50_000,
} as const;
