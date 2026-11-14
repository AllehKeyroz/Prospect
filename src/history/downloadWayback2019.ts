import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  WAYBACK_2019_FILE_COUNT,
  wayback2019FileName,
  wayback2019Url,
} from './wayback2019.js';

const OUT_DIR = path.resolve('data/wayback/2019');
const MANIFEST = path.join(OUT_DIR, 'manifest.json');

interface ManifestFile {
  file: string;
  url: string;
  bytes: number;
  sha256: string;
  downloaded_at: string;
  status: 'ok' | 'failed';
  error?: string;
}

function parseArgs(): { from: number; to: number; force: boolean; hash: boolean } {
  const args = process.argv.slice(2);
  const only = args.find((arg) => arg.startsWith('--only='))?.split('=')[1];
  const from = args.find((arg) => arg.startsWith('--from='))?.split('=')[1];
  const to = args.find((arg) => arg.startsWith('--to='))?.split('=')[1];
  if (only) {
    const index = Number(only);
    return { from: index, to: index, force: args.includes('--force'), hash: !args.includes('--no-hash') };
  }
  return {
    from: from ? Number(from) : 1,
    to: to ? Number(to) : WAYBACK_2019_FILE_COUNT,
    force: args.includes('--force'),
    hash: !args.includes('--no-hash'),
  };
}

async function fileSize(file: string): Promise<number> {
  try {
    return (await stat(file)).size;
  } catch {
    return 0;
  }
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function download(index: number, force: boolean, hash: boolean): Promise<ManifestFile> {
  const file = wayback2019FileName(index);
  const url = wayback2019Url(index);
  const dest = path.join(OUT_DIR, file);
  const existing = await fileSize(dest);
  if (existing > 0 && !force) {
    console.log(`[skip] ${file} (${(existing / 1048576).toFixed(1)} MB)`);
    return {
      file,
      url,
      bytes: existing,
      sha256: hash ? await sha256File(dest) : '',
      downloaded_at: new Date().toISOString(),
      status: 'ok',
    };
  }

  const tmp = `${dest}.part`;
  let start = force ? 0 : await fileSize(tmp);
  if (force) await rm(tmp, { force: true });

  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      console.log(
        `[download] ${file}${start > 0 ? ` (retomando em ${(start / 1048576).toFixed(1)} MB)` : ''} (tentativa ${attempt})`,
      );
      const response = await fetch(url, {
        headers: start > 0 ? { Range: `bytes=${start}-` } : undefined,
        redirect: 'follow',
      });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

      const append = start > 0 && response.status === 206;
      let received = 0;
      let lastLog = Date.now();
      const counter = new Transform({
        transform(chunk, _encoding, callback) {
          received += chunk.length;
          if (Date.now() - lastLog > 15000) {
            lastLog = Date.now();
            console.log(
              `[progress] ${file}: ${((start + received) / 1048576).toFixed(1)} MB`,
            );
          }
          callback(null, chunk);
        },
      });

      await pipeline(
        Readable.fromWeb(response.body as never),
        counter,
        createWriteStream(tmp, { flags: append ? 'a' : 'w' }),
      );
      await rename(tmp, dest);
      const bytes = await fileSize(dest);
      console.log(`[ok] ${file} (${(bytes / 1048576).toFixed(1)} MB)`);
      return {
        file,
        url,
        bytes,
        sha256: hash ? await sha256File(dest) : '',
        downloaded_at: new Date().toISOString(),
        status: 'ok',
      };
    } catch (error) {
      start = await fileSize(tmp);
      if (attempt === 6) {
        console.error(`[fail] ${file}: ${(error as Error).message}`);
        return {
          file,
          url,
          bytes: start,
          sha256: '',
          downloaded_at: new Date().toISOString(),
          status: 'failed',
          error: (error as Error).message,
        };
      }
      const wait = attempt * 5000;
      console.warn(`[retry] ${file}: ${(error as Error).message}; aguardando ${wait}ms`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  throw new Error(`Falha inesperada em ${file}`);
}

async function main(): Promise<void> {
  const { from, to, force, hash } = parseArgs();
  await mkdir(OUT_DIR, { recursive: true });
  const results: ManifestFile[] = [];
  for (let index = from; index <= to; index++) {
    results.push(await download(index, force, hash));
  }
  const existing = await readFile(MANIFEST, 'utf8')
    .then((text) => JSON.parse(text) as { files?: ManifestFile[] })
    .catch(() => ({ files: [] }));
  const merged = new Map<string, ManifestFile>();
  for (const item of existing.files ?? []) merged.set(item.file, item);
  for (const item of results) merged.set(item.file, item);
  const files = [...merged.values()].sort((a, b) => a.file.localeCompare(b.file));
  await writeFile(
    MANIFEST,
    JSON.stringify(
      {
        source: 'Wayback Machine — 200.152.38.155/CNPJ',
        capture: '2019-09-25',
        generated_at: new Date().toISOString(),
        total_bytes: files.reduce((sum, item) => sum + item.bytes, 0),
        files,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`[manifest] ${MANIFEST}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
