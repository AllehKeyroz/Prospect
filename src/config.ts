import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function intFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// Resolve um diretório de assets pelo cwd e, se o processo tiver sido iniciado
// de outro diretório (algumas plataformas mudam o WORKDIR), pela localização
// do módulo. Sem isso, `public/` ausente derruba o Fastify no boot.
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function resolveAssetDir(name: string, marker: string): string {
  const candidates = [
    path.resolve(name),
    path.resolve(moduleDir, '..', name),
    path.resolve(moduleDir, '..', '..', name),
  ];
  return candidates.find((dir) => fs.existsSync(path.join(dir, marker))) ?? candidates[0];
}

// DATA_DIR é a raiz persistente (no Docker: /data, montado como volume).
// Os caminhos derivam dela para que o app nunca grave fora do volume só porque
// DUCKDB_PATH não foi definido. Variáveis explícitas continuam tendo prioridade.
const dataDir = path.resolve(process.env.DATA_DIR ?? 'data');
const dbPath = path.resolve(process.env.DUCKDB_PATH ?? path.join(dataDir, 'cnpj.duckdb'));

export const config = {
  port: intFromEnv('PORT', 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath,
  appDbPath: path.resolve(process.env.APP_DB_PATH ?? path.join(dataDir, 'app.duckdb')),
  dataDir,
  publicDir: resolveAssetDir('public', 'index.html'),
  docsDir: resolveAssetDir('docs', 'source_manifest.json'),
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
