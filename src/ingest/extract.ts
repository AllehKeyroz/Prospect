import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import iconv from 'iconv-lite';
import yauzl from 'yauzl';

/**
 * Mapeia o nome da entrada interna do ZIP da Receita para o CSV de destino.
 * O layout dos arquivos não tem extensão .csv; o conteúdo é Latin-1.
 */
export function outputForEntry(
  entryName: string,
  zipName: string,
  _snapshot: string,
): string | null {
  const upper = entryName.toUpperCase();
  const base = path.basename(zipName, path.extname(zipName));
  if (upper.includes('EMPRECSV')) return path.join('empresas', `${base}.csv`);
  if (upper.includes('ESTABELE')) return path.join('estabelecimentos', `${base}.csv`);
  if (upper.includes('SOCIOCSV')) return path.join('socios', `${base}.csv`);
  if (upper.includes('SIMPLES.CSV')) return path.join('simples', `${base}.csv`);
  if (upper.includes('CNAECSV')) return 'dim_cnae.csv';
  if (upper.includes('MUNICCSV')) return 'dim_municipio.csv';
  if (upper.includes('NATJUCSV')) return 'dim_natureza.csv';
  if (upper.includes('QUALSCSV')) return 'dim_qualificacao.csv';
  if (upper.includes('MOTICSV')) return 'dim_motivo.csv';
  if (upper.includes('PAISCSV')) return 'dim_pais.csv';
  return null;
}

export async function extractZip(
  zipPath: string,
  outRoot: string,
  snapshot: string,
  force: boolean,
): Promise<number> {
  const zipName = path.basename(zipPath);
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError || !zipFile) return reject(openError ?? new Error('ZIP inválido'));
      let extracted = 0;

      zipFile.on('entry', async (entry: yauzl.Entry) => {
        if (/\/$/.test(entry.fileName)) {
          zipFile.readEntry();
          return;
        }

        const relative = outputForEntry(entry.fileName, zipName, snapshot);
        if (!relative) {
          console.warn(`[extract] entrada ignorada: ${entry.fileName}`);
          zipFile.readEntry();
          return;
        }

        const output = path.join(outRoot, relative);
        try {
          if (!force) {
            const existing = await stat(output).catch(() => null);
            if (existing && existing.size > 0) {
              console.log(`[skip] ${relative}`);
              zipFile.readEntry();
              return;
            }
          }
          await mkdir(path.dirname(output), { recursive: true });
          const tmp = `${output}.part`;
          await new Promise<void>((resolveEntry, rejectEntry) => {
            zipFile.openReadStream(entry, (streamError, stream) => {
              if (streamError || !stream) {
                rejectEntry(streamError ?? new Error('Falha no stream'));
                return;
              }
              pipeline(stream, iconv.decodeStream('latin1'), createWriteStream(tmp))
                .then(async () => {
                  await rename(tmp, output);
                  resolveEntry();
                })
                .catch(rejectEntry);
            });
          });
          extracted++;
          console.log(`[extract] ${relative}`);
          zipFile.readEntry();
        } catch (error) {
          reject(error);
        }
      });

      zipFile.on('end', () => resolve(extracted));
      zipFile.on('error', reject);
      zipFile.readEntry();
    });
  });
}
