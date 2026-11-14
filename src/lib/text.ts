/**
 * Normalização de texto para busca: minúsculas, sem acentos e sem pontuação.
 * O mesmo critério é usado na coluna `*_busca` do DuckDB.
 */
export function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function onlyDigits(input: string): string {
  return input.replace(/\D+/g, '');
}

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n\r;]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsvLine(values: unknown[], delimiter = ','): string {
  return values.map(csvEscape).join(delimiter);
}

export function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  return ['1', 'true', 'sim', 'yes', 'on'].includes(value.toLowerCase());
}
