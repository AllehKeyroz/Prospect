import 'dotenv/config';
import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * Sincroniza os ZIPs do snapshot da Receita para o Supabase Storage.
 *
 * Feito para rodar NO SERVIDOR (container da app ou terminal do EasyPanel):
 * baixa direto da Receita e envia em partes menores que o limite do Storage
 * (50 MB por objeto no self-hosted padrão). Não passa pela máquina do usuário.
 *
 * Uso:
 *   SUPABASE_URL=https://... \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   SUPABASE_BUCKET=cnpj-raw \
 *   SNAPSHOT=2026-10 \
 *   node dist/src/tools/syncStorage.js
 *
 * Variáveis opcionais:
 *   SYNC_ONLY=Cnaes.zip,Empresas1.zip   # só alguns arquivos
 *   SYNC_CHUNK_MB=40                    # 5..49 (limite do Storage é 50 MB)
 *   SYNC_FORCE=true                     # reenvia mesmo se o manifesto existir
 */

const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const BUCKET = process.env.SUPABASE_BUCKET ?? 'cnpj-raw';
const SNAPSHOT = process.env.SNAPSHOT ?? config.snapshot;
const CHUNK_MB = Math.min(49, Math.max(5, Number(process.env.SYNC_CHUNK_MB ?? 40) || 40));
const CHUNK_SIZE = CHUNK_MB * 1024 * 1024;
const ONLY = (process.env.SYNC_ONLY ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const FORCE = process.env.SYNC_FORCE === 'true';
const MAX_ATTEMPTS = Math.max(1, Number(process.env.SYNC_MAX_ATTEMPTS ?? 30) || 30);
const PART_DELAY_MS = Math.max(0, Number(process.env.SYNC_PART_DELAY_MS ?? 200) || 0);

const AUTH_RFB = `Basic ${Buffer.from(`${config.sourceToken}:`).toString('base64')}`;

interface SourceFile {
  name: string;
  bytes: number;
}

interface ManifestEntry {
  name: string;
  bytes: number;
  chunk_size: number;
  parts: number;
  sha256: string | null;
  source: string;
  synced_at: string;
}

function log(message: string): void {
  const stamp = new Date().toISOString().slice(11, 19);
  console.log(`[${stamp}] ${message}`);
}

function fail(message: string): never {
  throw new Error(message);
}

function requireConfig(): void {
  if (!SUPABASE_URL) fail('SUPABASE_URL não configurada');
  if (!SERVICE_KEY) fail('SUPABASE_SERVICE_ROLE_KEY não configurada');
  if (!BUCKET) fail('SUPABASE_BUCKET não configurada');
}

function storageHeaders(contentType?: string): Record<string, string> {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    ...(contentType ? { 'Content-Type': contentType } : {}),
  };
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`resposta não-JSON (${response.status}): ${text.slice(0, 300)}`);
  }
}

/** Lista os ZIPs do snapshot via WebDAV e seus tamanhos. */
async function listSourceFiles(): Promise<SourceFile[]> {
  const url = `${config.sourceBase}/${SNAPSHOT}/`;
  const response = await fetch(url, {
    method: 'PROPFIND',
    headers: { Authorization: AUTH_RFB, Depth: '1' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    fail(`PROPFIND ${url} falhou: ${response.status} ${response.statusText}`);
  }
  const xml = await response.text();
  const files: SourceFile[] = [];

  for (const block of xml.split(/<[a-z]*:?response>/i).slice(1)) {
    const href = /<[a-z]*:?href>([^<]+)<\/[a-z]*:?href>/i.exec(block)?.[1];
    const size = /<[a-z]*:?getcontentlength>(\d+)<\/[a-z]*:?getcontentlength>/i.exec(block)?.[1];
    if (!href) continue;
    const name = decodeURIComponent(href.split('/').filter(Boolean).pop() ?? '');
    if (!name.toLowerCase().endsWith('.zip')) continue;
    files.push({ name, bytes: Number(size ?? 0) });
  }

  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}

async function readManifest(): Promise<Map<string, ManifestEntry>> {
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/authenticated/${BUCKET}/${SNAPSHOT}/manifest.json`,
    { headers: storageHeaders(), signal: AbortSignal.timeout(30_000) },
  );
  if (response.status === 404 || response.status === 400) return new Map();
  if (!response.ok) {
    throw new Error(`manifest: ${response.status} ${await response.text()}`);
  }
  const data = await readJson<{ files?: ManifestEntry[] }>(response);
  return new Map((data.files ?? []).map((entry) => [entry.name, entry]));
}

async function writeManifest(entries: Map<string, ManifestEntry>): Promise<void> {
  const body = JSON.stringify(
    {
      snapshot: SNAPSHOT,
      source: config.sourceBase,
      updated_at: new Date().toISOString(),
      chunk_size: CHUNK_SIZE,
      files: [...entries.values()].sort((a, b) => a.name.localeCompare(b.name)),
    },
    null,
    2,
  );
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${SNAPSHOT}/manifest.json`,
    {
      method: 'POST',
      headers: { ...storageHeaders('application/json'), 'x-upsert': 'true' },
      body,
    },
  );
  if (!response.ok) fail(`manifest upload: ${response.status} ${await response.text()}`);
}

/** Partes já enviadas para um arquivo (nome -> tamanho). */
async function listParts(name: string): Promise<Map<string, number>> {
  const existing = new Map<string, number>();
  let offset = 0;

  for (;;) {
    const response = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: storageHeaders('application/json'),
      body: JSON.stringify({
        prefix: `${SNAPSHOT}/_parts/${name}/`,
        limit: 1000,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) fail(`list parts: ${response.status} ${await response.text()}`);
    const rows = await readJson<Array<{ name: string; metadata?: { size?: number } }>>(response);
    for (const row of rows) existing.set(row.name, Number(row.metadata?.size ?? 0));
    if (rows.length < 1000) break;
    offset += rows.length;
  }

  return existing;
}

async function uploadPart(name: string, index: number, body: Buffer): Promise<void> {
  const part = `part-${String(index).padStart(5, '0')}`;
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${SNAPSHOT}/_parts/${name}/${part}`,
    {
      method: 'POST',
      headers: { ...storageHeaders('application/octet-stream'), 'x-upsert': 'true' },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(5 * 60_000),
    },
  );
  if (!response.ok) {
    throw new Error(`parte ${part}: ${response.status} ${(await response.text()).slice(0, 300)}`);
  }
  if (PART_DELAY_MS > 0) {
    await new Promise((resolve) => setTimeout(resolve, PART_DELAY_MS));
  }
}

async function deletePart(name: string, index: number): Promise<void> {
  const part = `part-${String(index).padStart(5, '0')}`;
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${SNAPSHOT}/_parts/${name}/${part}`,
    { method: 'DELETE', headers: storageHeaders(), signal: AbortSignal.timeout(30_000) },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`remover ${part}: ${response.status} ${(await response.text()).slice(0, 300)}`);
  }
}

/** Remove partes antigas quando o arquivo encolheu ou o chunk mudou. */
async function cleanupParts(name: string, keep: number): Promise<void> {
  const existing = await listParts(name);
  for (const key of existing.keys()) {
    const match = /^part-(\d+)$/.exec(key);
    if (!match) continue;
    const index = Number(match[1]);
    if (index >= keep) await deletePart(name, index);
  }
}

function contiguousBytes(existing: Map<string, number>, total: number): number {
  let offset = 0;
  for (let index = 0; offset < total; index++) {
    const size = existing.get(`part-${String(index).padStart(5, '0')}`);
    if (!size) break;
    offset += size;
  }
  return Math.min(offset, total);
}

/**
 * Baixa da Receita em streaming e envia em partes. Se cair, retoma do último
 * byte contíguo já enviado (Range) sem baixar o arquivo inteiro de novo.
 */
async function syncFile(file: SourceFile, manifest: Map<string, ManifestEntry>): Promise<void> {
  const previous = manifest.get(file.name);
  if (!FORCE && previous && previous.bytes === file.bytes) {
    log(`[skip] ${file.name} já sincronizado (${file.bytes} bytes)`);
    return;
  }

  const existing = await listParts(file.name);
  let uploaded = contiguousBytes(existing, file.bytes);
  if (uploaded > 0 && uploaded < file.bytes) {
    log(`[resume] ${file.name} a partir de ${uploaded} bytes`);
  }

  let hash = uploaded === 0 ? crypto.createHash('sha256') : null;
  let partIndex = 0;
  let offset = 0;
  for (;;) {
    const part = `part-${String(partIndex).padStart(5, '0')}`;
    const size = existing.get(part);
    if (!size) break;
    offset += size;
    partIndex += 1;
  }
  uploaded = offset;

  const response = await fetch(`${config.sourceBase}/${SNAPSHOT}/${encodeURIComponent(file.name)}`, {
    headers: {
      Authorization: AUTH_RFB,
      'Accept-Encoding': 'identity',
      ...(uploaded > 0 ? { Range: `bytes=${uploaded}-` } : {}),
    },
    signal: AbortSignal.timeout(3 * 60 * 60_000),
  });

  let resume = response.status === 206;
  if (!response.ok && response.status !== 416) {
    fail(`download ${file.name}: ${response.status} ${response.statusText}`);
  }
  if (response.status === 200 && uploaded > 0) {
    log(`[aviso] servidor ignorou Range; recomeçando ${file.name}`);
    resume = false;
    uploaded = 0;
    partIndex = 0;
    hash = crypto.createHash('sha256');
  }
  if (response.status === 416) {
    log(`[skip] ${file.name} já completo`);
  }

  if (response.body && response.status !== 416) {
    const chunks: Buffer[] = [];
    let buffered = 0;

    const flush = async (): Promise<void> => {
      if (buffered === 0) return;
      const buffer = Buffer.concat(chunks, buffered);
      if (buffer.length > 49 * 1024 * 1024) fail(`parte maior que 49 MB: ${file.name}`);
      hash?.update(buffer);
      await uploadPart(file.name, partIndex, buffer);
      offset += buffer.length;
      partIndex += 1;
      buffered = 0;
      chunks.length = 0;
      if (partIndex % 10 === 0) log(`  ${file.name}: ${offset}/${file.bytes} bytes`);
    };

    for await (const chunk of response.body as unknown as AsyncIterable<Buffer>) {
      chunks.push(Buffer.from(chunk));
      buffered += chunk.length;
      while (buffered >= CHUNK_SIZE) {
        const all = Buffer.concat(chunks, buffered);
        const head = all.subarray(0, CHUNK_SIZE);
        const tail = all.subarray(CHUNK_SIZE);
        hash?.update(head);
        await uploadPart(file.name, partIndex, head);
        offset += head.length;
        partIndex += 1;
        chunks.length = 0;
        chunks.push(tail);
        buffered = tail.length;
        if (partIndex % 10 === 0) log(`  ${file.name}: ${offset}/${file.bytes} bytes`);
      }
    }
    await flush();
  }

  if (file.bytes > 0 && offset < file.bytes) {
    fail(
      `${file.name}: recebidos ${offset} de ${file.bytes} bytes` +
        (resume ? ' (retome rodando de novo)' : ''),
    );
  }

  manifest.set(file.name, {
    name: file.name,
    bytes: offset,
    chunk_size: CHUNK_SIZE,
    parts: partIndex,
    sha256: hash?.digest('hex') ?? null,
    source: `${config.sourceBase}/${SNAPSHOT}/${file.name}`,
    synced_at: new Date().toISOString(),
  });
  await cleanupParts(file.name, partIndex);
  await writeManifest(manifest);
  log(`[ok] ${file.name}: ${partIndex} parte(s), ${offset} bytes`);
}

async function main(): Promise<void> {
  requireConfig();
  log(`Supabase: ${SUPABASE_URL}`);
  log(`bucket: ${BUCKET} · snapshot: ${SNAPSHOT} · parte: ${CHUNK_MB} MB`);

  let files = await listSourceFiles();
  if (ONLY.length > 0) {
    files = files.filter((file) => ONLY.includes(file.name));
  }
  if (files.length === 0) {
    fail(`nenhum ZIP encontrado em ${config.sourceBase}/${SNAPSHOT}/`);
  }

  log(`${files.length} arquivo(s) para sincronizar`);
  const manifest = await readManifest();

  for (const [index, file] of files.entries()) {
    log(`[${index + 1}/${files.length}] ${file.name} (${file.bytes} bytes)`);
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await syncFile(file, manifest);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        log(`[erro] ${file.name} tentativa ${attempt}/${MAX_ATTEMPTS}: ${(error as Error).message}`);
        const wait = Math.min(30, attempt * 3);
        log(`[retry] aguardando ${wait}s e retomando...`);
        await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      }
    }
    if (lastError) throw lastError;
  }

  log('sincronização concluída');
}

main().catch((error) => {
  console.error(`[sync] falhou: ${(error as Error).message}`);
  process.exit(1);
});
