/**
 * Layout do pacote histórico de 2019 (DADOS_ABERTOS_CNPJ_01..20.zip).
 *
 * Cada linha tem 1.200 caracteres e começa com o tipo do registro:
 *   1F  empresa/estabelecimento
 *   2F  sócio
 *
 * O layout é fixed-width e não tem cabeçalho. Os offsets abaixo foram
 * verificados contra o registro do Banco do Brasil (CNPJ 00.000.000/0001-91)
 * e devem ser tratados como contrato da fonte, não como CSV moderno.
 */
export const WAYBACK_2019_BASE =
  'https://web.archive.org/web/20190925224057id_/http://200.152.38.155/CNPJ/';

export const WAYBACK_2019_FILE_COUNT = 20;

export function wayback2019FileName(index: number): string {
  return `DADOS_ABERTOS_CNPJ_${String(index).padStart(2, '0')}.zip`;
}

export function wayback2019Url(index: number): string {
  return `${WAYBACK_2019_BASE}${wayback2019FileName(index)}`;
}

export interface HistoricCompany {
  cnpj: string;
  cnpj_base: string;
  matriz_filial: string;
  razao_social: string;
  nome_fantasia: string;
  situacao: string;
  data_situacao: string | null;
  motivo: string;
  natureza_juridica: string;
  data_inicio: string | null;
  cnae_principal: string;
  cep: string;
  uf: string;
  municipio_codigo: string;
  municipio_nome: string;
  capital_social: string;
}

export interface HistoricPartner {
  cnpj_base: string;
  identificador: string;
  nome_socio: string;
  cpf_cnpj_socio: string;
  qualificacao_socio: string;
  pais: string;
}

function compactDate(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 8 || digits === '00000000') return null;
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function clean(value: string): string {
  return value.replace(/\0/g, '').trim();
}

export function parseHistoricCompany(line: string): HistoricCompany | null {
  if (line.length < 400 || !line.startsWith('1F ')) return null;
  const cnpj = clean(line.slice(3, 17));
  if (!/^[0-9A-Z]{14}$/.test(cnpj)) return null;
  return {
    cnpj,
    cnpj_base: cnpj.slice(0, 8),
    matriz_filial: clean(line.slice(17, 18)),
    razao_social: clean(line.slice(18, 168)),
    nome_fantasia: clean(line.slice(168, 223)),
    situacao: clean(line.slice(223, 225)),
    data_situacao: compactDate(line.slice(225, 233)),
    motivo: clean(line.slice(233, 235)),
    natureza_juridica: clean(line.slice(363, 367)),
    data_inicio: compactDate(line.slice(367, 375)),
    cnae_principal: clean(line.slice(375, 382)),
    cep: clean(line.slice(674, 682)),
    uf: clean(line.slice(682, 684)),
    municipio_codigo: clean(line.slice(684, 688)),
    municipio_nome: clean(line.slice(688, 700)),
    capital_social: clean(line.slice(886, 900)),
  };
}

export function parseHistoricPartner(line: string): HistoricPartner | null {
  if (line.length < 300 || !line.startsWith('2F ')) return null;
  const cnpj = clean(line.slice(3, 17));
  if (!/^[0-9A-Z]{14}$/.test(cnpj)) return null;
  return {
    cnpj_base: cnpj.slice(0, 8),
    identificador: clean(line.slice(17, 18)),
    nome_socio: clean(line.slice(18, 168)),
    cpf_cnpj_socio: clean(line.slice(168, 182)),
    qualificacao_socio: clean(line.slice(182, 184)),
    pais: clean(line.slice(200, 220)),
  };
}

export function normalizeHistoryText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokenSimilarity(a: string, b: string): number {
  const left = new Set(normalizeHistoryText(a).split(' ').filter(Boolean));
  const right = new Set(normalizeHistoryText(b).split(' ').filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection++;
  return intersection / Math.max(left.size, right.size);
}
