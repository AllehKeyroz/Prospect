import 'dotenv/config';
import readline from 'node:readline';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';
import { parse } from 'csv-parse';
import iconv from 'iconv-lite';
import yauzl from 'yauzl';
import { config } from '../config.js';

const AUTH = `Basic ${Buffer.from(`${config.sourceToken}:`).toString('base64')}`;
const RAW_DIR = path.join(config.dataDir, 'raw', config.snapshot);
const SAMPLE_DIR = path.join(config.dataDir, 'sample');
const SHARD = config.sampleShard;
const SAMPLE_LINES = config.sampleLines;

/**
 * Faixas de CNPJ base cobertas por cada shard de Empresas.
 * Os shards de Estabelecimentos e Sócios não seguem a mesma ordem/partição,
 * por isso filtramos os candidatos pela faixa do shard de Empresas escolhido.
 */
const EMPRESAS_RANGES: Record<number, [string, string]> = {
  0: ['41273589', '99999999'],
  1: ['00000000', '04631960'],
  2: ['04631961', '09253553'],
  3: ['09253554', '13846067'],
  4: ['13846068', '18421566'],
  5: ['18421567', '22967210'],
  6: ['22967211', '27499600'],
  7: ['27499601', '32066823'],
  8: ['32066824', '36627968'],
  9: ['36627969', '41273588'],
};

type RecordRow = string[];

function sourceUrl(file: string): string {
  return `${config.sourceBase}/${config.snapshot}/${file}`;
}

async function exists(file: string): Promise<boolean> {
  try {
    return (await stat(file)).size > 0;
  } catch {
    return false;
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadFile(file: string, dest: string, attempts = 4): Promise<void> {
  if (await exists(dest)) {
    console.log(`[skip] ${file} já existe`);
    return;
  }
  await mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      console.log(`[download] ${file} (tentativa ${attempt})`);
      const response = await fetch(sourceUrl(file), {
        headers: { Authorization: AUTH },
      });
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }
      await pipeline(
        Readable.fromWeb(response.body as never),
        createWriteStream(tmp),
      );
      await rename(tmp, dest);
      console.log(`[ok] ${file}`);
      return;
    } catch (error) {
      await rm(tmp, { force: true });
      if (attempt === attempts) throw error;
      const wait = attempt * 2_000;
      console.warn(`[retry] ${file}: ${(error as Error).message}; aguardando ${wait}ms`);
      await sleep(wait);
    }
  }
}

async function fetchRange(file: string, bytes: number, attempts = 4): Promise<Buffer> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      console.log(`[range] ${file} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
      const response = await fetch(sourceUrl(file), {
        headers: {
          Authorization: AUTH,
          Range: `bytes=0-${bytes - 1}`,
        },
      });
      if (!response.ok && response.status !== 206) {
        throw new Error(`HTTP ${response.status}`);
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt === attempts) throw error;
      await sleep(attempt * 2_000);
    }
  }
  throw new Error(`Falha ao baixar range de ${file}`);
}

function inflateFirstLines(buffer: Buffer, maxLines: number): string[] {
  if (buffer.readUInt32LE(0) !== 0x04034b50) {
    throw new Error('Resposta não é um ZIP válido');
  }
  const nameLen = buffer.readUInt16LE(26);
  const extraLen = buffer.readUInt16LE(28);
  const dataStart = 30 + nameLen + extraLen;
  const inflated = zlib.inflateRawSync(buffer.subarray(dataStart), {
    finishFlush: zlib.constants.Z_SYNC_FLUSH,
  });
  const text = inflated.toString('latin1').replace(/\r/g, '');
  const completeLines = text.split('\n').slice(0, -1);
  return completeLines.slice(0, maxLines);
}

function csvLine(record: string[]): string {
  return record
    .map((field) => `"${String(field ?? '').replace(/"/g, '""')}"`)
    .join(';');
}

function entryMatches(name: string, suffix: string): boolean {
  return name.toUpperCase().includes(suffix.toUpperCase());
}

async function streamZipEntry(
  zipPath: string,
  suffix: string,
  onRecord: (record: RecordRow) => boolean | void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError || !zipFile) return reject(openError ?? new Error('ZIP inválido'));
      let found = false;
      let count = 0;

      zipFile.on('entry', (entry: yauzl.Entry) => {
        if (/\/$/.test(entry.fileName) || !entryMatches(entry.fileName, suffix)) {
          zipFile.readEntry();
          return;
        }
        found = true;
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return reject(streamError ?? new Error('Falha no stream'));
          const decoded = stream.pipe(iconv.decodeStream('latin1'));
          const parser = parse({
            delimiter: ';',
            quote: '"',
            relax_quotes: true,
            relax_column_count: true,
            skip_empty_lines: true,
          });
          decoded.pipe(parser);
          parser.on('data', (record: RecordRow) => {
            count++;
            const keep = onRecord(record);
            if (keep === false) {
              // Continua lendo: o filtro é por registro, não por arquivo.
            }
          });
          parser.on('error', reject);
          parser.on('end', () => resolve(count));
        });
      });

      zipFile.on('end', () => {
        if (!found) reject(new Error(`Entrada ${suffix} não encontrada em ${zipPath}`));
        else resolve(0);
      });
      zipFile.on('error', reject);
      zipFile.readEntry();
    });
  });
}

async function readZipEntryText(zipPath: string, suffix: string): Promise<string> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError || !zipFile) return reject(openError ?? new Error('ZIP inválido'));
      let found = false;

      zipFile.on('entry', (entry: yauzl.Entry) => {
        if (/\/$/.test(entry.fileName) || !entryMatches(entry.fileName, suffix)) {
          zipFile.readEntry();
          return;
        }
        found = true;
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return reject(streamError ?? new Error('Falha no stream'));
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => resolve(iconv.decode(Buffer.concat(chunks), 'latin1')));
          stream.on('error', reject);
        });
      });

      zipFile.on('end', () => {
        if (!found) reject(new Error(`Entrada ${suffix} não encontrada em ${zipPath}`));
      });
      zipFile.on('error', reject);
      zipFile.readEntry();
    });
  });
}

async function streamZipLines(
  zipPath: string,
  suffix: string,
  onLine: (line: string) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError || !zipFile) return reject(openError ?? new Error('ZIP inválido'));
      let found = false;
      let count = 0;

      zipFile.on('entry', (entry: yauzl.Entry) => {
        if (/\/$/.test(entry.fileName) || !entryMatches(entry.fileName, suffix)) {
          zipFile.readEntry();
          return;
        }
        found = true;
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return reject(streamError ?? new Error('Falha no stream'));
          const decoded = stream.pipe(iconv.decodeStream('latin1'));
          const lines = readline.createInterface({ input: decoded, crlfDelay: Infinity });
          lines.on('line', (line) => {
            count++;
            onLine(line.replace(/\r$/, ''));
          });
          lines.on('close', () => resolve(count));
          lines.on('error', reject);
        });
      });

      zipFile.on('end', () => {
        if (!found) reject(new Error(`Entrada ${suffix} não encontrada em ${zipPath}`));
      });
      zipFile.on('error', reject);
      zipFile.readEntry();
    });
  });
}

async function downloadDim(file: string, suffix: string, output: string): Promise<void> {
  const zipPath = path.join(RAW_DIR, file);
  await downloadFile(file, zipPath);
  const text = await readZipEntryText(zipPath, suffix);
  await writeFile(output, text, 'utf8');
  console.log(`[ok] ${path.basename(output)}`);
}

async function main(): Promise<void> {
  await mkdir(RAW_DIR, { recursive: true });
  await mkdir(SAMPLE_DIR, { recursive: true });

  // 1. Tabelas de domínio (pequenas)
  const dims: Array<[string, string, string]> = [
    ['Cnaes.zip', 'CNAECSV', 'dim_cnae.csv'],
    ['Municipios.zip', 'MUNICCSV', 'dim_municipio.csv'],
    ['Naturezas.zip', 'NATJUCSV', 'dim_natureza.csv'],
    ['Qualificacoes.zip', 'QUALSCSV', 'dim_qualificacao.csv'],
    ['Motivos.zip', 'MOTICSV', 'dim_motivo.csv'],
    ['Paises.zip', 'PAISCSV', 'dim_pais.csv'],
  ];
  for (const [zip, suffix, output] of dims) {
    await downloadDim(zip, suffix, path.join(SAMPLE_DIR, output));
  }

  // 2. Lê candidatos de estabelecimentos do shard escolhido.
  //    O range é maior que o necessário porque nem todos os CNPJs terão
  //    empresa no shard de Empresas correspondente (os shards não são
  //    alinhados entre Empresas/Estabelecimentos/Sócios).
  const estFile = `Estabelecimentos${SHARD}.zip`;
  const estBuffer = await fetchRange(estFile, 16 * 1024 * 1024);
  const rawCandidateLines = inflateFirstLines(estBuffer, SAMPLE_LINES * 5);
  if (rawCandidateLines.length === 0) throw new Error('Nenhuma linha de estabelecimento extraída');

  const [rangeMin, rangeMax] = EMPRESAS_RANGES[SHARD] ?? ['00000000', '99999999'];
  const candidateLines = rawCandidateLines.filter((line) => {
    const base = line.slice(0, line.indexOf(';')).replace(/^"|"$/g, '').toUpperCase();
    return base >= rangeMin && base <= rangeMax;
  });
  if (candidateLines.length === 0) {
    throw new Error(`Nenhum candidato na faixa ${rangeMin}-${rangeMax}; ajuste SAMPLE_SHARD`);
  }

  const candidateBases = new Set<string>();
  for (const line of candidateLines) {
    const first = line.slice(0, line.indexOf(';')).replace(/^"|"$/g, '').toUpperCase();
    if (first) candidateBases.add(first);
  }
  console.log(
    `[sample] ${candidateLines.length} candidatos na faixa ${rangeMin}-${rangeMax}, ${candidateBases.size} CNPJ bases`,
  );

  // 3. Empresas: baixa o shard inteiro e grava as que pertencem aos candidatos.
  const empresasZip = `Empresas${SHARD}.zip`;
  await downloadFile(empresasZip, path.join(RAW_DIR, empresasZip));
  const empresasOut = path.join(SAMPLE_DIR, 'empresas.csv');

  const foundBases = new Set<string>();
  const empresasLines: string[] = [];
  let empresasKept = 0;
  await streamZipEntry(path.join(RAW_DIR, empresasZip), 'EMPRECSV', (record) => {
    const base = String(record[0] ?? '').toUpperCase();
    if (candidateBases.has(base)) {
      empresasLines.push(csvLine(record));
      foundBases.add(base);
      empresasKept++;
    }
  });
  await writeFile(
    empresasOut,
    empresasLines.length ? `${empresasLines.join('\n')}\n` : '',
    'utf8',
  );
  console.log(`[sample] ${empresasKept} empresas`);

  // 4. Mantém apenas estabelecimentos cuja empresa está na amostra.
  const estLines = candidateLines
    .filter((line) => {
      const base = line.slice(0, line.indexOf(';')).replace(/^"|"$/g, '').toUpperCase();
      return foundBases.has(base);
    })
    .slice(0, SAMPLE_LINES);
  if (estLines.length === 0) {
    throw new Error('Nenhum estabelecimento com empresa correspondente; aumente o range da amostra');
  }
  await writeFile(
    path.join(SAMPLE_DIR, 'estabelecimentos.csv'),
    `${estLines.join('\n')}\n`,
    'utf8',
  );

  const finalBases = new Set<string>();
  for (const line of estLines) {
    const first = line.slice(0, line.indexOf(';')).replace(/^"|"$/g, '').toUpperCase();
    if (first) finalBases.add(first);
  }
  console.log(
    `[sample] ${estLines.length} estabelecimentos coerentes, ${finalBases.size} CNPJ bases`,
  );

  // 5. Sócios: filtra pelas bases finais (pode ficar parcial se o shard de
  //    Sócios não cobrir a mesma faixa; é uma limitação da amostra).
  const sociosZip = `Socios${SHARD}.zip`;
  await downloadFile(sociosZip, path.join(RAW_DIR, sociosZip));
  const sociosOut = path.join(SAMPLE_DIR, 'socios.csv');
  const sociosLines: string[] = [];
  let sociosKept = 0;
  await streamZipEntry(path.join(RAW_DIR, sociosZip), 'SOCIOCSV', (record) => {
    if (finalBases.has(String(record[0] ?? '').toUpperCase())) {
      sociosLines.push(csvLine(record));
      sociosKept++;
    }
  });
  await writeFile(
    sociosOut,
    sociosLines.length ? `${sociosLines.join('\n')}\n` : '',
    'utf8',
  );
  console.log(`[sample] ${sociosKept} sócios`);

  // 6. Simples/MEI (opcional; arquivo grande, mas o filtro é streaming)
  let simplesKept = 0;
  if (config.sampleIncludeSimples) {
    const simplesZip = 'Simples.zip';
    await downloadFile(simplesZip, path.join(RAW_DIR, simplesZip));
    const simplesOut = path.join(SAMPLE_DIR, 'simples.csv');
    const simplesLines: string[] = [];
    await streamZipLines(path.join(RAW_DIR, simplesZip), 'SIMPLES.CSV', (line) => {
      const base = line.slice(0, line.indexOf(';')).replace(/^"|"$/g, '').toUpperCase();
      if (finalBases.has(base)) {
        simplesLines.push(line);
        simplesKept++;
      }
    });
    await writeFile(
      simplesOut,
      simplesLines.length ? `${simplesLines.join('\n')}\n` : '',
      'utf8',
    );
    console.log(`[sample] ${simplesKept} registros de Simples/MEI`);
  } else {
    console.log('[sample] Simples/MEI ignorado (SAMPLE_INCLUDE_SIMPLES=false)');
  }

  // 7. Metadados da amostra
  await writeFile(
    path.join(SAMPLE_DIR, 'meta.json'),
    JSON.stringify(
      {
        snapshot: config.snapshot,
        shard: SHARD,
        sample_lines: estLines.length,
        bases: finalBases.size,
        empresas: empresasKept,
        socios: sociosKept,
        simples: simplesKept,
        source: config.sourceBase,
        generated_at: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );

  console.log('\nAmostra pronta em', SAMPLE_DIR);
}

main().catch((error) => {
  console.error('Falha ao gerar amostra:', error);
  process.exit(1);
});

