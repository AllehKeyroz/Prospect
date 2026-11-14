import { describe, expect, it } from 'vitest';
import {
  normalizeHistoryText,
  parseHistoricCompany,
  parseHistoricPartner,
  tokenSimilarity,
} from '../src/history/wayback2019.js';

function fixedLine(type: '1F ' | '2F '): string[] {
  const line = Array.from({ length: 1200 }, () => ' ');
  line.splice(0, 3, ...type.split(''));
  return line;
}

function put(line: string[], start: number, value: string): void {
  for (let index = 0; index < value.length; index++) line[start + index] = value[index];
}

describe('parser 2019 fixed-width', () => {
  it('lê empresa nos offsets validados', () => {
    const line = fixedLine('1F ');
    put(line, 3, '00000000000191');
    put(line, 17, '1');
    put(line, 18, 'BANCO DO BRASIL SA');
    put(line, 168, 'DIRECAO GERAL');
    put(line, 223, '022005110300');
    put(line, 363, '2038196608016422100');
    put(line, 674, '70040912');
    put(line, 682, 'DF9701BRASILIA');
    put(line, 886, '   10060000000');

    const record = parseHistoricCompany(line.join(''));
    expect(record).not.toBeNull();
    expect(record?.cnpj).toBe('00000000000191');
    expect(record?.razao_social).toBe('BANCO DO BRASIL SA');
    expect(record?.situacao).toBe('02');
    expect(record?.data_situacao).toBe('2005-11-03');
    expect(record?.natureza_juridica).toBe('2038');
    expect(record?.data_inicio).toBe('1966-08-01');
    expect(record?.cnae_principal).toBe('6422100');
    expect(record?.uf).toBe('DF');
    expect(record?.municipio_codigo).toBe('9701');
  });

  it('lê sócio e normaliza nome', () => {
    const line = fixedLine('2F ');
    put(line, 3, '00000000000191');
    put(line, 17, '2');
    put(line, 18, 'MARCIO HAMILTON FERREIRA');
    put(line, 168, '000***923641**');
    put(line, 182, '10');
    put(line, 200, 'ESTADOS UNIDOS');

    const record = parseHistoricPartner(line.join(''));
    expect(record?.nome_socio).toBe('MARCIO HAMILTON FERREIRA');
    expect(record?.cpf_cnpj_socio).toBe('000***923641**');
    expect(record?.pais).toBe('ESTADOS UNIDOS');
    expect(normalizeHistoryText('São José Ltda.')).toBe('sao jose ltda');
    expect(tokenSimilarity('COMERCIAL JOSE BARRETO LTDA', 'COMERCIAL JOSE BARRETO')).toBe(0.75);
  });
});
