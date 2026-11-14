import { query } from '../db/duckdb.js';
import {
  CONTACT_TYPES,
  EMPRESA_RANK_SQL,
  type ContactType,
  type NetworkCompanyRow,
} from './networkQueries.js';

export interface HubListInput {
  tipo: ContactType;
  minEmpresas: number;
  uf?: string;
  cnae?: string;
  q?: string;
  limit: number;
  offset: number;
}

export interface HubRow {
  tipo: ContactType;
  valor: string;
  rotulo: string | null;
  empresas: number | string;
  ufs: number | string;
  cnaes: number | string;
  ativas: number | string;
  capital_somado: number | string | null;
  idade_media: number | string | null;
  exemplo_razao_social: string | null;
  exemplo_cnpj_base: string | null;
  exemplo_uf: string | null;
  exemplo_cnae: string | null;
}

export interface HubSummary {
  tipo: ContactType;
  valor: string;
  rotulo: string;
  empresas: number;
  ufs: number;
  cnaes: number;
  ativas: number;
  capital_somado: number | null;
  idade_media: number | null;
}

function paramsFor(filters: HubListInput): Record<string, unknown> {
  return {
    tipo: filters.tipo,
    min: filters.minEmpresas,
    limit: filters.limit,
    offset: filters.offset,
    uf: filters.uf ?? '',
    cnae: filters.cnae ?? '',
    cnaePrefix: filters.cnae ? `${filters.cnae}%` : '',
    q: filters.q ?? '',
    qLike: filters.q ? `%${filters.q}%` : '%',
  };
}

const HUB_BASE_SQL = `
  WITH base AS (
    SELECT
      rc.tipo,
      rc.valor,
      rc.cnpj_base,
      any_value(rc.rotulo) AS rotulo,
      any_value(b.razao_social) AS razao_social,
      any_value(b.uf) AS uf,
      any_value(b.cnae_principal) AS cnae_principal,
      any_value(b.situacao) AS situacao,
      any_value(b.capital_social) AS capital_social,
      any_value(b.idade_anos) AS idade_anos
    FROM rede_contatos rc
    LEFT JOIN (${EMPRESA_RANK_SQL}) b ON b.cnpj_base = rc.cnpj_base
    WHERE rc.tipo = $tipo
      AND ($uf = '' OR b.uf = $uf)
      AND ($cnae = '' OR b.cnae_principal LIKE $cnaePrefix)
      AND ($q = '' OR rc.valor ILIKE $qLike OR rc.rotulo ILIKE $qLike)
    GROUP BY rc.tipo, rc.valor, rc.cnpj_base
  )
`;

export async function listHubs(filters: HubListInput): Promise<HubRow[]> {
  return query<HubRow>(
    `${HUB_BASE_SQL}
     SELECT
       tipo,
       valor,
       any_value(rotulo) AS rotulo,
       count(*) AS empresas,
       count(DISTINCT uf) AS ufs,
       count(DISTINCT cnae_principal) AS cnaes,
       count(*) FILTER (WHERE situacao = '02') AS ativas,
       sum(capital_social) AS capital_somado,
       avg(idade_anos) AS idade_media,
       any_value(razao_social) AS exemplo_razao_social,
       any_value(cnpj_base) AS exemplo_cnpj_base,
       any_value(uf) AS exemplo_uf,
       any_value(cnae_principal) AS exemplo_cnae
     FROM base
     GROUP BY 1, 2
     HAVING count(*) >= $min
     ORDER BY empresas DESC, rotulo
     LIMIT $limit OFFSET $offset`,
    paramsFor(filters),
  );
}

export async function getHubSummary(
  tipo: ContactType,
  valor: string,
): Promise<HubSummary | null> {
  const rows = await query<Record<string, unknown>>(
    `SELECT
       rc.tipo,
       rc.valor,
       any_value(rc.rotulo) AS rotulo,
       count(DISTINCT rc.cnpj_base) AS empresas,
       count(DISTINCT b.uf) AS ufs,
       count(DISTINCT b.cnae_principal) AS cnaes,
       count(DISTINCT rc.cnpj_base) FILTER (WHERE b.situacao = '02') AS ativas,
       sum(b.capital_social) AS capital_somado,
       avg(b.idade_anos) AS idade_media
     FROM rede_contatos rc
     LEFT JOIN (${EMPRESA_RANK_SQL}) b ON b.cnpj_base = rc.cnpj_base
     WHERE rc.tipo = $tipo AND rc.valor = $valor
     GROUP BY 1, 2`,
    { tipo, valor },
  );
  const row = rows[0];
  if (!row) return null;
  return {
    tipo: row.tipo as ContactType,
    valor: String(row.valor ?? valor),
    rotulo: String(row.rotulo ?? valor),
    empresas: Number(row.empresas ?? 0),
    ufs: Number(row.ufs ?? 0),
    cnaes: Number(row.cnaes ?? 0),
    ativas: Number(row.ativas ?? 0),
    capital_somado: row.capital_somado == null ? null : Number(row.capital_somado),
    idade_media: row.idade_media == null ? null : Number(row.idade_media),
  };
}

export async function getHubCompanies(
  tipo: ContactType,
  valor: string,
  limit: number,
): Promise<NetworkCompanyRow[]> {
  return query<NetworkCompanyRow>(
    `SELECT
       b.cnpj_base,
       b.cnpj,
       b.razao_social,
       b.nome_fantasia,
       b.uf,
       b.municipio_codigo,
       b.municipio_nome,
       b.municipio_ibge,
       b.situacao,
       b.situacao_descricao,
       b.data_inicio,
       b.idade_anos,
       b.capital_social
     FROM rede_contatos rc
     JOIN (${EMPRESA_RANK_SQL}) b ON b.cnpj_base = rc.cnpj_base
     WHERE rc.tipo = $tipo AND rc.valor = $valor
     ORDER BY b.uf, b.razao_social, b.cnpj
     LIMIT $limit`,
    { tipo, valor, limit },
  );
}

export const HUB_TYPES = CONTACT_TYPES;
