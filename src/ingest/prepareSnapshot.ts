import 'dotenv/config';
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { mkdir, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';
import { extractZip } from './extract.js';

const AUTH = `Basic ${Buffer.from(`${config.sourceToken}:`).toString('base64')}`;

type SourceFile = { name: string; size: number };

const FALLBACK_FILES: string[] = [
  'Cnaes.zip',
  'Motivos.zip',
  'Municipios.zip',
  'Naturezas.zip',
  'Paises.zip',
  'Qualificacoes.zip',
  'Simples.zip',
  ...Array.from({ length: 10 }, (_, i) => `Empresas${i}.zip`),
  ...Array.from({ length: 10 }, (_, i) => `Estabelecimentos${i}.zip`),
  ...Array.from({ length: 10 }, (_, i) => `Socios${i}.zip`),
];

function parseArgs(): {
  snapshot: string;
  only?: string;
  list: boolean;
  force: boolean;
} {
  const args = process.argv.slice(2);
  const snapshot =
    args.find((arg) => arg.startsWith('--snapshot='))?.split('=')[1] ??
    config.snapshot;
  const only = args.find((arg) => arg.startsWith('--only='))?.split('=')[1];
  return {
    snapshot,
    only,
    list: args.includes('--list'),
    force: args.includes('--force'),
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listSnapshotFiles(snapshot: string): Promise<SourceFile[]> {
  const url = `${config.sourceBase}/${snapshot}/`;
  console.log(`[discover] ${url}`);
  try {
    const response = await fetch(url, {
      method: 'PROPFIND',
      headers: { Authorization: AUTH, Depth: '1' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    const files: SourceFile[] = [];
    const blocks = xml.match(/<d:response>[\s\S]*?<\/d:response>/g) ?? [];
    for (const block of blocks) {
      const href = (block.match(/<d:href>([^<]+)<\/d:href>/) ?? [])[1] ?? '';
      if (!href || /\/$/.test(href)) continue;
      const name = decodeURIComponent(href.split('/').filter(Boolean).pop() ?? '');
      if (!name.toLowerCase().endsWith('.zip')) continue;
      const size = Number(
        (block.match(/<d:getcontentlength>(\d+)<\/d:getcontentlength>/) ?? [])[1] ?? 0,
      );
      files.push({ name, size });
    }
    if (files.length === 0) throw new Error('Nenhum ZIP listado');
    return files.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.warn(`[discover] falhou (${(error as Error).message}); usando lista conhecida`);
    return FALLBACK_FILES.map((name) => ({ name, size: 0 }));
  }
}

async function downloadFile(
  snapshot: string,
  file: SourceFile,
  dest: string,
  force: boolean,
): Promise<void> {
  if (!force && isCompleteDownload(dest, file.size)) {
    const existing = await stat(dest).catch(() => null);
    console.log(`[skip] ${file.name} (${((existing?.size ?? 0) / 1048576).toFixed(1)} MB)`);
    return;
  }

  await mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  if (!force && existsSync(`${dest}.aria2`)) {
    // Aproveita o parcial deixado pelo aria2 em vez de recomeçar do zero.
    const partial = await stat(dest).catch(() => null);
    if (partial && partial.size > 0) {
      await rm(tmp, { force: true });
      await rename(dest, tmp);
    }
    await rm(`${dest}.aria2`, { force: true });
  }
  let start = 0;
  if (!force) {
    try {
      start = (await stat(tmp)).size;
    } catch {
      start = 0;
    }
  }

  if (!force && start > 0 && file.size > 0 && start >= file.size) {
    // O parcial já cobre o arquivo inteiro (download anterior interrompido no fim).
    await rm(dest, { force: true });
    await rename(tmp, dest);
    console.log(`[skip] ${file.name} (${(start / 1048576).toFixed(1)} MB)`);
    return;
  }

  const maxAttempts = Number(process.env.DOWNLOAD_ATTEMPTS ?? 12) || 12;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(
        `[download] ${file.name}${start > 0 ? ` (retomando em ${(start / 1048576).toFixed(1)} MB)` : ''} (tentativa ${attempt})`,
      );
      const headers: Record<string, string> = { Authorization: AUTH };
      if (start > 0) headers.Range = `bytes=${start}-`;
      const response = await fetch(`${config.sourceBase}/${snapshot}/${file.name}`, {
        headers,
      });
      if (response.status === 416) {
        // Range recusado porque o arquivo já está completo.
        await rm(dest, { force: true });
        await rename(tmp, dest).catch(() => undefined);
        await rm(`${dest}.aria2`, { force: true });
        console.log(`[skip] ${file.name} (já completo)`);
        return;
      }
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

      const append = start > 0 && response.status === 206;
      await pipeline(
        Readable.fromWeb(response.body as never),
        createWriteStream(tmp, { flags: append ? 'a' : 'w' }),
      );
      await rename(tmp, dest);
      // Um parcial do aria2 deixaria um .aria2 órfão; sem limpar, o arquivo
      // seria considerado incompleto em toda execução seguinte.
      await rm(`${dest}.aria2`, { force: true });
      const size = (await stat(dest)).size;
      console.log(`[ok] ${file.name} (${(size / 1048576).toFixed(1)} MB)`);
      return;
    } catch (error) {
      const partial = await stat(tmp).catch(() => null);
      start = partial?.size ?? 0;
      if (attempt === maxAttempts) throw error;
      const wait = Math.min(attempt * 3_000, 30_000);
      const cause = (error as { cause?: { code?: string; message?: string } }).cause;
      const detail = cause?.code ?? cause?.message ?? '';
      console.warn(
        `[retry] ${file.name}: ${(error as Error).message}${detail ? ` (${detail})` : ''}; aguardando ${wait}ms`,
      );
      await sleep(wait);
    }
  }
}

function aria2Available(): boolean {
  if (process.env.USE_ARIA2 === 'false') return false;
  try {
    return spawnSync('aria2c', ['--version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
}

/**
 * Um ZIP só está completo se não existe o arquivo de controle `.aria2` e o
 * tamanho bate com o informado pelo WebDAV. Sem isso, um download interrompido
 * deixaria um arquivo parcial no caminho final e a extração falharia.
 */
/**
 * Um ZIP só está completo se o tamanho bate com o WebDAV E o arquivo termina
 * com a assinatura do "end of central directory" (PK\x05\x06, ou PK\x06\x06
 * no ZIP64). Tamanho correto com conteúdo truncado acontece quando o servidor
 * cai no meio da escrita.
 */
function isCompleteDownload(dest: string, expectedSize: number): boolean {
  try {
    if (existsSync(`${dest}.aria2`)) return false;
    const size = statSync(dest).size;
    if (size <= 0) return false;
    if (expectedSize > 0 && size !== expectedSize) return false;
    return hasZipEnd(dest);
  } catch {
    return false;
  }
}

function hasZipEnd(file: string): boolean {
  try {
    const size = statSync(file).size;
    if (size < 22) return false;
    const length = Math.min(65_536, size);
    const buffer = Buffer.alloc(length);
    const fd = openSync(file, 'r');
    try {
      readSync(fd, buffer, 0, length, size - length);
    } finally {
      closeSync(fd);
    }
    return (
      buffer.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06])) ||
      buffer.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06]))
    );
  } catch {
    return false;
  }
}

/**
 * Download acelerado com aria2c: cada ZIP é dividido em vários segmentos e
 * baixado com conexões paralelas. O WebDAV da Receita aceita Range, então o
 * ganho é grande em arquivos de centenas de MB.
 */
async function ariaDownload(snapshot: string, files: SourceFile[], rawDir: string): Promise<void> {
  const connections = Number(process.env.ARIA2_CONNECTIONS ?? 4) || 4;
  const jobs = Number(process.env.ARIA2_JOBS ?? 2) || 2;
  const inputFile = path.join(rawDir, 'aria2-input.txt');
  const lines: string[] = [];

  for (const file of files) {
    lines.push(`${config.sourceBase}/${snapshot}/${file.name}`);
    lines.push(`  out=${file.name}`);
    lines.push(`  dir=${rawDir}`);
    lines.push(`  header=Authorization: ${AUTH}`);
  }

  await writeFile(inputFile, `${lines.join('\n')}\n`, 'utf8');

  const args = [
    `--input-file=${inputFile}`,
    '--continue=true',
    `--max-concurrent-downloads=${jobs}`,
    `--max-connection-per-server=${connections}`,
    `--split=${connections}`,
    '--min-split-size=1M',
    '--max-tries=10',
    '--retry-wait=5',
    '--auto-file-renaming=false',
    '--allow-overwrite=false',
    '--console-log-level=warn',
    '--summary-interval=30',
  ];

  console.log(
    `[aria2] ${files.length} arquivo(s) · ${connections} conexões por arquivo · ${jobs} em paralelo`,
  );

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('aria2c', args, { stdio: 'inherit' });
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`aria2c terminou com código ${code}`)),
      );
    });
  } finally {
    await rm(inputFile, { force: true });
  }
}

async function mapLimit<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      await worker(item);
    }
  });
  await Promise.all(workers);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const snapshot = args.snapshot;
  const rawDir = path.join(config.dataDir, 'raw', snapshot);
  const outDir = path.join(config.dataDir, 'extracted', snapshot);

  const files = await listSnapshotFiles(snapshot);
  const selected = args.only
    ? files.filter((file) => file.name.toLowerCase() === args.only!.toLowerCase())
    : files;
  if (selected.length === 0) {
    console.error(`Nenhum arquivo encontrado${args.only ? ` para ${args.only}` : ''}.`);
    process.exit(1);
  }

  if (args.list) {
    console.log(`Snapshot ${snapshot}: ${files.length} arquivos`);
    const total = files.reduce((sum, file) => sum + file.size, 0);
    console.log(`Total: ${(total / 1073741824).toFixed(2)} GB`);
    for (const file of files) {
      console.log(`${file.name}\t${(file.size / 1048576).toFixed(2)} MB`);
    }
    return;
  }

  try {
    const stats = await statfs(config.dataDir);
    const freeGb = (stats.bavail * stats.bsize) / 1073741824;
    console.log(`[disk] livre em ${config.dataDir}: ${freeGb.toFixed(1)} GB`);
    if (freeGb < 40) console.warn('[disk] menos de 40 GB livres; o snapshot completo pode não caber');
  } catch {
    // statfs pode não estar disponível em todos os sistemas
  }

  await mkdir(rawDir, { recursive: true });
  await mkdir(outDir, { recursive: true });

  const pending = selected.filter(
    (file) => args.force || !isCompleteDownload(path.join(rawDir, file.name), file.size),
  );
  if (pending.length > 0 && aria2Available()) {
    try {
      await ariaDownload(snapshot, pending, rawDir);
    } catch (error) {
      console.warn(`[aria2] falhou (${(error as Error).message}); usando o downloader padrão`);
    }
  }

  console.log(`\n[1/2] Baixando ${selected.length} arquivo(s) para ${rawDir}`);
  const parallel = Number(process.env.DOWNLOAD_PARALLEL ?? 4) || 4;
  const failures: string[] = [];
  await mapLimit(selected, parallel, async (file) => {
    const dest = path.join(rawDir, file.name);
    try {
      await downloadFile(snapshot, file, dest, args.force);
      if (!hasZipEnd(dest)) {
        throw new Error('ZIP inválido: assinatura de fim ausente (arquivo truncado)');
      }
    } catch (error) {
      await rm(dest, { force: true }).catch(() => undefined);
      failures.push(file.name);
      console.error(`[falhou] ${file.name}: ${(error as Error).message}`);
    }
  });

  if (failures.length > 0) {
    console.error(
      `\n[download] ${failures.length} arquivo(s) falharam: ${failures.join(', ')}`,
    );
    console.error('Rode o comando de novo: o que já baixou é retomado.');
    process.exit(1);
  }

  console.log(`\n[2/2] Extraindo para ${outDir}`);
  for (const file of selected) {
    const zipPath = path.join(rawDir, file.name);
    console.log(`\n[zip] ${file.name}`);
    await extractZip(zipPath, outDir, snapshot, args.force);
  }

  await writeFile(
    path.join(outDir, 'manifest.json'),
    JSON.stringify(
      {
        snapshot,
        source: config.sourceBase,
        generated_at: new Date().toISOString(),
        files: selected,
        only: args.only ?? null,
      },
      null,
      2,
    ),
    'utf8',
  );

  console.log('\n[ok] Extração concluída.');
  if (args.only) {
    console.log(`Modo --only: apenas ${args.only}. Rode sem --only para o snapshot completo.`);
  } else {
    console.log('Agora rode: npm run ingest:snapshot');
  }
}

main().catch((error) => {
  console.error('Falha na preparação do snapshot:', error);
  process.exit(1);
});
