/**
 * Normaliza um CNPJ para busca: remove pontuação e coloca em maiúsculas.
 * O CNPJ alfanumérico (em produção desde 31/07/2026) pode conter A-Z nas
 * 12 primeiras posições. Nunca converta para número.
 */
export function normalizeCnpj(input: string): string {
  return input.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

export function cnpjBase(cnpj: string): string {
  return normalizeCnpj(cnpj).slice(0, 8);
}

export function formatCnpj(input: string): string {
  const cnpj = normalizeCnpj(input);
  if (cnpj.length !== 14) return input;
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}

export function formatCnpjBase(input: string): string {
  const base = normalizeCnpj(input);
  if (base.length !== 8) return input;
  return `${base.slice(0, 2)}.${base.slice(2, 5)}.${base.slice(5, 8)}`;
}

function charValue(char: string): number {
  // Regra oficial: valor = código ASCII - 48.
  return char.charCodeAt(0) - 48;
}

function dv(digits: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += charValue(digits[i]) * weights[i];
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/**
 * Valida CNPJ numérico e alfanumérico (dígitos verificadores numéricos).
 */
export function isValidCnpj(input: string): boolean {
  const cnpj = normalizeCnpj(input);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj)) return false;
  if (/^0{14}$/.test(cnpj)) return false;

  const first = dv(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (first !== Number(cnpj[12])) return false;

  const second = dv(
    cnpj.slice(0, 13),
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  );
  return second === Number(cnpj[13]);
}
