import 'dotenv/config';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat, truncate } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';
import { extractZip } from '../ingest/extract.js';

/**
 * Materializa os ZIPs do Supabase Storage e roda o loader do Postgres.
 *
 * Roda no servidor, dentro da rede do Supabase (ou com DATABASE_URL acessível):
 *   1. lê <SNAPSHOT>/manifest.json;
 *   2. baixa as partes, concatena em /data/raw/<snapshot>/<arquivo>.zip;
 *   3. extrai/transcodifica para /data/extracted/<snapshot>/;
 *   4. executa dist/src/db/loadSnapshot.js (COPY + core/read + índices).
 *
 * Uso:
 *   DATABASE_URL=postgres://postgres:senha@db:5432/postgres \
 *   SUPABASE_URL=https://... \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   SNAPSHOT=2026-10 \
 *   node dist/src/tools/loadFromStorage.js
 *
 * Opcionais:
 *   LOAD_ONLY=Cnaes.zip,Motivos.zip   # só alguns arquivos
 *   LOAD_SKIP_DB=true                 # baixa/extrai sem rodar o Postgres
 *   LOAD_KEEP_ZIP=true                # não apaga o ZIP após extrair
 */

const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const BUCKET = process.env.SUPABASE_BUCKET ?? 'cnpj-raw';
const SNAPSHOT = process.env.SNAPSHOT ?? config.snapshot;
const ONLY = (process.env.LOAD_ONLY ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const SKIP_DB = process.env.LOAD_SKIP_DB === 'true';
const KEEP_ZIP = process.env.LOAD_KEEP_ZIP === 'true';

interface ManifestEntry {
  name: string;
  bytes: number;
  chunk_size: number;
  parts: number;
  sha256: string | null;
}

interface Manifest {
  snapshot: string;
  files: ManifestEntry[];
}

function log(message: string): void {
  const stamp = new Date().toISOString().slice(11, 19);
  console.log(`[${stamp}] ${message}`);
}

function fail(message: string): never {
  throw new Error(message);
}

function headers(): Record<string, string> {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
  };
}

async function readManifest(): Promise<Manifest> {
  if (!SUPABASE_URL) fail('SUPABASE_URL não configurada');
  if (!SERVICE_KEY) fail('SUPABASE_SERVICE_ROLE_KEY não configurada');

  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/authenticated/${BUCKET}/${SNAPSHOT}/manifest.json`,
    { headers: headers(), signal: AbortSignal.timeout(60_000) },
  );
  if (!response.ok) {
    fail(`manifest: ${response.status} ${(await response.text()).slice(0, 300)}`);
  }
  return (await response.json()) as Manifest;
}

async function partSize(entry: ManifestEntry, index: number): Promise<number> {
  if (index < entry.parts - 1) return entry.chunk_size;
  return entry.bytes - (entry.parts - 1) * entry.chunk_size;
}

async function downloadParts(entry: ManifestEntry, dest: string): Promise<void> {
  const current = await stat(dest).catch(() => null);
  if (current?.size === entry.bytes) {
    log(`[skip] ${entry.name} já baixado (${entry.bytes} bytes)`);
    return;
  }
  await rm(dest, { force: true });

  let written = 0;
  for (let index = 0; index < entry.parts; index++) {
    const part = `part-${String(index).padStart(5, '0')}`;
    const expected = await partSize(entry, index);
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const response = await fetch(
          `${SUPABASE_URL}/storage/v1/object/authenticated/${BUCKET}/${SNAPSHOT}/_parts/${entry.name}/${part}`,
          { headers: headers(), signal: AbortSignal.timeout(10 * 60_000) },
        );
        if (!response.ok || !response.body) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        const handle = createWriteStream(dest, { flags: written === 0 ? 'w' : 'a' });
        await pipeline(Readable.fromWeb(response.body as never), handle);
        const size = (await stat(dest)).size;
        if (size !== written + expected) {
          throw new Error(`tamanho ${size}, esperado ${written + expected}`);
        }
        written = size;
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        await truncate(dest, written).catch(() => undefined);
        log(`[erro] ${entry.name} ${part} tentativa ${attempt}/5: ${(error as Error).message}`);
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      }
    }

    if (lastError) throw lastError;
    if (index % 10 === 9) log(`  ${entry.name}: ${written}/${entry.bytes} bytes`);
  }

  if (written !== entry.bytes) {
    fail(`${entry.name}: baixados ${written} de ${entry.bytes} bytes`);
  }
  log(`[ok] ${entry.name} baixado (${written} bytes)`);
}

async function runLoader(): Promise<void> {
  if (SKIP_DB) {
    log('[skip] LOAD_SKIP_DB=true: não executando o Postgres');
    return;
  }
  if (!process.env.DATABASE_URL) {
    fail('DATABASE_URL não configurada (use LOAD_SKIP_DB=true para só extrair)');
  }

  log('[db] executando dist/src/db/loadSnapshot.js');
  const child = spawn(process.execPath, ['dist/src/db/loadSnapshot.js'], {
    cwd: process.cwd(),
    env: { ...process.env, DATA_DIR: config.dataDir, SNAPSHOT },
    stdio: 'inherit',
  });

  const code = await new Promise<number | null>((resolve) => {
    child.on('close', (value) => resolve(value));
  });
  if (code !== 0) fail(`loader terminou com código ${code}`);
}

async function main(): Promise<void> {
  const manifest = await readManifest();
  if (manifest.snapshot !== SNAPSHOT) {
    log(`[aviso] manifesto é de ${manifest.snapshot}; usando SNAPSHOT=${SNAPSHOT}`);
  }

  let files = manifest.files;
  if (ONLY.length > 0) files = files.filter((file) => ONLY.includes(file.name));
  if (files.length === 0) fail('nenhum arquivo selecionado no manifesto');

  const rawRoot = path.join(config.dataDir, 'raw', SNAPSHOT);
  const outRoot = path.join(config.dataDir, 'extracted', SNAPSHOT);
  await mkdir(rawRoot, { recursive: true });
  await mkdir(outRoot, { recursive: true });

  log(`bucket=${BUCKET} snapshot=${SNAPSHOT} arquivos=${files.length}`);
  log(`destino: ${outRoot}`);

  for (const [index, entry] of files.entries()) {
    log(`[${index + 1}/${files.length}] ${entry.name} (${entry.bytes} bytes, ${entry.parts} partes)`);
    const zipPath = path.join(rawRoot, entry.name);
    await downloadParts(entry, zipPath);
    await extractZip(zipPath, outRoot, SNAPSHOT, false);
    if (!KEEP_ZIP) {
      await rm(zipPath, { force: true });
      log(`[rm] ${entry.name}`);
    }
  }

  await runLoader();
  log('concluído');
}

main().catch((error) => {
  console.error(`[load-storage] falhou: ${(error as Error).message}`);
  process.exit(1);
});
