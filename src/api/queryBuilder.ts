import { normalizeText } from '../lib/text.js';
import type { DashboardInput, SearchInput, StatsInput } from './schemas.js';

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
  socios: 'socios_count',
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
    const raw = filters.cnae.trim();
    const code = raw.replace(/[.\-/\s]/g, '');
    if (/^\d{4,7}$/.test(code)) {
      if (code.length === 7) {
        clauses.push(
          '(cnae_principal = $cnae OR list_contains(cnaes_secundarios, $cnae))',
        );
        params.cnae = code;
      } else {
        clauses.push('cnae_principal LIKE $cnae_prefix');
        params.cnae_prefix = `${code}%`;
      }
    } else {
      // Busca por nome: encontra os códigos no domínio de CNAE e aplica
      // tanto no CNAE principal quanto na lista de secundários.
      clauses.push(`(
        cnae_principal IN (
          SELECT codigo FROM dim_cnae WHERE descricao ILIKE $cnae_text
        )
        OR EXISTS (
          SELECT 1 FROM dim_cnae d
          WHERE d.descricao ILIKE $cnae_text
            AND list_contains(cnaes_secundarios, d.codigo)
        )
      )`);
      params.cnae_text = `%${raw}%`;
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

  if (filters.socios_min !== undefined) {
    clauses.push('socios_count >= $socios_min');
    params.socios_min = filters.socios_min;
  }

  if (filters.socios_max !== undefined) {
    clauses.push('socios_count <= $socios_max');
    params.socios_max = filters.socios_max;
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
  socios_count, opcao_simples, opcao_mei, matriz_filial_descricao, is_ativa, is_mais_3_anos
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
            count(*) FILTER (WHERE telefone1 IS NOT NULL AND telefone1 <> '') AS com_telefone,
            count(*) FILTER (WHERE socios_count > 0) AS com_socios
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

export interface DashboardQuery {
  sql: string;
  params: Record<string, unknown>;
}

export interface DashboardQueries {
  totais: DashboardQuery;
  situacoes: DashboardQuery;
  portes: DashboardQuery;
  ufs: DashboardQuery;
  cnaes: DashboardQuery;
  municipios: DashboardQuery;
  idades: DashboardQuery;
  capital: DashboardQuery;
  socios: DashboardQuery;
  aberturas: DashboardQuery;
}

export function buildDashboardQueries(filters: DashboardInput): DashboardQueries {
  const where = buildWhere(filters);
  const cte = `WITH filtrado AS (SELECT * FROM estabelecimentos_busca ${where.sql})`;
  const params = where.params;

  return {
    totais: {
      sql: `${cte},
        bases AS (
          SELECT cnpj_base,
                 max(socios_count) AS socios_count,
                 max(opcao_simples) AS opcao_simples,
                 max(opcao_mei) AS opcao_mei
          FROM filtrado
          GROUP BY 1
        )
        SELECT
          (SELECT count(*) FROM filtrado) AS estabelecimentos,
          (SELECT count(*) FROM bases) AS empresas,
          (SELECT coalesce(sum(socios_count), 0) FROM bases) AS socios,
          (SELECT count(*) FROM filtrado WHERE email IS NOT NULL AND email <> '') AS com_email,
          (SELECT count(*) FROM filtrado WHERE telefone1 IS NOT NULL AND telefone1 <> '') AS com_telefone,
          (SELECT count(*) FROM filtrado WHERE socios_count > 0) AS com_socios,
          (SELECT count(*) FROM bases WHERE opcao_simples = 'S') AS simples,
          (SELECT count(*) FROM bases WHERE opcao_mei = 'S') AS mei`,
      params,
    },
    situacoes: {
      sql: `${cte}
        SELECT situacao AS chave, any_value(situacao_descricao) AS rotulo, count(*) AS total
        FROM filtrado
        WHERE situacao IS NOT NULL AND situacao <> ''
        GROUP BY 1
        ORDER BY total DESC`,
      params,
    },
    portes: {
      sql: `${cte}
        SELECT porte AS chave, any_value(porte_descricao) AS rotulo, count(*) AS total
        FROM filtrado
        WHERE porte IS NOT NULL AND porte <> ''
        GROUP BY 1
        ORDER BY total DESC`,
      params,
    },
    ufs: {
      sql: `${cte}
        SELECT uf AS chave, uf AS rotulo, count(*) AS total
        FROM filtrado
        WHERE uf IS NOT NULL AND uf <> ''
        GROUP BY 1
        ORDER BY total DESC
        LIMIT 10`,
      params,
    },
    cnaes: {
      sql: `${cte}
        SELECT cnae_principal AS chave, any_value(cnae_descricao) AS rotulo, count(*) AS total
        FROM filtrado
        WHERE cnae_principal IS NOT NULL AND cnae_principal <> ''
        GROUP BY 1
        ORDER BY total DESC
        LIMIT 10`,
      params,
    },
    municipios: {
      sql: `${cte}
        SELECT municipio_codigo AS chave, any_value(municipio_nome) AS rotulo,
               any_value(uf) AS uf, count(*) AS total
        FROM filtrado
        WHERE municipio_codigo IS NOT NULL AND municipio_codigo <> ''
        GROUP BY 1
        ORDER BY total DESC
        LIMIT 10`,
      params,
    },
    idades: {
      sql: `${cte}
        SELECT
          CASE
            WHEN data_inicio IS NULL THEN 'Sem data'
            WHEN idade_anos < 1 THEN '0–1 ano'
            WHEN idade_anos < 3 THEN '1–3 anos'
            WHEN idade_anos < 5 THEN '3–5 anos'
            WHEN idade_anos < 10 THEN '5–10 anos'
            ELSE '10+ anos'
          END AS chave,
          count(*) AS total,
          CASE
            WHEN data_inicio IS NULL THEN 99
            WHEN idade_anos < 1 THEN 1
            WHEN idade_anos < 3 THEN 2
            WHEN idade_anos < 5 THEN 3
            WHEN idade_anos < 10 THEN 4
            ELSE 5
          END AS ordem
        FROM filtrado
        GROUP BY 1, 3
        ORDER BY 3`,
      params,
    },
    capital: {
      sql: `${cte}
        SELECT
          CASE
            WHEN capital_social IS NULL THEN 'Não informado'
            WHEN capital_social = 0 THEN 'R$ 0'
            WHEN capital_social <= 10000 THEN 'Até R$ 10 mil'
            WHEN capital_social <= 50000 THEN 'R$ 10–50 mil'
            WHEN capital_social <= 100000 THEN 'R$ 50–100 mil'
            WHEN capital_social <= 500000 THEN 'R$ 100–500 mil'
            WHEN capital_social <= 1000000 THEN 'R$ 500 mil–1 mi'
            ELSE 'Acima de R$ 1 mi'
          END AS chave,
          count(*) AS total,
          CASE
            WHEN capital_social IS NULL THEN 99
            WHEN capital_social = 0 THEN 1
            WHEN capital_social <= 10000 THEN 2
            WHEN capital_social <= 50000 THEN 3
            WHEN capital_social <= 100000 THEN 4
            WHEN capital_social <= 500000 THEN 5
            WHEN capital_social <= 1000000 THEN 6
            ELSE 7
          END AS ordem
        FROM filtrado
        GROUP BY 1, 3
        ORDER BY 3`,
      params,
    },
    socios: {
      sql: `${cte}
        SELECT
          CASE
            WHEN socios_count = 0 THEN '0'
            WHEN socios_count = 1 THEN '1'
            WHEN socios_count <= 3 THEN '2–3'
            WHEN socios_count <= 5 THEN '4–5'
            ELSE '6+'
          END AS chave,
          count(*) AS total,
          CASE
            WHEN socios_count = 0 THEN 1
            WHEN socios_count = 1 THEN 2
            WHEN socios_count <= 3 THEN 3
            WHEN socios_count <= 5 THEN 4
            ELSE 5
          END AS ordem
        FROM filtrado
        GROUP BY 1, 3
        ORDER BY 3`,
      params,
    },
    aberturas: {
      sql: `${cte}
        SELECT
          CASE
            WHEN date_part('year', data_inicio) >= 2015
              THEN cast(date_part('year', data_inicio) AS VARCHAR)
            ELSE 'Antes de 2015'
          END AS chave,
          count(*) AS total,
          CASE
            WHEN date_part('year', data_inicio) >= 2015
              THEN cast(date_part('year', data_inicio) AS INTEGER)
            ELSE 0
          END AS ordem
        FROM filtrado
        WHERE data_inicio IS NOT NULL
        GROUP BY 1, 3
        ORDER BY 3`,
      params,
    },
  };
}
