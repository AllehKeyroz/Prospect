import { query } from '../db/duckdb.js';

export const CONTACT_TYPES = ['email', 'telefone', 'endereco', 'marca'] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export interface NetworkLimits {
  partnerLimit: number;
  partnerCompanyLimit: number;
  contactLimit: number;
  contactCompanyLimit: number;
  hubMin: number;
}

export const DEFAULT_NETWORK_LIMITS: NetworkLimits = {
  partnerLimit: 8,
  partnerCompanyLimit: 8,
  contactLimit: 5,
  contactCompanyLimit: 6,
  hubMin: 5,
};

const CONTACT_TYPES_SQL = CONTACT_TYPES.map((type) => `'${type}'`).join(', ');

export const EMPRESA_RANK_SQL = `
  SELECT * FROM (
    SELECT
      cnpj_base,
      cnpj,
      razao_social,
      nome_fantasia,
      uf,
      municipio_codigo,
      municipio_nome,
      municipio_ibge,
      cnae_principal,
      situacao,
      situacao_descricao,
      data_inicio,
      idade_anos,
      capital_social,
      row_number() OVER (
        PARTITION BY cnpj_base
        ORDER BY (matriz_filial = '1') DESC, cnpj
      ) AS rn
    FROM estabelecimentos_busca
  ) WHERE rn = 1
`;

export interface NetworkCompanyRow {
  cnpj_base: string;
  cnpj: string | null;
  razao_social: string | null;
  nome_fantasia: string | null;
  uf: string | null;
  municipio_codigo: string | null;
  municipio_nome: string | null;
  municipio_ibge: string | null;
  situacao: string | null;
  situacao_descricao: string | null;
  data_inicio: string | null;
  idade_anos: string | null;
  capital_social: string | null;
}

export interface TargetPartnerRow {
  partner_key: string;
  cpf_cnpj_socio: string | null;
  nome_socio: string;
  nome_socio_busca: string;
  qualificacao_socio: string | null;
  qualificacao_socio_descricao: string | null;
  empresas_count: number | string;
}

export interface PartnerCompanyRow extends NetworkCompanyRow {
  partner_key: string;
  cpf_cnpj_socio: string | null;
  nome_socio: string;
  nome_socio_busca: string;
  qualificacao_socio: string | null;
  qualificacao_socio_descricao: string | null;
}

export interface ContactRow {
  tipo: ContactType;
  valor: string;
  rotulo: string | null;
  outras: number | string;
}

export interface ContactCompanyRow extends NetworkCompanyRow {
  tipo: ContactType;
  valor: string;
}

export interface NetworkSummary {
  socios: number;
  empresas_via_socios: number;
  contatos: number;
  empresas_via_contatos: number;
  hubs: number;
}

export async function getNetworkCompany(base: string): Promise<NetworkCompanyRow | null> {
  const rows = await query<NetworkCompanyRow>(
    `SELECT
       e.cnpj_base,
       b.cnpj,
       e.razao_social,
       b.nome_fantasia,
       b.uf,
       b.municipio_codigo,
       b.municipio_nome,
       b.municipio_ibge,
       b.situacao,
       b.situacao_descricao,
       b.data_inicio,
       b.idade_anos,
       e.capital_social
     FROM empresas e
     LEFT JOIN (${EMPRESA_RANK_SQL}) b ON b.cnpj_base = e.cnpj_base
     WHERE e.cnpj_base = $base
     LIMIT 1`,
    { base },
  );
  return rows[0] ?? null;
}

const PARTNER_CTE = `
  WITH alvo AS (
    SELECT DISTINCT
      coalesce(nullif(trim(cpf_cnpj_socio), ''), 'nome:' || nome_socio_busca) AS partner_key,
      cpf_cnpj_socio,
      nome_socio,
      nome_socio_busca,
      qualificacao_socio
    FROM socios
    WHERE cnpj_base = $base
  ),
  pares AS (
    SELECT DISTINCT
      a.partner_key,
      a.cpf_cnpj_socio,
      a.nome_socio,
      a.nome_socio_busca,
      a.qualificacao_socio,
      s2.cnpj_base
    FROM alvo a
    JOIN socios s2
      ON s2.cnpj_base <> $base
     AND s2.nome_socio_busca = a.nome_socio_busca
     AND (
       (
         a.cpf_cnpj_socio IS NOT NULL
         AND a.cpf_cnpj_socio <> ''
         AND s2.cpf_cnpj_socio = a.cpf_cnpj_socio
       )
       OR (a.cpf_cnpj_socio IS NULL OR a.cpf_cnpj_socio = '')
     )
  )
`;

export async function getTargetPartners(base: string): Promise<TargetPartnerRow[]> {
  return query<TargetPartnerRow>(
    `SELECT
       coalesce(nullif(trim(s.cpf_cnpj_socio), ''), 'nome:' || s.nome_socio_busca) AS partner_key,
       s.cpf_cnpj_socio,
       any_value(s.nome_socio) AS nome_socio,
       s.nome_socio_busca,
       any_value(s.qualificacao_socio) AS qualificacao_socio,
       any_value(q.descricao) AS qualificacao_socio_descricao,
       count(DISTINCT s.cnpj_base) AS empresas_count
     FROM socios s
     LEFT JOIN dim_qualificacao q ON q.codigo = s.qualificacao_socio
     WHERE s.cnpj_base = $base
     GROUP BY 1, 2, 4
     ORDER BY 7 DESC, 3`,
    { base },
  );
}

export async function getPartnerCompanies(
  base: string,
  limit: NetworkLimits,
): Promise<PartnerCompanyRow[]> {
  return query<PartnerCompanyRow>(
    `${PARTNER_CTE},
    top AS (
      SELECT partner_key
      FROM pares
      GROUP BY 1
      ORDER BY count(DISTINCT cnpj_base) DESC
      LIMIT $partnerLimit
    ),
    ranqueado AS (
      SELECT
        p.*,
        count(*) OVER (PARTITION BY p.partner_key) AS empresas_count,
        row_number() OVER (PARTITION BY p.partner_key ORDER BY p.cnpj_base) AS rn
      FROM pares p
      JOIN top t ON t.partner_key = p.partner_key
    )
    SELECT
      r.partner_key,
      r.cpf_cnpj_socio,
      r.nome_socio,
      r.nome_socio_busca,
      r.qualificacao_socio,
      q.descricao AS qualificacao_socio_descricao,
      r.cnpj_base,
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
    FROM ranqueado r
    LEFT JOIN (${EMPRESA_RANK_SQL}) b ON b.cnpj_base = r.cnpj_base
    LEFT JOIN dim_qualificacao q ON q.codigo = r.qualificacao_socio
    WHERE r.rn <= $companyLimit
    ORDER BY r.partner_key, b.razao_social NULLS LAST, r.cnpj_base`,
    {
      base,
      partnerLimit: limit.partnerLimit,
      companyLimit: limit.partnerCompanyLimit,
    },
  );
}

export async function getContactList(
  base: string,
  limit: NetworkLimits,
): Promise<ContactRow[]> {
  return query<ContactRow>(
    `WITH alvo AS (
       SELECT tipo, valor, any_value(rotulo) AS rotulo
       FROM rede_contatos
       WHERE cnpj_base = $base
         AND tipo IN (${CONTACT_TYPES_SQL})
       GROUP BY 1, 2
     ),
     contagens AS (
       SELECT rc.tipo, rc.valor, count(DISTINCT rc.cnpj_base) AS outras
       FROM alvo a
       JOIN rede_contatos rc ON rc.tipo = a.tipo AND rc.valor = a.valor
       WHERE rc.cnpj_base <> $base
       GROUP BY 1, 2
     ),
     ranqueado AS (
       SELECT
         a.tipo,
         a.valor,
         a.rotulo,
         coalesce(c.outras, 0) AS outras,
         row_number() OVER (
           PARTITION BY a.tipo
           ORDER BY coalesce(c.outras, 0) DESC, a.rotulo
         ) AS rn
       FROM alvo a
       LEFT JOIN contagens c ON c.tipo = a.tipo AND c.valor = a.valor
     )
     SELECT tipo, valor, rotulo, outras
     FROM ranqueado
     WHERE rn <= $contactLimit
     ORDER BY tipo, outras DESC, rotulo`,
    { base, contactLimit: limit.contactLimit },
  );
}

export async function getContactCompanies(
  base: string,
  limit: NetworkLimits,
): Promise<ContactCompanyRow[]> {
  return query<ContactCompanyRow>(
    `WITH alvo AS (
       SELECT tipo, valor, any_value(rotulo) AS rotulo
       FROM rede_contatos
       WHERE cnpj_base = $base
         AND tipo IN (${CONTACT_TYPES_SQL})
       GROUP BY 1, 2
     ),
     contagens AS (
       SELECT rc.tipo, rc.valor, count(DISTINCT rc.cnpj_base) AS outras
       FROM alvo a
       JOIN rede_contatos rc ON rc.tipo = a.tipo AND rc.valor = a.valor
       WHERE rc.cnpj_base <> $base
       GROUP BY 1, 2
     ),
     top AS (
       SELECT * FROM (
         SELECT
           a.tipo,
           a.valor,
           coalesce(c.outras, 0) AS outras,
           row_number() OVER (
             PARTITION BY a.tipo
             ORDER BY coalesce(c.outras, 0) DESC, a.valor
           ) AS rn
         FROM alvo a
         LEFT JOIN contagens c ON c.tipo = a.tipo AND c.valor = a.valor
       ) WHERE rn <= $contactLimit
     ),
     matches AS (
       SELECT DISTINCT t.tipo, t.valor, rc.cnpj_base
       FROM top t
       JOIN rede_contatos rc ON rc.tipo = t.tipo AND rc.valor = t.valor
       WHERE rc.cnpj_base <> $base
     ),
     ranqueado AS (
       SELECT
         m.*,
         row_number() OVER (PARTITION BY m.tipo, m.valor ORDER BY m.cnpj_base) AS rn
       FROM matches m
     )
     SELECT
       r.tipo,
       r.valor,
       r.cnpj_base,
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
     FROM ranqueado r
     LEFT JOIN (${EMPRESA_RANK_SQL}) b ON b.cnpj_base = r.cnpj_base
     WHERE r.rn <= $companyLimit
     ORDER BY r.tipo, r.valor, b.razao_social NULLS LAST, r.cnpj_base`,
    {
      base,
      contactLimit: limit.contactLimit,
      companyLimit: limit.contactCompanyLimit,
    },
  );
}

export async function getNetworkSummary(
  base: string,
  hubMin = DEFAULT_NETWORK_LIMITS.hubMin,
): Promise<NetworkSummary> {
  const row = await query<Record<string, unknown>>(
    `WITH alvo_socios AS (
       SELECT DISTINCT
         coalesce(nullif(trim(cpf_cnpj_socio), ''), 'nome:' || nome_socio_busca) AS partner_key,
         cpf_cnpj_socio,
         nome_socio_busca
       FROM socios
       WHERE cnpj_base = $base
     ),
     socios_outras AS (
       SELECT DISTINCT s2.cnpj_base
       FROM alvo_socios a
       JOIN socios s2
         ON s2.cnpj_base <> $base
        AND s2.nome_socio_busca = a.nome_socio_busca
        AND (
          (
            a.cpf_cnpj_socio IS NOT NULL
            AND a.cpf_cnpj_socio <> ''
            AND s2.cpf_cnpj_socio = a.cpf_cnpj_socio
          )
          OR (a.cpf_cnpj_socio IS NULL OR a.cpf_cnpj_socio = '')
        )
     ),
     alvo_contatos AS (
       SELECT tipo, valor
       FROM rede_contatos
       WHERE cnpj_base = $base
         AND tipo IN (${CONTACT_TYPES_SQL})
       GROUP BY 1, 2
     ),
     contagens AS (
       SELECT rc.tipo, rc.valor, count(DISTINCT rc.cnpj_base) AS outras
       FROM alvo_contatos a
       JOIN rede_contatos rc ON rc.tipo = a.tipo AND rc.valor = a.valor
       WHERE rc.cnpj_base <> $base
       GROUP BY 1, 2
     ),
     contatos_outras AS (
       SELECT DISTINCT rc.cnpj_base
       FROM alvo_contatos a
       JOIN rede_contatos rc ON rc.tipo = a.tipo AND rc.valor = a.valor
       WHERE rc.cnpj_base <> $base
     )
     SELECT
       (SELECT count(*) FROM alvo_socios) AS socios,
       (SELECT count(*) FROM socios_outras) AS empresas_via_socios,
       (SELECT count(*) FROM alvo_contatos) AS contatos,
       (SELECT count(*) FROM contatos_outras) AS empresas_via_contatos,
       (
         SELECT count(*)
         FROM alvo_contatos a
         LEFT JOIN contagens c ON c.tipo = a.tipo AND c.valor = a.valor
         WHERE coalesce(c.outras, 0) + 1 >= $hubMin
       ) AS hubs`,
    { base, hubMin },
  );

  const data = row[0] ?? {};
  return {
    socios: Number(data.socios ?? 0),
    empresas_via_socios: Number(data.empresas_via_socios ?? 0),
    contatos: Number(data.contatos ?? 0),
    empresas_via_contatos: Number(data.empresas_via_contatos ?? 0),
    hubs: Number(data.hubs ?? 0),
  };
}
