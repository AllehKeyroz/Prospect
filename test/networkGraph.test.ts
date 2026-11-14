import { describe, expect, it } from 'vitest';
import { buildCompanyGraph, buildHubGraph } from '../src/api/networkGraph.js';
import type {
  ContactCompanyRow,
  ContactRow,
  NetworkCompanyRow,
  PartnerCompanyRow,
  TargetPartnerRow,
} from '../src/api/networkQueries.js';

const target: NetworkCompanyRow = {
  cnpj_base: '11111111',
  cnpj: '11111111000111',
  razao_social: 'EMPRESA ALVO LTDA',
  nome_fantasia: 'ALVO',
  uf: 'SP',
  municipio_codigo: '7107',
  municipio_nome: 'SAO PAULO',
  municipio_ibge: '3550308',
  situacao: '02',
  situacao_descricao: 'Ativa',
  data_inicio: '2010-01-01',
  idade_anos: '16',
  capital_social: '100000.00',
};

const partner: TargetPartnerRow = {
  partner_key: '***123456**',
  cpf_cnpj_socio: '***123456**',
  nome_socio: 'JOAO DA SILVA',
  nome_socio_busca: 'joao da silva',
  qualificacao_socio: '49',
  qualificacao_socio_descricao: 'Sócio',
  empresas_count: 1,
};

function partnerCompany(base: string, name: string): PartnerCompanyRow {
  return {
    ...target,
    cnpj_base: base,
    cnpj: `${base}0001${'0'.repeat(2)}`,
    razao_social: name,
    partner_key: partner.partner_key,
    cpf_cnpj_socio: partner.cpf_cnpj_socio,
    nome_socio: partner.nome_socio,
    nome_socio_busca: partner.nome_socio_busca,
    qualificacao_socio: partner.qualificacao_socio,
    qualificacao_socio_descricao: partner.qualificacao_socio_descricao,
  };
}

const email: ContactRow = {
  tipo: 'email',
  valor: 'contato@contabilidade.com.br',
  rotulo: 'contato@contabilidade.com.br',
  outras: 4,
};

function contactCompany(base: string, name: string): ContactCompanyRow {
  return {
    ...target,
    cnpj_base: base,
    cnpj: `${base}0001${'0'.repeat(2)}`,
    razao_social: name,
    tipo: 'email',
    valor: email.valor,
  };
}

const limits = {
  partnerLimit: 8,
  partnerCompanyLimit: 8,
  contactLimit: 5,
  contactCompanyLimit: 6,
  hubMin: 5,
};

describe('buildCompanyGraph', () => {
  it('cria nós de empresa, sócio e hub de e-mail com arestas tipadas', () => {
    const graph = buildCompanyGraph({
      target,
      partners: [partner],
      partnerCompanies: [partnerCompany('22222222', 'OUTRA EMPRESA LTDA')],
      contacts: [email],
      contactCompanies: [contactCompany('33333333', 'CLIENTE DA CONTABILIDADE LTDA')],
      limits,
    });

    expect(graph.nodes.find((node) => node.id === 'empresa:11111111')?.central).toBe(true);
    expect(graph.nodes.find((node) => node.id === 'socio:***123456**')?.tipo).toBe('socio');
    const emailNode = graph.nodes.find((node) => node.id === `email:${email.valor}`);
    expect(emailNode?.hub).toBe(true);
    expect(emailNode?.ocorrencias).toBe(5);
    expect(graph.edges.some((edge) => edge.tipo === 'socio_de')).toBe(true);
    expect(graph.edges.some((edge) => edge.tipo === 'mesmo_email')).toBe(true);
    expect(graph.empresas).toHaveLength(3);
  });

  it('monta grafo de hub sem partir de um CNPJ', () => {
    const graph = buildHubGraph({
      tipo: 'email',
      valor: email.valor,
      rotulo: email.rotulo ?? email.valor,
      total: 5,
      companies: [
        { ...target, cnpj_base: '11111111' },
        { ...target, cnpj_base: '22222222', razao_social: 'OUTRA EMPRESA LTDA' },
      ],
    });

    expect(graph.nodes[0].hub).toBe(true);
    expect(graph.nodes[0].central).toBe(true);
    expect(graph.edges.every((edge) => edge.tipo === 'mesmo_email')).toBe(true);
    expect(graph.empresas).toHaveLength(2);
  });

  it('deduplica empresas que aparecem por mais de uma relação', () => {
    const graph = buildCompanyGraph({
      target,
      partners: [partner],
      partnerCompanies: [partnerCompany('22222222', 'OUTRA EMPRESA LTDA')],
      contacts: [email],
      contactCompanies: [contactCompany('22222222', 'OUTRA EMPRESA LTDA')],
      limits,
    });

    const company = graph.nodes.find((node) => node.id === 'empresa:22222222');
    expect(company?.relacoes).toEqual(expect.arrayContaining(['socio', 'e-mail']));
    expect(graph.empresas.filter((item) => item.cnpj_base === '22222222')).toHaveLength(1);
  });
});
