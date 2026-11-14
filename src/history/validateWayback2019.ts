import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import iconv from 'iconv-lite';
import yauzl from 'yauzl';
import { closeDatabase, openDatabase, query } from '../db/duckdb.js';
import { config } from '../config.js';
import {
  normalizeHistoryText,
  parseHistoricCompany,
  tokenSimilarity,
  type HistoricCompany,
} from './wayback2019.js';

interface Args {
  files: string[];
  sampleSize: number;
  maxCompanyRecords: number;
  outDir: string;
}

interface ArchiveStats {
  file: string;
  entry: string;
  total_companies: number;
  total_partners: number;
  sampled_companies: number;
}

interface CurrentCompany {
  cnpj: string;
  cnpj_base: string;
  razao_social: string | null;
  situacao: string | null;
  data_inicio: string | null;
  cnae_principal: string | null;
  uf: string | null;
}

const UF_SET = new Set([
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
  'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
]);

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const file = args.find((arg) => arg.startsWith('--file='))?.split('=')[1];
  const sampleSize = Number(
    args.find((arg) => arg.startsWith('--sample='))?.split('=')[1] ?? 20_000,
  );
  const maxCompanyRecords = Number(
    args.find((arg) => arg.startsWith('--max-company-records='))?.split('=')[1] ?? 0,
  );
  const outDir =
    args.find((arg) => arg.startsWith('--out-dir='))?.split('=')[1] ?? 'docs/historico';
  return {
    files: file ? [path.resolve(file)] : [path.resolve('data/wayback/2019/DADOS_ABERTOS_CNPJ_01.zip')],
    sampleSize: Math.max(100, sampleSize),
    maxCompanyRecords: Math.max(0, maxCompanyRecords),
    outDir: path.resolve(outDir),
  };
}

function emptyStats(file: string): ArchiveStats {
  return {
    file: path.relative(process.cwd(), file),
    entry: '',
    total_companies: 0,
    total_partners: 0,
    sampled_companies: 0,
  };
}

function addCount(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function top(map: Record<string, number>, limit = 15): Array<[string, number]> {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function pct(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 10000) / 100;
}

async function scanZip(
  file: string,
  sampleSize: number,
  maxCompanyRecords: number,
): Promise<{
  stats: ArchiveStats;
  sample: HistoricCompany[];
  internal: Record<string, number>;
  byUf: Record<string, number>;
  bySituacao: Record<string, number>;
  byYear: Record<string, number>;
  byCnaePrefix: Record<string, number>;
}> {
  const stats = emptyStats(file);
  const sample: HistoricCompany[] = [];
  const internal: Record<string, number> = {
    invalid_cnpj: 0,
    invalid_situacao: 0,
    invalid_uf: 0,
    invalid_cnae: 0,
    invalid_date: 0,
    temporal_violation: 0,
  };
  const byUf: Record<string, number> = {};
  const bySituacao: Record<string, number> = {};
  const byYear: Record<string, number> = {};
  const byCnaePrefix: Record<string, number> = {};

  await new Promise<void>((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (openError, zipFile) => {
      if (openError || !zipFile) {
        reject(openError ?? new Error('ZIP inválido'));
        return;
      }
      zipFile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          zipFile.readEntry();
          return;
        }
        stats.entry = entry.fileName;
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            reject(streamError ?? new Error('Falha no stream'));
            return;
          }
          const reader = readline.createInterface({
            input: stream.pipe(iconv.decodeStream('latin1')),
          });
          reader.on('line', (line) => {
            if (line.startsWith('2F ')) {
              stats.total_partners++;
              return;
            }
            const record = parseHistoricCompany(line);
            if (!record) {
              if (line.startsWith('1F ')) internal.invalid_cnpj++;
              return;
            }
            stats.total_companies++;
            if (!['01', '02', '03', '04', '08'].includes(record.situacao)) {
              internal.invalid_situacao++;
            }
            if (!UF_SET.has(record.uf)) internal.invalid_uf++;
            if (!/^\d{7}$/.test(record.cnae_principal)) internal.invalid_cnae++;
            if (!record.data_inicio) internal.invalid_date++;
            if (record.data_inicio && record.data_situacao && record.data_situacao < record.data_inicio) {
              internal.temporal_violation++;
            }
            addCount(byUf, record.uf || '??');
            addCount(bySituacao, record.situacao || '??');
            addCount(byYear, record.data_inicio?.slice(0, 4) ?? 'sem data');
            addCount(byCnaePrefix, record.cnae_principal.slice(0, 2) || '??');

            if (sample.length < sampleSize) {
              sample.push(record);
            } else {
              const index = Math.floor(Math.random() * stats.total_companies);
              if (index < sampleSize) sample[index] = record;
            }
            if (maxCompanyRecords > 0 && stats.total_companies >= maxCompanyRecords) {
              reader.close();
              zipFile.close();
            }
          });
          reader.on('close', () => resolve());
          reader.on('error', reject);
        });
      });
      zipFile.on('error', reject);
      zipFile.readEntry();
    });
  });

  stats.sampled_companies = sample.length;
  return { stats, sample, internal, byUf, bySituacao, byYear, byCnaePrefix };
}

async function loadCurrent(cnpjs: string[]): Promise<Map<string, CurrentCompany>> {
  const result = new Map<string, CurrentCompany>();
  const unique = [...new Set(cnpjs)];
  for (let offset = 0; offset < unique.length; offset += 500) {
    const batch = unique.slice(offset, offset + 500);
    const params = Object.fromEntries(batch.map((value, index) => [`p${index}`, value]));
    const placeholders = batch.map((_, index) => `$p${index}`).join(', ');
    const rows = await query<CurrentCompany>(
      `SELECT cnpj, cnpj_base, razao_social, situacao, data_inicio, cnae_principal, uf
       FROM estabelecimentos_busca
       WHERE cnpj IN (${placeholders})`,
      params,
    );
    for (const row of rows) result.set(row.cnpj, row);
  }
  return result;
}

async function loadCurrentBases(bases: string[]): Promise<Set<string>> {
  const result = new Set<string>();
  const unique = [...new Set(bases)];
  for (let offset = 0; offset < unique.length; offset += 500) {
    const batch = unique.slice(offset, offset + 500);
    const params = Object.fromEntries(batch.map((value, index) => [`p${index}`, value]));
    const placeholders = batch.map((_, index) => `$p${index}`).join(', ');
    const rows = await query<{ cnpj_base: string }>(
      `SELECT cnpj_base FROM empresas WHERE cnpj_base IN (${placeholders})`,
      params,
    );
    for (const row of rows) result.add(row.cnpj_base);
  }
  return result;
}

async function main(): Promise<void> {
  const args = parseArgs();
  await openDatabase({ readOnly: true });

  const scans = [];
  for (const file of args.files) {
    console.log(`[scan] ${file}`);
    scans.push(await scanZip(file, args.sampleSize, args.maxCompanyRecords));
  }

  const samples = scans.flatMap((scan) => scan.sample);
  const current = await loadCurrent(samples.map((item) => item.cnpj));
  const currentBases = await loadCurrentBases(samples.map((item) => item.cnpj_base));

  let matchedBase = 0;
  let matchedFull = 0;
  let nameExact = 0;
  let nameSimilar = 0;
  let situationMatch = 0;
  let openingMatch = 0;
  let cnaeMatch = 0;
  let ufMatch = 0;
  const divergences: Array<Record<string, unknown>> = [];
  const byUf: Record<string, number> = {};
  const bySituacao: Record<string, number> = {};
  const byYear: Record<string, number> = {};
  const byCnaePrefix: Record<string, number> = {};
  const internal: Record<string, number> = {};

  for (const scan of scans) {
    for (const [key, value] of Object.entries(scan.byUf)) byUf[key] = (byUf[key] ?? 0) + value;
    for (const [key, value] of Object.entries(scan.bySituacao)) {
      bySituacao[key] = (bySituacao[key] ?? 0) + value;
    }
    for (const [key, value] of Object.entries(scan.byYear)) byYear[key] = (byYear[key] ?? 0) + value;
    for (const [key, value] of Object.entries(scan.byCnaePrefix)) {
      byCnaePrefix[key] = (byCnaePrefix[key] ?? 0) + value;
    }
    for (const [key, value] of Object.entries(scan.internal)) {
      internal[key] = (internal[key] ?? 0) + value;
    }
  }

  for (const record of samples) {
    const found = current.get(record.cnpj);
    if (!found) {
      if (currentBases.has(record.cnpj_base)) {
        matchedBase++;
        if (divergences.length < 12) {
          divergences.push({
            cnpj: record.cnpj,
            tipo: 'base_presente_sem_estabelecimento_local',
            razao_2019: record.razao_social,
            uf_2019: record.uf,
            data_2019: record.data_inicio,
          });
        }
      } else if (divergences.length < 12) {
        divergences.push({
          cnpj: record.cnpj,
          tipo: 'sem_match_no_snapshot_local',
          razao_2019: record.razao_social,
          uf_2019: record.uf,
          data_2019: record.data_inicio,
        });
      }
      continue;
    }
    matchedBase++;
    matchedFull++;
    const normalizedCurrent = normalizeHistoryText(found.razao_social ?? '');
    const normalizedArchive = normalizeHistoryText(record.razao_social);
    if (normalizedCurrent === normalizedArchive) nameExact++;
    if (tokenSimilarity(found.razao_social ?? '', record.razao_social) >= 0.8) nameSimilar++;
    if (found.situacao === record.situacao) situationMatch++;
    if (found.data_inicio === record.data_inicio) openingMatch++;
    if (found.cnae_principal === record.cnae_principal) cnaeMatch++;
    if (found.uf === record.uf) ufMatch++;

    const issues: string[] = [];
    if (found.situacao !== record.situacao) issues.push('situacao');
    if (found.data_inicio !== record.data_inicio) issues.push('data_inicio');
    if (found.cnae_principal !== record.cnae_principal) issues.push('cnae');
    if (found.uf !== record.uf) issues.push('uf');
    if (issues.length && divergences.length < 12) {
      divergences.push({
        cnpj: record.cnpj,
        tipo: 'campos_divergentes',
        campos: issues,
        razao_2019: record.razao_social,
        razao_atual: found.razao_social,
        situacao_2019: record.situacao,
        situacao_atual: found.situacao,
        abertura_2019: record.data_inicio,
        abertura_atual: found.data_inicio,
        cnae_2019: record.cnae_principal,
        cnae_atual: found.cnae_principal,
        uf_2019: record.uf,
        uf_atual: found.uf,
      });
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    source: 'Wayback Machine — 200.152.38.155/CNPJ',
    capture: '2019-09-25',
    local_snapshot: config.snapshot,
    files: scans.map((scan) => scan.stats),
    sample: {
      requested: args.sampleSize,
      scanned: samples.length,
      max_company_records: args.maxCompanyRecords || null,
    },
    internal_checks: internal,
    coverage: {
      matched_full: matchedFull,
      matched_base: matchedBase,
      pct_full: pct(matchedFull, samples.length),
      pct_base: pct(matchedBase, samples.length),
      note:
        'A base local é uma amostra de 50 mil estabelecimentos; o percentual de match não mede a cobertura nacional.',
    },
    agreement: {
      name_exact: nameExact,
      name_similar: nameSimilar,
      situation: situationMatch,
      opening_date: openingMatch,
      cnae: cnaeMatch,
      uf: ufMatch,
      pct_name_exact: pct(nameExact, matchedFull),
      pct_name_similar: pct(nameSimilar, matchedFull),
      pct_situation: pct(situationMatch, matchedFull),
      pct_opening_date: pct(openingMatch, matchedFull),
      pct_cnae: pct(cnaeMatch, matchedFull),
      pct_uf: pct(ufMatch, matchedFull),
    },
    distributions: {
      by_uf: top(byUf),
      by_situacao: top(bySituacao),
      by_opening_year: Object.entries(byYear).sort((a, b) => a[0].localeCompare(b[0])).slice(-35),
      by_cnae_prefix: top(byCnaePrefix),
    },
    divergences,
    limitations: [
      'Validação por amostragem sobre o arquivo 01; os demais arquivos do pacote precisam ser baixados e validados.',
      'O layout 2019 é fixed-width de 1.200 caracteres, distinto do CSV moderno da Receita.',
      'A comparação local usa uma amostra de 50 mil estabelecimentos, não o snapshot oficial completo.',
      'Divergência de situação entre 2019 e 2026 é esperada (mudança real de cadastro), não erro de chave.',
      'Nenhum dado de 2019 foi mesclado ao banco; o relatório é apenas de confiança e proveniência.',
    ],
  };

  await mkdir(args.outDir, { recursive: true });
  const jsonFile = path.join(args.outDir, '2019-validacao.json');
  await writeFile(jsonFile, JSON.stringify(report, null, 2), 'utf8');

  const md = [
    '# Validação do pacote 2019 (Wayback)',
    '',
    `Gerado em ${report.generated_at}.`,
    '',
    '## Cobertura da amostra',
    '',
    '| Arquivo | Empresas | Sócios | Amostradas |',
    '|---|---:|---:|---:|',
    ...report.files.map(
      (file) => `| ${file.file} | ${file.total_companies} | ${file.total_partners} | ${file.sampled_companies} |`,
    ),
    '',
    '## Conferência interna',
    '',
    '| Verificação | Ocorrências |',
    '|---|---:|',
    ...Object.entries(internal).map(([key, value]) => `| ${key} | ${value} |`),
    '',
    '## Concordância com o snapshot local',
    '',
    `- Registros amostrados: **${samples.length}**`,
    `- Match de CNPJ base: **${matchedBase}** (${report.coverage.pct_base}%)`,
    `- Match de CNPJ completo: **${matchedFull}** (${report.coverage.pct_full}%)`,
    `- Nome exato: **${report.agreement.pct_name_exact}%**`,
    `- Nome similar (≥ 80% de tokens): **${report.agreement.pct_name_similar}%**`,
    `- Situação: **${report.agreement.pct_situation}%**`,
    `- Data de abertura: **${report.agreement.pct_opening_date}%**`,
    `- CNAE: **${report.agreement.pct_cnae}%**`,
    `- UF: **${report.agreement.pct_uf}%**`,
    '',
    '> A base local é uma amostra de 50 mil estabelecimentos. O match mede apenas os registros presentes nessa amostra; não é uma taxa de cobertura nacional.',
    '> Diferenças de situação entre 2019 e 2026 são esperadas (mudança real de cadastro), não erro de chave.',
    '',
    '## Distribuição 2019',
    '',
    '### Situação',
    '',
    '| Código | Empresas |',
    '|---|---:|',
    ...top(bySituacao).map(([key, value]) => `| ${key} | ${value} |`),
    '',
    '### UF',
    '',
    '| UF | Empresas |',
    '|---|---:|',
    ...top(byUf).map(([key, value]) => `| ${key} | ${value} |`),
    '',
    '## Limitações',
    '',
    ...report.limitations.map((item) => `- ${item}`),
    '',
  ].join('\n');
  await writeFile(path.join(args.outDir, '2019-validacao.md'), md, 'utf8');

  console.log('\n[ok] relatório gerado em', jsonFile);
  console.log({
    sampled: samples.length,
    matchedFull,
    pctFull: report.coverage.pct_full,
    pctName: report.agreement.pct_name_exact,
    pctSituation: report.agreement.pct_situation,
    pctOpening: report.agreement.pct_opening_date,
    pctCnae: report.agreement.pct_cnae,
    pctUf: report.agreement.pct_uf,
  });

  await closeDatabase();
}

main().catch(async (error) => {
  console.error(error);
  await closeDatabase().catch(() => undefined);
  process.exit(1);
});
