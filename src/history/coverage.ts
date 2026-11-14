import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export type CoverageLayer =
  | 'oficial'
  | 'validado'
  | 'espelho'
  | 'reconstruido'
  | 'parcial'
  | 'sem_fonte';

export interface CoverageRange {
  id: string;
  periodo: string;
  camada: CoverageLayer;
  fonte: string;
  campos: string;
  observacao: string;
}

export const HISTORICAL_COVERAGE: CoverageRange[] = [
  {
    id: '2000-2018',
    periodo: '2000–2018',
    camada: 'reconstruido',
    fonte: 'Snapshot atual (datas de abertura/fechamento)',
    campos: 'Existência, abertura, fechamento, idade; estado atual de CNAE/endereço/sócios',
    observacao:
      'Foto aproximada, não retrato oficial da época. Empresas removidas da base atual podem faltar.',
  },
  {
    id: '2019',
    periodo: '2019',
    camada: 'validado',
    fonte: 'Wayback — DADOS_ABERTOS_CNPJ_01..20',
    campos: 'Retrato cadastral do momento da captura, após validação por amostragem',
    observacao: 'Pacote em validação contra o snapshot oficial; não sobrescreve a fonte oficial.',
  },
  {
    id: '2020',
    periodo: '2020',
    camada: 'parcial',
    fonte: 'Wayback — captura parcial do arquivo 01',
    campos: 'Apenas o subconjunto capturado',
    observacao: 'Cobertura incompleta; usar como complemento, nunca como série contínua.',
  },
  {
    id: '2021-2022',
    periodo: '2021–2022',
    camada: 'sem_fonte',
    fonte: 'Wayback — metadados de diretório, ZIPs 404',
    campos: 'Sem conteúdo recuperável no Wayback',
    observacao: 'Existem nomes/tamanhos de arquivos, mas não há captura do conteúdo.',
  },
  {
    id: '2023-03-04',
    periodo: '2023-03 a 2023-04',
    camada: 'espelho',
    fonte: 'Espelho Casa dos Dados',
    campos: 'Retrato cadastral; validar antes de tratar como oficial',
    observacao: 'Fonte secundária; o oficial começa em 2023-05.',
  },
  {
    id: '2023-05-2026-10',
    periodo: '2023-05 a 2026-10',
    camada: 'oficial',
    fonte: 'Receita Federal — arquivos mensais',
    campos: 'Retrato completo do snapshot mensal',
    observacao: 'Fonte autoritativa para change log e reconstrução point-in-time.',
  },
];

export interface ValidationReport {
  generated_at?: string;
  archive?: string;
  sample_size?: number;
  metrics?: Record<string, unknown>;
  notes?: string[];
}

export function readValidationReport(): ValidationReport | null {
  const file = path.resolve('docs/historico/2019-validacao.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as ValidationReport;
  } catch {
    return null;
  }
}

export function coveragePayload() {
  return {
    snapshot: config.snapshot,
    ranges: HISTORICAL_COVERAGE,
    validation: readValidationReport(),
    generated_at: new Date().toISOString(),
  };
}
