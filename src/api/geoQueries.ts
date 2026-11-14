import { buildWhere, type WhereResult } from './queryBuilder.js';
import type { MapaInput, MercadoInput, TimelineInput } from './schemas.js';

export interface GeoQuery {
  sql: string;
  params: Record<string, unknown>;
}

function withCondition(where: WhereResult, condition: string): WhereResult {
  return {
    sql: where.sql ? `${where.sql} AND ${condition}` : `WHERE ${condition}`,
    params: where.params,
  };
}

export function buildMapQuery(filters: MapaInput): GeoQuery {
  const where = buildWhere(filters);
  let key: string;
  let name: string;
  let uf: string;
  let regiao: string;
  let condition: string;

  if (filters.nivel === 'regiao') {
    key = 'regiao';
    name = 'regiao';
    uf = "''";
    regiao = 'regiao';
    condition = "regiao IS NOT NULL AND regiao <> ''";
  } else if (filters.nivel === 'municipio') {
    key = 'municipio_ibge';
    name = 'any_value(municipio_nome)';
    uf = 'any_value(uf)';
    regiao = 'any_value(regiao)';
    condition = "municipio_ibge IS NOT NULL AND municipio_ibge <> ''";
  } else {
    key = 'uf';
    name = 'uf';
    uf = 'uf';
    regiao = 'any_value(regiao)';
    condition = "uf IS NOT NULL AND uf <> ''";
  }

  const scoped = withCondition(where, condition);
  return {
    sql: `SELECT
            ${key} AS codigo,
            ${name} AS nome,
            ${uf} AS uf,
            ${regiao} AS regiao,
            count(*) AS estabelecimentos,
            count(*) FILTER (WHERE is_ativa) AS ativas,
            count(*) FILTER (
              WHERE data_inicio >= current_date - INTERVAL 12 MONTH
            ) AS aberturas_12m,
            count(*) FILTER (
              WHERE situacao IN ('08', '04')
                AND data_situacao >= current_date - INTERVAL 12 MONTH
            ) AS fechamentos_12m,
            count(*) FILTER (WHERE opcao_simples = 'S') AS simples,
            count(*) FILTER (WHERE opcao_mei = 'S') AS mei,
            count(*) FILTER (WHERE email IS NOT NULL AND email <> '') AS com_email,
            count(*) FILTER (
              WHERE telefone1 IS NOT NULL AND telefone1 <> ''
            ) AS com_telefone,
            avg(idade_anos) AS idade_media,
            median(capital_social) AS capital_mediano
          FROM estabelecimentos_busca
          ${scoped.sql}
          GROUP BY 1
          ORDER BY estabelecimentos DESC`,
    params: scoped.params,
  };
}

function territoryCondition(filters: MercadoInput | TimelineInput): WhereResult | null {
  if (!filters.nivel || !filters.codigo) return null;
  if (filters.nivel === 'regiao') {
    return {
      sql: 'WHERE regiao = $territorio',
      params: { territorio: filters.codigo },
    };
  }
  if (filters.nivel === 'uf') {
    return {
      sql: 'WHERE uf = $territorio',
      params: { territorio: filters.codigo },
    };
  }
  return {
    sql: 'WHERE municipio_ibge = $territorio',
    params: { territorio: filters.codigo },
  };
}

function mergeWhere(base: WhereResult, extra: WhereResult | null): WhereResult {
  if (!extra) return base;
  const baseSql = base.sql.replace(/^WHERE\s+/, '');
  const extraSql = extra.sql.replace(/^WHERE\s+/, '');
  const sql = [baseSql, extraSql].filter(Boolean).join(' AND ');
  return {
    sql: sql ? `WHERE ${sql}` : '',
    params: { ...base.params, ...extra.params },
  };
}

export function buildTimelineQuery(filters: TimelineInput): GeoQuery {
  // O gráfico de nascimentos/fechamentos é histórico: não aplicamos o filtro
  // de situação nem de idade, senão as empresas fechadas desapareceriam.
  const { situacao: _situacao, idade_min: _idadeMin, idade_max: _idadeMax, ...timelineFilters } =
    filters;
  const base = buildWhere(timelineFilters);
  const territory = territoryCondition(filters);
  const where = mergeWhere(base, territory);
  const month = filters.granularidade === 'mes';
  const period = month
    ? "strftime(data_inicio, '%Y-%m')"
    : 'cast(date_part(\'year\', data_inicio) AS INTEGER)';
  const periodClose = month
    ? "strftime(data_situacao, '%Y-%m')"
    : 'cast(date_part(\'year\', data_situacao) AS INTEGER)';

  return {
    sql: `WITH filtrado AS (
            SELECT * FROM estabelecimentos_busca ${where.sql}
          ),
          nascimentos AS (
            SELECT ${period} AS periodo, count(*) AS nascimentos, 0 AS fechamentos
            FROM filtrado
            WHERE data_inicio IS NOT NULL
            GROUP BY 1
          ),
          fechamentos AS (
            SELECT ${periodClose} AS periodo, 0 AS nascimentos, count(*) AS fechamentos
            FROM filtrado
            WHERE data_situacao IS NOT NULL
              AND situacao IN ('08', '04')
            GROUP BY 1
          ),
          uniao AS (
            SELECT * FROM nascimentos
            UNION ALL
            SELECT * FROM fechamentos
          )
          SELECT periodo,
                 sum(nascimentos) AS nascimentos,
                 sum(fechamentos) AS fechamentos
          FROM uniao
          GROUP BY 1
          ORDER BY 1`,
    params: where.params,
  };
}

export function buildMarketQueries(filters: MercadoInput): {
  totais: GeoQuery;
  hhi: GeoQuery;
  players: GeoQuery;
  cnaes: GeoQuery;
  timeline: GeoQuery;
} {
  const base = buildWhere(filters);
  const territory = territoryCondition(filters);
  const where = mergeWhere(base, territory);
  const cte = `WITH filtrado AS (SELECT * FROM estabelecimentos_busca ${where.sql})`;
  const params = where.params;

  return {
    totais: {
      sql: `${cte}
        SELECT
          count(*) AS estabelecimentos,
          count(*) FILTER (WHERE is_ativa) AS ativas,
          count(*) FILTER (
            WHERE data_inicio >= current_date - INTERVAL 12 MONTH
          ) AS aberturas_12m,
          count(*) FILTER (
            WHERE situacao IN ('08', '04')
              AND data_situacao >= current_date - INTERVAL 12 MONTH
          ) AS fechamentos_12m,
          avg(idade_anos) AS idade_media,
          median(capital_social) AS capital_mediano,
          count(*) FILTER (WHERE opcao_simples = 'S') AS simples,
          count(*) FILTER (WHERE opcao_mei = 'S') AS mei,
          count(*) FILTER (WHERE email IS NOT NULL AND email <> '') AS com_email,
          count(*) FILTER (
            WHERE telefone1 IS NOT NULL AND telefone1 <> ''
          ) AS com_telefone
        FROM filtrado`,
      params,
    },
    hhi: {
      sql: `${cte},
        players AS (
          SELECT cnpj_base, count(*) AS n
          FROM filtrado
          GROUP BY 1
        ),
        total AS (
          SELECT sum(n) AS total FROM players
        )
        SELECT
          CASE
            WHEN total.total > 0
              THEN sum(power(players.n * 1.0 / total.total, 2)) * 10000
            ELSE NULL
          END AS hhi
        FROM players, total
        GROUP BY total.total`,
      params,
    },
    players: {
      sql: `${cte}
        SELECT
          cnpj_base,
          any_value(razao_social) AS razao_social,
          count(*) AS estabelecimentos,
          any_value(capital_social) AS capital_social,
          any_value(uf) AS uf,
          any_value(municipio_nome) AS municipio_nome,
          any_value(situacao_descricao) AS situacao_descricao
        FROM filtrado
        GROUP BY 1
        ORDER BY estabelecimentos DESC, razao_social ASC
        LIMIT 10`,
      params,
    },
    cnaes: {
      sql: `${cte}
        SELECT
          cnae_principal,
          any_value(cnae_descricao) AS cnae_descricao,
          count(*) AS total
        FROM filtrado
        WHERE cnae_principal IS NOT NULL AND cnae_principal <> ''
        GROUP BY 1
        ORDER BY total DESC
        LIMIT 10`,
      params,
    },
    timeline: buildTimelineQuery({ ...filters, granularidade: 'ano' }),
  };
}
