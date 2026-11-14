function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function readCsv(file: string, encoding = 'utf-8'): string {
  return `read_csv(${sqlString(file)}, delim=';', quote='"', header=false, all_varchar=true, encoding=${sqlString(encoding)})`;
}

export const MACRO_SQL = [
  `CREATE OR REPLACE MACRO normalize_text(x) AS
   trim(regexp_replace(
     lower(translate(trim(x),
       'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
       'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')),
     '[^a-z0-9]+', ' ', 'g'))`,
  `CREATE OR REPLACE MACRO parse_date(x) AS
   CASE
     WHEN x IS NULL OR trim(x) IN ('', '0', '00000000') THEN NULL
     ELSE try_strptime(trim(x), '%Y%m%d')::DATE
   END`,
];

export function empresasSql(file: string, snapshot: string, encoding = 'utf-8'): string {
  return `CREATE OR REPLACE TABLE empresas AS
SELECT
  upper(trim(column0)) AS cnpj_base,
  nullif(trim(column1), '') AS razao_social,
  coalesce(normalize_text(column1), '') AS razao_social_busca,
  nullif(trim(column2), '') AS natureza_juridica,
  nullif(trim(column3), '') AS qualificacao_responsavel,
  try_cast(replace(nullif(trim(column4), ''), ',', '.') AS DECIMAL(18,2)) AS capital_social,
  nullif(trim(column5), '') AS porte,
  nullif(trim(column6), '') AS ente_federativo,
  ${sqlString(snapshot)} AS snapshot
FROM ${readCsv(file, encoding)}`;
}

export function estabelecimentosSql(file: string, snapshot: string, encoding = 'utf-8'): string {
  return `CREATE OR REPLACE TABLE estabelecimentos AS
SELECT
  upper(trim(column00)) || upper(trim(column01)) || trim(column02) AS cnpj,
  upper(trim(column00)) AS cnpj_base,
  upper(trim(column01)) AS cnpj_ordem,
  trim(column02) AS cnpj_dv,
  nullif(trim(column03), '') AS matriz_filial,
  nullif(trim(column04), '') AS nome_fantasia,
  coalesce(normalize_text(column04), '') AS nome_fantasia_busca,
  nullif(trim(column05), '') AS situacao,
  parse_date(column06) AS data_situacao,
  nullif(trim(column07), '') AS motivo,
  nullif(trim(column08), '') AS nome_cidade_exterior,
  nullif(trim(column09), '') AS pais,
  parse_date(column10) AS data_inicio,
  nullif(trim(column11), '') AS cnae_principal,
  coalesce(
    list_transform(string_split(nullif(trim(column12), ''), ','), lambda x: trim(x)),
    []::VARCHAR[]
  ) AS cnaes_secundarios,
  nullif(trim(column13), '') AS tipo_logradouro,
  nullif(trim(column14), '') AS logradouro,
  nullif(trim(column15), '') AS numero,
  nullif(trim(column16), '') AS complemento,
  nullif(trim(column17), '') AS bairro,
  nullif(trim(column18), '') AS cep,
  nullif(trim(column19), '') AS uf,
  nullif(trim(column20), '') AS municipio_codigo,
  nullif(trim(column21), '') AS ddd1,
  nullif(trim(column22), '') AS telefone1,
  nullif(trim(column23), '') AS ddd2,
  nullif(trim(column24), '') AS telefone2,
  nullif(trim(column25), '') AS ddd_fax,
  nullif(trim(column26), '') AS fax,
  lower(nullif(trim(column27), '')) AS email,
  nullif(trim(column28), '') AS situacao_especial,
  parse_date(column29) AS data_situacao_especial,
  ${sqlString(snapshot)} AS snapshot
FROM ${readCsv(file, encoding)}`;
}

export function sociosSql(file: string, snapshot: string, encoding = 'utf-8'): string {
  return `CREATE OR REPLACE TABLE socios AS
SELECT
  upper(trim(column00)) AS cnpj_base,
  nullif(trim(column01), '') AS identificador_socio,
  nullif(trim(column02), '') AS nome_socio,
  coalesce(normalize_text(column02), '') AS nome_socio_busca,
  nullif(trim(column03), '') AS cpf_cnpj_socio,
  nullif(trim(column04), '') AS qualificacao_socio,
  parse_date(column05) AS data_entrada,
  nullif(trim(column06), '') AS pais,
  nullif(trim(column07), '') AS representante_legal,
  nullif(trim(column08), '') AS nome_representante,
  nullif(trim(column09), '') AS qualificacao_representante,
  nullif(trim(column10), '') AS faixa_etaria,
  ${sqlString(snapshot)} AS snapshot
FROM ${readCsv(file, encoding)}`;
}

export function simplesSql(file: string, snapshot: string, encoding = 'utf-8'): string {
  return `CREATE OR REPLACE TABLE simples AS
SELECT
  upper(trim(column0)) AS cnpj_base,
  nullif(trim(column1), '') AS opcao_simples,
  parse_date(column2) AS data_opcao_simples,
  parse_date(column3) AS data_exclusao_simples,
  nullif(trim(column4), '') AS opcao_mei,
  parse_date(column5) AS data_opcao_mei,
  parse_date(column6) AS data_exclusao_mei,
  ${sqlString(snapshot)} AS snapshot
FROM ${readCsv(file, encoding)}`;
}

export function dimSql(table: string, file: string, encoding = 'utf-8'): string {
  return `CREATE OR REPLACE TABLE ${table} AS
SELECT
  trim(column0) AS codigo,
  any_value(nullif(trim(column1), '')) AS descricao
FROM ${readCsv(file, encoding)}
GROUP BY 1`;
}

export function ibgeMunicipiosSql(file: string): string {
  return `CREATE OR REPLACE TABLE ibge_municipios AS
SELECT
  trim(codigo) AS codigo,
  nome,
  trim(uf) AS uf,
  regiao,
  trim(regiao_codigo) AS regiao_codigo
FROM read_csv(${sqlString(file)}, header=true, all_varchar=true, delim=',', quote='"')`;
}

export const MUNICIPIO_IBGE_SQL = `CREATE OR REPLACE TABLE dim_municipio_ibge AS
WITH rfb AS (
  SELECT DISTINCT
    e.municipio_codigo AS municipio_rfb,
    e.uf,
    m.descricao AS nome_rfb
  FROM estabelecimentos e
  LEFT JOIN dim_municipio m ON m.codigo = e.municipio_codigo
  WHERE e.municipio_codigo IS NOT NULL
    AND e.uf IS NOT NULL
    AND e.uf <> ''
),
exact AS (
  SELECT
    r.municipio_rfb,
    r.uf,
    i.codigo AS municipio_ibge,
    i.nome AS nome_ibge,
    i.regiao,
    row_number() OVER (
      PARTITION BY r.municipio_rfb, r.uf
      ORDER BY i.codigo
    ) AS rn
  FROM rfb r
  JOIN ibge_municipios i
    ON i.uf = r.uf
   AND normalize_text(i.nome) = normalize_text(r.nome_rfb)
)
SELECT municipio_rfb, uf, municipio_ibge, nome_ibge, regiao
FROM exact
WHERE rn = 1`;

export const EMPTY_EMPRESAS_SQL = `CREATE OR REPLACE TABLE empresas (
  cnpj_base VARCHAR,
  razao_social VARCHAR,
  razao_social_busca VARCHAR,
  natureza_juridica VARCHAR,
  qualificacao_responsavel VARCHAR,
  capital_social DECIMAL(18,2),
  porte VARCHAR,
  ente_federativo VARCHAR,
  snapshot VARCHAR
)`;

export const EMPTY_ESTABELECIMENTOS_SQL = `CREATE OR REPLACE TABLE estabelecimentos (
  cnpj VARCHAR,
  cnpj_base VARCHAR,
  cnpj_ordem VARCHAR,
  cnpj_dv VARCHAR,
  matriz_filial VARCHAR,
  nome_fantasia VARCHAR,
  nome_fantasia_busca VARCHAR,
  situacao VARCHAR,
  data_situacao DATE,
  motivo VARCHAR,
  nome_cidade_exterior VARCHAR,
  pais VARCHAR,
  data_inicio DATE,
  cnae_principal VARCHAR,
  cnaes_secundarios VARCHAR[],
  tipo_logradouro VARCHAR,
  logradouro VARCHAR,
  numero VARCHAR,
  complemento VARCHAR,
  bairro VARCHAR,
  cep VARCHAR,
  uf VARCHAR,
  municipio_codigo VARCHAR,
  ddd1 VARCHAR,
  telefone1 VARCHAR,
  ddd2 VARCHAR,
  telefone2 VARCHAR,
  ddd_fax VARCHAR,
  fax VARCHAR,
  email VARCHAR,
  situacao_especial VARCHAR,
  data_situacao_especial DATE,
  snapshot VARCHAR
)`;

export const EMPTY_SOCIOS_SQL = `CREATE OR REPLACE TABLE socios (
  cnpj_base VARCHAR,
  identificador_socio VARCHAR,
  nome_socio VARCHAR,
  nome_socio_busca VARCHAR,
  cpf_cnpj_socio VARCHAR,
  qualificacao_socio VARCHAR,
  data_entrada DATE,
  pais VARCHAR,
  representante_legal VARCHAR,
  nome_representante VARCHAR,
  qualificacao_representante VARCHAR,
  faixa_etaria VARCHAR,
  snapshot VARCHAR
)`;

export const EMPTY_SIMPLES_SQL = `CREATE OR REPLACE TABLE simples (
  cnpj_base VARCHAR,
  opcao_simples VARCHAR,
  data_opcao_simples DATE,
  data_exclusao_simples DATE,
  opcao_mei VARCHAR,
  data_opcao_mei DATE,
  data_exclusao_mei DATE,
  snapshot VARCHAR
)`;

/**
 * Contatos normalizados por empresa (CNPJ base).
 *
 * Esta tabela é a base do mapa de ligações: cada linha liga uma empresa a um
 * e-mail, telefone, endereço ou marca. Consultas de rede fazem join por
 * (tipo, valor) em vez de varrer estabelecimentos em tempo de request.
 */
export const REDE_CONTATOS_SQL = `CREATE OR REPLACE TABLE rede_contatos AS
WITH base AS (
  SELECT
    cnpj_base,
    lower(trim(email)) AS email,
    ddd1,
    ddd2,
    regexp_replace(coalesce(ddd1, '') || coalesce(telefone1, ''), '[^0-9]', '', 'g') AS telefone1,
    regexp_replace(coalesce(ddd2, '') || coalesce(telefone2, ''), '[^0-9]', '', 'g') AS telefone2,
    regexp_replace(coalesce(cep, ''), '[^0-9]', '', 'g') AS cep,
    normalize_text(coalesce(logradouro, '')) AS logradouro_norm,
    normalize_text(coalesce(numero, '')) AS numero_norm,
    normalize_text(coalesce(complemento, '')) AS complemento_norm,
    trim(concat_ws(' ', tipo_logradouro, logradouro, numero, complemento, bairro, cep)) AS endereco_rotulo,
    nome_fantasia,
    nome_fantasia_busca
  FROM estabelecimentos
),
emails AS (
  SELECT cnpj_base, 'email' AS tipo, email AS valor, any_value(email) AS rotulo
  FROM base
  WHERE email IS NOT NULL
    AND email <> ''
    AND email LIKE '%@%'
    AND email NOT IN ('0', '-', 'nao tem', 'nao possui', 'nenhum', 'sem email')
    AND regexp_matches(email, '^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$')
  GROUP BY 1, 2, 3
),
telefones AS (
  SELECT cnpj_base, 'telefone' AS tipo, telefone1 AS valor,
         any_value(trim(coalesce(ddd1, '') || ' ' || coalesce(telefone1, ''))) AS rotulo
  FROM base
  WHERE length(telefone1) BETWEEN 10 AND 11
    AND telefone1 NOT IN (
      '0000000000', '00000000000',
      '1111111111', '11111111111',
      '9999999999', '99999999999'
    )
  GROUP BY 1, 2, 3
  UNION ALL
  SELECT cnpj_base, 'telefone' AS tipo, telefone2 AS valor,
         any_value(trim(coalesce(ddd2, '') || ' ' || coalesce(telefone2, ''))) AS rotulo
  FROM base
  WHERE length(telefone2) BETWEEN 10 AND 11
    AND telefone2 NOT IN (
      '0000000000', '00000000000',
      '1111111111', '11111111111',
      '9999999999', '99999999999'
    )
  GROUP BY 1, 2, 3
),
enderecos AS (
  SELECT
    cnpj_base,
    'endereco' AS tipo,
    logradouro_norm || '|' || numero_norm || '|' || complemento_norm || '|' || cep AS valor,
    any_value(endereco_rotulo) AS rotulo
  FROM base
  WHERE length(cep) = 8
    AND cep <> '00000000'
    AND numero_norm NOT IN ('', '0', 's n', 'sn', 's/n')
  GROUP BY 1, 2, 3
),
marcas AS (
  SELECT cnpj_base, 'marca' AS tipo, nome_fantasia_busca AS valor, any_value(trim(nome_fantasia)) AS rotulo
  FROM base
  WHERE nome_fantasia_busca IS NOT NULL
    AND length(nome_fantasia_busca) >= 4
    AND nome_fantasia_busca NOT IN ('matriz', 'filial', 'loja', 'comercio', 'servicos', 'empresa', 'grupo')
  GROUP BY 1, 2, 3
)
SELECT * FROM emails
UNION ALL
SELECT * FROM telefones
UNION ALL
SELECT * FROM enderecos
UNION ALL
SELECT * FROM marcas`;

export const SEARCH_TABLE_SQL = `CREATE OR REPLACE TABLE estabelecimentos_busca AS
SELECT
  e.cnpj,
  e.cnpj_base,
  e.cnpj_ordem,
  e.cnpj_dv,
  e.matriz_filial,
  e.nome_fantasia,
  e.nome_fantasia_busca,
  e.situacao,
  e.data_situacao,
  e.motivo,
  e.data_inicio,
  e.cnae_principal,
  e.cnaes_secundarios,
  e.tipo_logradouro,
  e.logradouro,
  e.numero,
  e.complemento,
  e.bairro,
  e.cep,
  e.uf,
  e.municipio_codigo,
  mi.municipio_ibge,
  mi.regiao,
  e.ddd1,
  e.telefone1,
  e.ddd2,
  e.telefone2,
  e.email,
  e.situacao_especial,
  e.data_situacao_especial,
  e.snapshot,
  coalesce(emp.razao_social, '') AS razao_social,
  coalesce(emp.razao_social_busca, '') AS razao_social_busca,
  emp.natureza_juridica,
  emp.qualificacao_responsavel,
  emp.capital_social,
  emp.porte,
  emp.ente_federativo,
  coalesce(sc.socios_count, 0) AS socios_count,
  coalesce(s.opcao_simples, 'N') AS opcao_simples,
  coalesce(s.opcao_mei, 'N') AS opcao_mei,
  c.descricao AS cnae_descricao,
  m.descricao AS municipio_nome,
  n.descricao AS natureza_descricao,
  CASE emp.porte
    WHEN '01' THEN 'Microempresa'
    WHEN '03' THEN 'Empresa de Pequeno Porte'
    WHEN '05' THEN 'Demais'
    ELSE 'Não informado'
  END AS porte_descricao,
  CASE e.situacao
    WHEN '01' THEN 'Nula'
    WHEN '02' THEN 'Ativa'
    WHEN '03' THEN 'Suspensa'
    WHEN '04' THEN 'Inapta'
    WHEN '08' THEN 'Baixada'
    ELSE 'Outra'
  END AS situacao_descricao,
  CASE e.matriz_filial
    WHEN '1' THEN 'Matriz'
    WHEN '2' THEN 'Filial'
    ELSE 'Não informado'
  END AS matriz_filial_descricao,
  CASE
    WHEN e.data_inicio IS NULL THEN NULL
    ELSE date_diff('year', e.data_inicio, current_date)
  END AS idade_anos,
  (e.situacao = '02') AS is_ativa,
  coalesce(e.data_inicio <= current_date - INTERVAL 3 YEAR, false) AS is_mais_3_anos
FROM estabelecimentos e
LEFT JOIN empresas emp ON emp.cnpj_base = e.cnpj_base
LEFT JOIN simples s ON s.cnpj_base = e.cnpj_base
LEFT JOIN (
  SELECT cnpj_base, count(*) AS socios_count
  FROM socios
  GROUP BY 1
) sc ON sc.cnpj_base = e.cnpj_base
LEFT JOIN dim_cnae c ON c.codigo = e.cnae_principal
LEFT JOIN dim_municipio m ON m.codigo = e.municipio_codigo
LEFT JOIN dim_municipio_ibge mi
  ON mi.municipio_rfb = e.municipio_codigo
 AND mi.uf = e.uf
LEFT JOIN dim_natureza n ON n.codigo = emp.natureza_juridica
ORDER BY e.uf, e.cnae_principal, e.cnpj`;

export const INDEX_SQL = [
  // Índices de ponto (lookup). Filtros de UF/CNAE/situação/data se beneficiam
  // da ordenação da tabela e dos zone maps do DuckDB, sem custo extra de índice.
  `CREATE INDEX IF NOT EXISTS ix_busca_cnpj ON estabelecimentos_busca(cnpj)`,
  `CREATE INDEX IF NOT EXISTS ix_busca_base ON estabelecimentos_busca(cnpj_base)`,
  `CREATE INDEX IF NOT EXISTS ix_busca_municipio_ibge ON estabelecimentos_busca(municipio_ibge)`,
  `CREATE INDEX IF NOT EXISTS ix_rede_contatos_valor ON rede_contatos(tipo, valor)`,
  `CREATE INDEX IF NOT EXISTS ix_rede_contatos_base ON rede_contatos(cnpj_base)`,
  `CREATE INDEX IF NOT EXISTS ix_empresas_base ON empresas(cnpj_base)`,
  `CREATE INDEX IF NOT EXISTS ix_estabelecimentos_base ON estabelecimentos(cnpj_base)`,
  `CREATE INDEX IF NOT EXISTS ix_socios_base ON socios(cnpj_base)`,
  `CREATE INDEX IF NOT EXISTS ix_socios_cpf ON socios(cpf_cnpj_socio)`,
  `CREATE INDEX IF NOT EXISTS ix_simples_base ON simples(cnpj_base)`,
];

export const META_TABLE_SQL = `CREATE OR REPLACE TABLE meta (
  key VARCHAR,
  value VARCHAR
)`;

