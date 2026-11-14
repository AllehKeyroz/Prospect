import { describe, expect, it } from 'vitest';
import { buildPassport } from '../src/api/passport.js';

const rede = {
  socios: 2,
  empresas_via_socios: 5,
  contatos: 3,
  empresas_via_contatos: 4,
  hubs: 1,
};

describe('buildPassport', () => {
  it('monta fatos e eventos oficiais a partir do snapshot', () => {
    const passport = buildPassport({
      empresa: { capital_social: '250000.00' },
      estabelecimentos: [
        {
          cnpj: '00000000000191',
          matriz_filial: '1',
          data_inicio: '1998-03-10',
          data_situacao: '2020-01-15',
          situacao_descricao: 'Ativa',
          idade_anos: '28',
          municipio_nome: 'SAO PAULO',
          uf: 'SP',
          email: 'contato@empresa.com.br',
          ddd1: '11',
          telefone1: '999999999',
        },
      ],
      socios: [
        {
          nome_socio: 'MARIA SOUZA',
          qualificacao_socio_descricao: 'Sócia',
          data_entrada: '1998-03-10',
        },
      ],
      simples: { opcao_simples: 'S', data_opcao_simples: '2010-01-01' },
      rede,
      snapshot: '2026-10',
    });

    expect(passport.cobertura.snapshot).toBe('2026-10');
    expect(passport.fatos.find((fact) => fact.id === 'capital')?.valor).toBe(250000);
    expect(passport.fatos.find((fact) => fact.id === 'socios')?.valor).toBe(1);
    expect(passport.eventos.map((event) => event.tipo)).toEqual([
      'abertura',
      'socio',
      'simples',
      'situacao',
    ]);
    expect(passport.rede_resumo).toEqual(rede);
  });

  it('não duplica eventos idênticos e lida com empresa sem datas', () => {
    const passport = buildPassport({
      empresa: null,
      estabelecimentos: [{ matriz_filial: '1' }],
      socios: [
        { nome_socio: 'A', data_entrada: null },
        { nome_socio: 'A', data_entrada: null },
      ],
      simples: null,
      rede,
      snapshot: '2026-10',
    });

    expect(passport.eventos).toHaveLength(0);
    expect(passport.fatos.find((fact) => fact.id === 'situacao')?.valor).toBe('Não informada');
  });
});
