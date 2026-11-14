import { describe, expect, it } from 'vitest';
import {
  cnpjBase,
  formatCnpj,
  isValidCnpj,
  normalizeCnpj,
} from '../src/lib/cnpj.js';
import { normalizeText } from '../src/lib/text.js';

describe('CNPJ', () => {
  it('normaliza pontuação e caixa', () => {
    expect(normalizeCnpj('12.ABC.345/01DE-35')).toBe('12ABC34501DE35');
    expect(normalizeCnpj('00.000.000/0001-91')).toBe('00000000000191');
  });

  it('formata CNPJ numérico e alfanumérico', () => {
    expect(formatCnpj('00000000000191')).toBe('00.000.000/0001-91');
    expect(formatCnpj('12ABC34501DE35')).toBe('12.ABC.345/01DE-35');
  });

  it('extrai a base', () => {
    expect(cnpjBase('12.ABC.345/01DE-35')).toBe('12ABC345');
  });

  it('valida CNPJ numérico', () => {
    expect(isValidCnpj('00.000.000/0001-91')).toBe(true);
    expect(isValidCnpj('00.000.000/0001-92')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);
  });

  it('valida CNPJ alfanumérico', () => {
    expect(isValidCnpj('00.000.000/E08G-12')).toBe(true);
    expect(isValidCnpj('12.ABC.345/01DE-35')).toBe(true);
    expect(isValidCnpj('12.ABC.345/01DE-36')).toBe(false);
  });
});

describe('normalizeText', () => {
  it('remove acentos, caixa e pontuação', () => {
    expect(normalizeText('São José  Ltda.')).toBe('sao jose ltda');
    expect(normalizeText('AÇÚCAR & Cia.')).toBe('acucar cia');
  });
});
