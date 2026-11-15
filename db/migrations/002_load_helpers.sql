-- Prospect — helpers e tabelas auxiliares da carga PostgreSQL
--
-- Idempotente. Aplicada por `npm run db:migrate`.
--
-- Os CSVs da Receita chegam como texto: datas AAAAMMDD (às vezes vazias ou
-- zeradas) e capital social no formato "1.234,56". As funções abaixo concentram
-- esse parsing para que a carga não dependa de CAST direto.

CREATE OR REPLACE FUNCTION core.parse_date(value text)
RETURNS date
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF value IS NULL OR btrim(value) IN ('', '0', '00000000') THEN
    RETURN NULL;
  END IF;
  RETURN to_date(btrim(value), 'YYYYMMDD');
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION core.parse_numeric(value text)
RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF value IS NULL OR btrim(value) = '' THEN
    RETURN NULL;
  END IF;
  RETURN replace(btrim(value), ',', '.')::numeric(18, 2);
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END;
$$;

-- De-para município RFB (4 dígitos) -> IBGE (7 dígitos), por UF.
-- Mapa, dashboard e busca usam IBGE; a Receita só publica o código de 4 dígitos.
CREATE TABLE IF NOT EXISTS core.municipio_rfb_ibge (
  municipio_codigo varchar(4) NOT NULL,
  uf varchar(2) NOT NULL,
  municipio_ibge varchar(7) NOT NULL,
  regiao text,
  PRIMARY KEY (municipio_codigo, uf)
);

-- Contagem de sócios por empresa, materializada na carga.
-- Evita uma subconsulta sobre core.socios ao reconstruir read.estabelecimentos_busca.
CREATE TABLE IF NOT EXISTS core.socios_count (
  cnpj_base varchar(8) PRIMARY KEY,
  socios_count integer NOT NULL
);
