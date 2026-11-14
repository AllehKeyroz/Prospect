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

export interface HubExpansionRow extends NetworkCompanyRow {
  origem_cnpj_base: string;
  partner_key: string;
  partner_nome: string;
  partner_cpf: string | null;
  partner_qualificacao: string | null;
  partner_qualificacao_descricao: string | null;
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

export async function getHubExpansion(
  tipo: ContactType,
  valor: string,
  options: { companyLimit: number; companyPerPartner: number },
): Promise<HubExpansionRow[]> {
  return query<HubExpansionRow>(
    `WITH hub_empresas AS (
       SELECT DISTINCT cnpj_base
       FROM rede_contatos
       WHERE tipo = $tipo AND valor = $valor
       ORDER BY cnpj_base
       LIMIT $companyLimit
     ),
     alvo_socios AS (
       SELECT
         s.cnpj_base AS origem_cnpj_base,
         coalesce(nullif(trim(s.cpf_cnpj_socio), ''), 'nome:' || s.nome_socio_busca) AS partner_key,
         any_value(s.cpf_cnpj_socio) AS partner_cpf,
         s.nome_socio_busca,
         any_value(s.nome_socio) AS partner_nome,
         any_value(s.qualificacao_socio) AS partner_qualificacao
       FROM socios s
       JOIN hub_empresas h ON h.cnpj_base = s.cnpj_base
       GROUP BY 1, 2, 4
     ),
     pares AS (
       SELECT
         a.origem_cnpj_base,
         a.partner_key,
         a.partner_nome,
         a.partner_cpf,
         a.partner_qualificacao,
         s2.cnpj_base
       FROM alvo_socios a
       JOIN socios s2
         ON s2.cnpj_base <> a.origem_cnpj_base
        AND s2.nome_socio_busca = a.nome_socio_busca
        AND (
          (
            a.partner_cpf IS NOT NULL
            AND a.partner_cpf <> ''
            AND s2.cpf_cnpj_socio = a.partner_cpf
          )
          OR (a.partner_cpf IS NULL OR a.partner_cpf = '')
        )
     ),
     ranked AS (
       SELECT
         p.*,
         row_number() OVER (PARTITION BY p.partner_key ORDER BY p.cnpj_base) AS rn
       FROM pares p
     )
     SELECT
       r.origem_cnpj_base,
       r.partner_key,
       r.partner_nome,
       r.partner_cpf,
       r.partner_qualificacao,
       q.descricao AS partner_qualificacao_descricao,
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
     FROM ranked r
     LEFT JOIN (${EMPRESA_RANK_SQL}) b ON b.cnpj_base = r.cnpj_base
     LEFT JOIN dim_qualificacao q ON q.codigo = r.partner_qualificacao
     WHERE r.rn <= $companyPerPartner
     ORDER BY r.origem_cnpj_base, r.partner_key, r.cnpj_base`,
    {
      tipo,
      valor,
      companyLimit: options.companyLimit,
      companyPerPartner: options.companyPerPartner,
    },
  );
}

export const HUB_TYPES = CONTACT_TYPES;
