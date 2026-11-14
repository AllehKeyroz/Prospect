import { describe, expect, it } from 'vitest';
import {
  buildCountQuery,
  buildListQuery,
  buildResumoQuery,
  buildStatsQuery,
  buildWhere,
} from '../src/api/queryBuilder.js';
import type { SearchInput, StatsInput } from '../src/api/schemas.js';

const baseFilters: SearchInput = {
  page: 1,
  page_size: 25,
  sort: 'razao_social',
  order: 'asc',
};

describe('buildWhere', () => {
  it('combina filtros principais', () => {
    const result = buildWhere({
      ...baseFilters,
      cnpj: '00000000000191',
      uf: 'SP',
      cnae: '5611201',
      situacao: '02',
      idade_min: 3,
      simples: true,
      com_email: true,
    });

    expect(result.sql).toContain('cnpj = $cnpj');
    expect(result.sql).toContain('uf = $uf');
    expect(result.sql).toContain('cnae_principal = $cnae');
    expect(result.sql).toContain('list_contains(cnaes_secundarios, $cnae)');
    expect(result.sql).toContain('situacao = $situacao');
    expect(result.sql).toContain('data_inicio <= $idade_min_cutoff');
    expect(result.sql).toContain('opcao_simples = $simples');
    expect(result.sql).toContain("email IS NOT NULL AND email <> ''");
    expect(result.params).toMatchObject({
      cnpj: '00000000000191',
      uf: 'SP',
      cnae: '5611201',
      situacao: '02',
      simples: 'S',
    });
  });

  it('busca por nome e CNPJ', () => {
    const result = buildWhere({
      ...baseFilters,
      q: 'Padaria São José',
    });
    expect(result.sql).toContain('razao_social_busca LIKE $q');
    expect(result.sql).toContain('nome_fantasia_busca LIKE $q');
    expect(result.params.q).toBe('%padaria sao jose%');
  });

  it('filtra por base de CNPJ', () => {
    const result = buildWhere({ ...baseFilters, cnpj: '00000000' });
    expect(result.sql).toContain('cnpj_base = $cnpj_base');
  });
});

describe('query builders', () => {
  it('monta listagem com paginação e ordenação', () => {
    const query = buildListQuery({ ...baseFilters, page: 2, page_size: 10 });
    expect(query.sql).toContain('FROM estabelecimentos_busca');
    expect(query.sql).toContain("ORDER BY (razao_social = '') ASC");
    expect(query.sql).toContain('LIMIT $limit OFFSET $offset');
    expect(query.params).toMatchObject({ limit: 10, offset: 10 });
  });

  it('monta contagem e resumo', () => {
    const count = buildCountQuery(baseFilters);
    const resumo = buildResumoQuery(baseFilters);
    expect(count.sql).toContain('count(*) AS total');
    expect(resumo.sql).toContain('count(*) FILTER (WHERE is_ativa)');
    expect(resumo.sql).toContain('mais_3_anos');
  });

  it('monta estatísticas por CNAE', () => {
    const stats: StatsInput = {
      ...baseFilters,
      group_by: 'cnae',
      limit: 5,
    };
    const query = buildStatsQuery(stats);
    expect(query.sql).toContain('cnae_principal AS chave');
    expect(query.sql).toContain('GROUP BY 1');
    expect(query.params).toMatchObject({ limit: 5 });
  });
});
