import { normalizeText } from '../lib/text.js';
import type { SearchInput, StatsInput } from './schemas.js';

export interface WhereResult {
  sql: string;
  params: Record<string, unknown>;
}

const SORT_MAP: Record<SearchInput['sort'], string> = {
  razao_social: 'razao_social',
  data_inicio: 'data_inicio',
  capital_social: 'capital_social',
  uf: 'uf',
  cnae: 'cnae_principal',
  situacao: 'situacao',
  idade: 'idade_anos',
};

function cutoffDate(years: number): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date.toISOString().slice(0, 10);
}

export function buildWhere(filters: Partial<SearchInput | StatsInput>): WhereResult {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters.cnpj) {
    if (filters.cnpj.length === 14) {
      clauses.push('cnpj = $cnpj');
      params.cnpj = filters.cnpj;
    } else if (filters.cnpj.length === 8) {
      clauses.push('cnpj_base = $cnpj_base');
      params.cnpj_base = filters.cnpj;
    }
  }

  if (filters.q) {
    const term = normalizeText(filters.q);
    if (term) {
      const ors = ['razao_social_busca LIKE $q', 'nome_fantasia_busca LIKE $q'];
      params.q = `%${term}%`;

      const digits = filters.q.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
      if (digits.length === 14) {
        ors.push('cnpj = $q_cnpj');
        params.q_cnpj = digits;
      } else if (digits.length >= 8) {
        ors.push('cnpj LIKE $q_cnpj_prefix');
        params.q_cnpj_prefix = `${digits}%`;
      }
      clauses.push(`(${ors.join(' OR ')})`);
    }
  }

  if (filters.uf) {
    clauses.push('uf = $uf');
    params.uf = filters.uf;
  }

  if (filters.municipio) {
    if (/^\d{4}$/.test(filters.municipio)) {
      clauses.push('municipio_codigo = $municipio');
      params.municipio = filters.municipio;
    } else {
      clauses.push('municipio_nome ILIKE $municipio_like');
      params.municipio_like = `%${filters.municipio}%`;
    }
  }

  if (filters.cnae) {
    if (filters.cnae.length === 7) {
      clauses.push(
        '(cnae_principal = $cnae OR list_contains(cnaes_secundarios, $cnae))',
      );
      params.cnae = filters.cnae;
    } else {
      clauses.push('cnae_principal LIKE $cnae_prefix');
      params.cnae_prefix = `${filters.cnae}%`;
    }
  }

  if (filters.situacao) {
    clauses.push('situacao = $situacao');
    params.situacao = filters.situacao;
  }

  if (filters.porte) {
    clauses.push('porte = $porte');
    params.porte = filters.porte;
  }

  if (filters.natureza) {
    clauses.push('natureza_juridica = $natureza');
    params.natureza = filters.natureza;
  }

  if (filters.idade_min !== undefined) {
    clauses.push('data_inicio IS NOT NULL AND data_inicio <= $idade_min_cutoff');
    params.idade_min_cutoff = cutoffDate(filters.idade_min);
  }

  if (filters.idade_max !== undefined) {
    clauses.push('data_inicio IS NOT NULL AND data_inicio >= $idade_max_cutoff');
    params.idade_max_cutoff = cutoffDate(filters.idade_max);
  }

  if (filters.capital_min !== undefined) {
    clauses.push('capital_social >= $capital_min');
    params.capital_min = filters.capital_min;
  }

  if (filters.capital_max !== undefined) {
    clauses.push('capital_social <= $capital_max');
    params.capital_max = filters.capital_max;
  }

  if (filters.simples !== undefined) {
    clauses.push('opcao_simples = $simples');
    params.simples = filters.simples ? 'S' : 'N';
  }

  if (filters.mei !== undefined) {
    clauses.push('opcao_mei = $mei');
    params.mei = filters.mei ? 'S' : 'N';
  }

  if (filters.com_email) {
    clauses.push("email IS NOT NULL AND email <> ''");
  }

  if (filters.com_telefone) {
    clauses.push(
      "((telefone1 IS NOT NULL AND telefone1 <> '') OR (telefone2 IS NOT NULL AND telefone2 <> ''))",
    );
  }

  if (filters.matriz) {
    clauses.push("matriz_filial = '1'");
  }

  return {
    sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

export const LIST_COLUMNS = `
  cnpj, cnpj_base, razao_social, nome_fantasia,
  situacao, situacao_descricao, data_inicio, idade_anos,
  cnae_principal, cnae_descricao, uf, municipio_codigo, municipio_nome,
  bairro, cep, logradouro, numero, email, ddd1, telefone1, ddd2, telefone2,
  capital_social, porte, porte_descricao, natureza_juridica, natureza_descricao,
  opcao_simples, opcao_mei, matriz_filial_descricao, is_ativa, is_mais_3_anos
`;

export function buildListQuery(filters: SearchInput): WhereResult {
  const where = buildWhere(filters);
  const sortColumn = SORT_MAP[filters.sort];
  const direction = filters.order === 'desc' ? 'DESC' : 'ASC';
  const offset = (filters.page - 1) * filters.page_size;
  const orderBy =
    filters.sort === 'razao_social'
      ? `(razao_social = '') ASC, razao_social ${direction} NULLS LAST, cnpj ASC`
      : `${sortColumn} ${direction} NULLS LAST, cnpj ASC`;

  return {
    sql: `SELECT ${LIST_COLUMNS}
          FROM estabelecimentos_busca
          ${where.sql}
          ORDER BY ${orderBy}
          LIMIT $limit OFFSET $offset`,
    params: {
      ...where.params,
      limit: filters.page_size,
      offset,
    },
  };
}

export function buildCountQuery(filters: SearchInput): WhereResult {
  const where = buildWhere(filters);
  return {
    sql: `SELECT count(*) AS total FROM estabelecimentos_busca ${where.sql}`,
    params: where.params,
  };
}

export function buildResumoQuery(filters: SearchInput): WhereResult {
  const where = buildWhere(filters);
  return {
    sql: `SELECT
            count(*) AS total,
            count(*) FILTER (WHERE is_ativa) AS ativas,
            count(*) FILTER (WHERE is_mais_3_anos) AS mais_3_anos,
            count(*) FILTER (WHERE email IS NOT NULL AND email <> '') AS com_email,
            count(*) FILTER (WHERE telefone1 IS NOT NULL AND telefone1 <> '') AS com_telefone
          FROM estabelecimentos_busca
          ${where.sql}`,
    params: where.params,
  };
}

const GROUP_MAP: Record<
  StatsInput['group_by'],
  { key: string; label: string }
> = {
  uf: { key: 'uf', label: 'uf' },
  cnae: { key: 'cnae_principal', label: 'any_value(cnae_descricao)' },
  situacao: { key: 'situacao', label: 'any_value(situacao_descricao)' },
  porte: { key: 'porte', label: 'any_value(porte_descricao)' },
  municipio: { key: 'municipio_codigo', label: 'any_value(municipio_nome)' },
  natureza: { key: 'natureza_juridica', label: 'any_value(natureza_descricao)' },
};

export function buildStatsQuery(filters: StatsInput): WhereResult {
  const where = buildWhere(filters);
  const group = GROUP_MAP[filters.group_by];
  return {
    sql: `SELECT ${group.key} AS chave, ${group.label} AS rotulo, count(*) AS total
          FROM estabelecimentos_busca
          ${where.sql}
          GROUP BY 1
          ORDER BY total DESC
          LIMIT $limit`,
    params: { ...where.params, limit: filters.limit },
  };
}

export function toSearchInput(filters: Omit<SearchInput, 'page' | 'page_size' | 'sort' | 'order'> & {
  page?: number;
  page_size?: number;
  sort?: SearchInput['sort'];
  order?: SearchInput['order'];
}): SearchInput {
  return {
    ...filters,
    page: filters.page ?? 1,
    page_size: filters.page_size ?? 50,
    sort: filters.sort ?? 'razao_social',
    order: filters.order ?? 'asc',
  };
}
