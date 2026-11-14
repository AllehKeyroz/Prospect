-- Prospect — schema inicial PostgreSQL
--
-- Execute uma vez por banco:
--   psql "$DATABASE_URL" -f db/migrations/001_init.sql
--
-- O app ainda usa DuckDB nesta etapa. Este schema é a fundação do novo
-- banco relacional e mantém os mesmos conceitos do modelo atual:
--   core     = dados cadastrais brutos/normalizados
--   read     = tabelas prontas para a UI
--   app      = estado da aplicação (buscas salvas etc.)
--   history  = snapshots e change log
--   enrich   = fatos/arestas de fontes externas, com evidência e confiança
--
-- Regras:
--   * CNPJ é sempre texto (alfanumérico desde 31/07/2026).
--   * Nada de score composto; fatos e arestas guardam evidência e confiança.
--   * Não sobrescrever fonte oficial com fonte incerta.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS read;
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS history;
CREATE SCHEMA IF NOT EXISTS enrich;

CREATE OR REPLACE FUNCTION core.normalize_text(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT trim(
    regexp_replace(
      translate(
        lower(coalesce(value, '')),
        'áàâãäéèêëíìîïóòôõöúùûüç',
        'aaaaaeeeeiiiiooooouuuuc'
      ),
      '[^a-z0-9]+',
      ' ',
      'g'
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- core: dados da Receita Federal
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS core.empresas (
  cnpj_base varchar(8) PRIMARY KEY,
  razao_social text,
  razao_social_busca text NOT NULL DEFAULT '',
  natureza_juridica varchar(4),
  qualificacao_responsavel varchar(2),
  capital_social numeric(18, 2),
  porte varchar(2),
  ente_federativo text,
  snapshot varchar(7) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_empresas_razao_busca
  ON core.empresas USING btree (razao_social_busca);
CREATE INDEX IF NOT EXISTS ix_empresas_natureza
  ON core.empresas (natureza_juridica);

-- Tabela particionada por UF. As consultas de mapa/dashboard filtram UF;
-- consultas por CNPJ usam o índice (cnpj, uf) em cada partição.
CREATE TABLE IF NOT EXISTS core.estabelecimentos (
  cnpj varchar(14) NOT NULL,
  cnpj_base varchar(8) NOT NULL,
  cnpj_ordem varchar(4),
  cnpj_dv varchar(2),
  matriz_filial varchar(1),
  nome_fantasia text,
  nome_fantasia_busca text NOT NULL DEFAULT '',
  situacao varchar(2),
  data_situacao date,
  motivo varchar(2),
  nome_cidade_exterior text,
  pais varchar(3),
  data_inicio date,
  cnae_principal varchar(7),
  cnaes_secundarios text[] NOT NULL DEFAULT '{}',
  tipo_logradouro text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cep varchar(8),
  uf varchar(2) NOT NULL DEFAULT 'XX',
  municipio_codigo varchar(4),
  ddd1 varchar(2),
  telefone1 text,
  ddd2 varchar(2),
  telefone2 text,
  ddd_fax varchar(2),
  fax text,
  email text,
  situacao_especial text,
  data_situacao_especial date,
  snapshot varchar(7) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cnpj, uf)
) PARTITION BY LIST (uf);

DO $$
DECLARE
  uf text;
BEGIN
  FOREACH uf IN ARRAY ARRAY[
    'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
    'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'
  ]
  LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS core.estabelecimentos_%s PARTITION OF core.estabelecimentos FOR VALUES IN (%L)',
      lower(uf), uf
    );
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS core.estabelecimentos_default
  PARTITION OF core.estabelecimentos DEFAULT;

CREATE INDEX IF NOT EXISTS ix_estabelecimentos_cnpj_base
  ON core.estabelecimentos (cnpj_base);
CREATE INDEX IF NOT EXISTS ix_estabelecimentos_municipio
  ON core.estabelecimentos (municipio_codigo);
CREATE INDEX IF NOT EXISTS ix_estabelecimentos_cnae
  ON core.estabelecimentos (cnae_principal);
CREATE INDEX IF NOT EXISTS ix_estabelecimentos_inicio
  ON core.estabelecimentos (data_inicio);
CREATE INDEX IF NOT EXISTS ix_estabelecimentos_situacao
  ON core.estabelecimentos (situacao);
CREATE INDEX IF NOT EXISTS ix_estabelecimentos_email
  ON core.estabelecimentos (lower(email))
  WHERE email IS NOT NULL AND email <> '';

CREATE TABLE IF NOT EXISTS core.socios (
  id bigserial PRIMARY KEY,
  cnpj_base varchar(8) NOT NULL,
  identificador_socio varchar(1),
  nome_socio text,
  nome_socio_busca text NOT NULL DEFAULT '',
  cpf_cnpj_socio text,
  qualificacao_socio varchar(2),
  data_entrada date,
  pais varchar(3),
  representante_legal text,
  nome_representante text,
  qualificacao_representante varchar(2),
  faixa_etaria varchar(2),
  snapshot varchar(7) NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_socios_cnpj_base ON core.socios (cnpj_base);
CREATE INDEX IF NOT EXISTS ix_socios_cpf ON core.socios (cpf_cnpj_socio);
CREATE INDEX IF NOT EXISTS ix_socios_nome ON core.socios (nome_socio_busca);

CREATE TABLE IF NOT EXISTS core.simples (
  cnpj_base varchar(8) PRIMARY KEY,
  opcao_simples varchar(1),
  data_opcao_simples date,
  data_exclusao_simples date,
  opcao_mei varchar(1),
  data_opcao_mei date,
  data_exclusao_mei date,
  snapshot varchar(7) NOT NULL
);

CREATE TABLE IF NOT EXISTS core.dim_cnae (
  codigo varchar(7) PRIMARY KEY,
  descricao text
);

CREATE TABLE IF NOT EXISTS core.dim_municipio (
  codigo varchar(4) PRIMARY KEY,
  descricao text
);

CREATE TABLE IF NOT EXISTS core.dim_natureza (
  codigo varchar(4) PRIMARY KEY,
  descricao text
);

CREATE TABLE IF NOT EXISTS core.dim_qualificacao (
  codigo varchar(2) PRIMARY KEY,
  descricao text
);

CREATE TABLE IF NOT EXISTS core.dim_motivo (
  codigo varchar(2) PRIMARY KEY,
  descricao text
);

CREATE TABLE IF NOT EXISTS core.dim_pais (
  codigo varchar(3) PRIMARY KEY,
  descricao text
);

CREATE TABLE IF NOT EXISTS core.municipio_ibge (
  codigo varchar(7) PRIMARY KEY,
  nome text NOT NULL,
  uf varchar(2) NOT NULL,
  regiao text,
  regiao_codigo varchar(1)
);

CREATE INDEX IF NOT EXISTS ix_municipio_ibge_uf ON core.municipio_ibge (uf);
CREATE INDEX IF NOT EXISTS ix_municipio_ibge_nome ON core.municipio_ibge (core.normalize_text(nome));

-- ---------------------------------------------------------------------------
-- read: modelo denormalizado para a API/UI
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS read.estabelecimentos_busca (
  cnpj varchar(14) PRIMARY KEY,
  cnpj_base varchar(8) NOT NULL,
  cnpj_ordem varchar(4),
  cnpj_dv varchar(2),
  matriz_filial varchar(1),
  nome_fantasia text,
  nome_fantasia_busca text NOT NULL DEFAULT '',
  situacao varchar(2),
  data_situacao date,
  motivo varchar(2),
  data_inicio date,
  cnae_principal varchar(7),
  cnaes_secundarios text[] NOT NULL DEFAULT '{}',
  tipo_logradouro text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cep varchar(8),
  uf varchar(2),
  municipio_codigo varchar(4),
  municipio_ibge varchar(7),
  regiao text,
  ddd1 varchar(2),
  telefone1 text,
  ddd2 varchar(2),
  telefone2 text,
  email text,
  situacao_especial text,
  data_situacao_especial date,
  snapshot varchar(7) NOT NULL,
  razao_social text NOT NULL DEFAULT '',
  razao_social_busca text NOT NULL DEFAULT '',
  natureza_juridica varchar(4),
  qualificacao_responsavel varchar(2),
  capital_social numeric(18, 2),
  porte varchar(2),
  ente_federativo text,
  socios_count integer NOT NULL DEFAULT 0,
  opcao_simples varchar(1) NOT NULL DEFAULT 'N',
  opcao_mei varchar(1) NOT NULL DEFAULT 'N',
  cnae_descricao text,
  municipio_nome text,
  natureza_descricao text,
  porte_descricao text,
  situacao_descricao text,
  matriz_filial_descricao text,
  idade_anos integer,
  is_ativa boolean NOT NULL DEFAULT false,
  is_mais_3_anos boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS ix_busca_base ON read.estabelecimentos_busca (cnpj_base);
CREATE INDEX IF NOT EXISTS ix_busca_uf ON read.estabelecimentos_busca (uf);
CREATE INDEX IF NOT EXISTS ix_busca_municipio_codigo ON read.estabelecimentos_busca (municipio_codigo);
CREATE INDEX IF NOT EXISTS ix_busca_municipio_ibge ON read.estabelecimentos_busca (municipio_ibge);
CREATE INDEX IF NOT EXISTS ix_busca_cnae ON read.estabelecimentos_busca (cnae_principal);
CREATE INDEX IF NOT EXISTS ix_busca_situacao ON read.estabelecimentos_busca (situacao);
CREATE INDEX IF NOT EXISTS ix_busca_inicio ON read.estabelecimentos_busca (data_inicio);
CREATE INDEX IF NOT EXISTS ix_busca_socios ON read.estabelecimentos_busca (socios_count);
CREATE INDEX IF NOT EXISTS ix_busca_razao ON read.estabelecimentos_busca (razao_social_busca);

-- Busca "contém" em 70M+ de nomes é cara. Índice trigram é opcional:
-- CREATE INDEX IF NOT EXISTS ix_busca_razao_trgm
--   ON read.estabelecimentos_busca USING gin (razao_social_busca gin_trgm_ops);

-- Contatos normalizados para o grafo. Uma linha por empresa/contato.
CREATE TABLE IF NOT EXISTS read.rede_contatos (
  cnpj_base varchar(8) NOT NULL,
  tipo varchar(10) NOT NULL CHECK (tipo IN ('email', 'telefone', 'endereco', 'marca')),
  valor text NOT NULL,
  rotulo text,
  PRIMARY KEY (cnpj_base, tipo, valor)
);

CREATE INDEX IF NOT EXISTS ix_rede_contatos_valor ON read.rede_contatos (tipo, valor);
CREATE INDEX IF NOT EXISTS ix_rede_contatos_base ON read.rede_contatos (cnpj_base);

-- ---------------------------------------------------------------------------
-- app: estado da aplicação
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app.saved_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- history: snapshots e mudanças
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS history.snapshots (
  snapshot varchar(7) PRIMARY KEY,
  source text NOT NULL,
  downloaded_at timestamptz,
  file_hash text,
  rows_empresas bigint,
  rows_estabelecimentos bigint,
  rows_socios bigint,
  rows_simples bigint,
  notes text
);

CREATE TABLE IF NOT EXISTS history.change_events (
  id bigserial PRIMARY KEY,
  cnpj varchar(14) NOT NULL,
  cnpj_base varchar(8) NOT NULL,
  field text NOT NULL,
  old_value text,
  new_value text,
  snapshot varchar(7) NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS ix_change_events_cnpj ON history.change_events (cnpj);
CREATE INDEX IF NOT EXISTS ix_change_events_base ON history.change_events (cnpj_base);
CREATE INDEX IF NOT EXISTS ix_change_events_snapshot ON history.change_events (snapshot);

-- ---------------------------------------------------------------------------
-- enrich: fatos e arestas de fontes externas
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS enrich.source_registry (
  id smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  owner text,
  homepage text,
  license text,
  access_mode text CHECK (access_mode IN ('bulk', 'api_bulk', 'mixed', 'manual')),
  frequency text,
  has_cnpj boolean NOT NULL DEFAULT false,
  cnpj_key text,
  notes text
);

CREATE TABLE IF NOT EXISTS enrich.source_snapshot (
  id bigserial PRIMARY KEY,
  source_id smallint NOT NULL REFERENCES enrich.source_registry(id),
  reference_date date,
  extracted_at timestamptz NOT NULL DEFAULT now(),
  url text,
  file_hash text,
  row_count bigint,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (source_id, reference_date, file_hash)
);

CREATE TABLE IF NOT EXISTS enrich.company_facts (
  id bigserial PRIMARY KEY,
  cnpj_base varchar(8) NOT NULL,
  cnpj varchar(14),
  fact_type text NOT NULL,
  value_text text,
  value_numeric numeric(18, 2),
  value_date date,
  source_id smallint NOT NULL REFERENCES enrich.source_registry(id),
  source_snapshot_id bigint REFERENCES enrich.source_snapshot(id),
  observed_at timestamptz NOT NULL DEFAULT now(),
  valid_from date,
  valid_to date,
  confidence numeric(3, 2) NOT NULL DEFAULT 1.00 CHECK (confidence BETWEEN 0 AND 1),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS ix_company_facts_base ON enrich.company_facts (cnpj_base);
CREATE INDEX IF NOT EXISTS ix_company_facts_type ON enrich.company_facts (fact_type);
CREATE INDEX IF NOT EXISTS ix_company_facts_source ON enrich.company_facts (source_id);

CREATE TABLE IF NOT EXISTS enrich.company_edges (
  id bigserial PRIMARY KEY,
  source_type text NOT NULL,
  source_id text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  edge_type text NOT NULL,
  confidence numeric(3, 2) NOT NULL DEFAULT 0.50 CHECK (confidence BETWEEN 0 AND 1),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  valid_from date,
  valid_to date,
  snapshot varchar(7),
  observed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_company_edges_source ON enrich.company_edges (source_type, source_id);
CREATE INDEX IF NOT EXISTS ix_company_edges_target ON enrich.company_edges (target_type, target_id);
CREATE INDEX IF NOT EXISTS ix_company_edges_type ON enrich.company_edges (edge_type);

CREATE TABLE IF NOT EXISTS enrich.address_index (
  id bigserial PRIMARY KEY,
  cep varchar(8),
  logradouro_norm text,
  numero_norm text,
  complemento_norm text,
  bairro_norm text,
  municipio_ibge varchar(7),
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  source_id smallint REFERENCES enrich.source_registry(id),
  confidence numeric(3, 2) NOT NULL DEFAULT 0.50 CHECK (confidence BETWEEN 0 AND 1),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS ix_address_cep ON enrich.address_index (cep);
CREATE INDEX IF NOT EXISTS ix_address_key
  ON enrich.address_index (logradouro_norm, numero_norm, municipio_ibge);

CREATE TABLE IF NOT EXISTS enrich.brand_index (
  id bigserial PRIMARY KEY,
  brand_norm text NOT NULL,
  brand_label text,
  owner_cnpj varchar(14),
  process_number text,
  status text,
  source_id smallint REFERENCES enrich.source_registry(id),
  observed_at timestamptz NOT NULL DEFAULT now(),
  confidence numeric(3, 2) NOT NULL DEFAULT 0.50 CHECK (confidence BETWEEN 0 AND 1),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS ix_brand_norm ON enrich.brand_index (brand_norm);
CREATE INDEX IF NOT EXISTS ix_brand_owner ON enrich.brand_index (owner_cnpj);

CREATE TABLE IF NOT EXISTS enrich.curation (
  id bigserial PRIMARY KEY,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('provável', 'confirmado', 'descartado')),
  note text,
  reviewed_by text,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_curation_entity ON enrich.curation (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- metadados
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS core.meta (
  key text PRIMARY KEY,
  value text
);

COMMENT ON TABLE read.estabelecimentos_busca IS
  'Modelo denormalizado de leitura. Reconstruir após cada carga, nunca editar à mão.';
COMMENT ON TABLE read.rede_contatos IS
  'Contatos normalizados por CNPJ base para o mapa de ligações; contatos repetidos viram hubs.';
COMMENT ON TABLE enrich.company_facts IS
  'Fatos externos com fonte, data, validade e evidência. Não são score composto.';
COMMENT ON TABLE enrich.company_edges IS
  'Arestas de rede com evidência e confiança; não criar aresta por nome/marca isolado.';
COMMENT ON TABLE history.change_events IS
  'Diff entre snapshots oficiais; nunca sobrescrever o dado oficial.';
