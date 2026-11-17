#!/bin/sh
# Loader server-side: roda dentro do container do Postgres do Supabase.
# Baixa os ZIPs da Receita, extrai com python3 e carrega via psql \copy.
# Injetado e iniciado por /pg/query (postgres-meta). Nada de porta aberta.
set -u

BASE="${BASE:-https://arquivos.receitafederal.gov.br/public.php/webdav/2026-10}"
AUTH="${AUTH:-YggdBLfdninEJX9:}"
SNAP="${SNAP:-2026-10}"
RAW="/tmp/raw"
LOG="/tmp/load.log"
DB="${DB:-postgres}"

mkdir -p "$RAW"
: > "$LOG"
exec >>"$LOG" 2>&1

say() { echo "[$(date -u +%H:%M:%S)] $*"; }

# --- SQL ------------------------------------------------------------------

psql -q -d "$DB" -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA IF NOT EXISTS _load;
CREATE TABLE IF NOT EXISTS _load.stg_empresas (c0 text, c1 text, c2 text, c3 text, c4 text, c5 text, c6 text);
CREATE TABLE IF NOT EXISTS _load.stg_estabelecimentos (
  c0 text, c1 text, c2 text, c3 text, c4 text, c5 text, c6 text, c7 text, c8 text, c9 text,
  c10 text, c11 text, c12 text, c13 text, c14 text, c15 text, c16 text, c17 text, c18 text,
  c19 text, c20 text, c21 text, c22 text, c23 text, c24 text, c25 text, c26 text, c27 text,
  c28 text, c29 text);
CREATE TABLE IF NOT EXISTS _load.stg_socios (
  c0 text, c1 text, c2 text, c3 text, c4 text, c5 text, c6 text, c7 text, c8 text, c9 text, c10 text);
CREATE TABLE IF NOT EXISTS _load.stg_simples (c0 text, c1 text, c2 text, c3 text, c4 text, c5 text, c6 text);
CREATE TABLE IF NOT EXISTS _load.stg_dim (codigo text, descricao text);
SQL

psql -q -d "$DB" -v ON_ERROR_STOP=1 <<'SQL'
CREATE OR REPLACE FUNCTION _load.run_empresas(snapshot text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  INSERT INTO core.empresas (cnpj_base, razao_social, razao_social_busca, natureza_juridica,
    qualificacao_responsavel, capital_social, porte, ente_federativo, snapshot)
  SELECT upper(btrim(c0)), nullif(btrim(c1), ''), coalesce(core.normalize_text(c1), ''),
    nullif(btrim(c2), ''), nullif(btrim(c3), ''), core.parse_numeric(c4),
    nullif(btrim(c5), ''), nullif(btrim(c6), ''), snapshot
  FROM _load.stg_empresas WHERE btrim(c0) <> ''
  ON CONFLICT (cnpj_base) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION _load.run_estabelecimentos(snapshot text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  INSERT INTO core.estabelecimentos (
    cnpj, cnpj_base, cnpj_ordem, cnpj_dv, matriz_filial, nome_fantasia, nome_fantasia_busca,
    situacao, data_situacao, motivo, nome_cidade_exterior, pais, data_inicio, cnae_principal,
    cnaes_secundarios, tipo_logradouro, logradouro, numero, complemento, bairro, cep, uf,
    municipio_codigo, ddd1, telefone1, ddd2, telefone2, ddd_fax, fax, email,
    situacao_especial, data_situacao_especial, snapshot)
  SELECT
    upper(btrim(c0)) || upper(btrim(c1)) || btrim(c2), upper(btrim(c0)), upper(btrim(c1)), btrim(c2),
    nullif(btrim(c3), ''), nullif(btrim(c4), ''), coalesce(core.normalize_text(c4), ''),
    nullif(btrim(c5), ''), core.parse_date(c6), nullif(btrim(c7), ''), nullif(btrim(c8), ''),
    nullif(btrim(c9), ''), core.parse_date(c10), nullif(btrim(c11), ''),
    coalesce(string_to_array(nullif(btrim(c12), ''), ','), '{}'),
    nullif(btrim(c13), ''), nullif(btrim(c14), ''), nullif(btrim(c15), ''), nullif(btrim(c16), ''),
    nullif(btrim(c17), ''), nullif(btrim(c18), ''), coalesce(nullif(btrim(c19), ''), 'XX'),
    nullif(btrim(c20), ''),
    case when ltrim(btrim(c21), '0') ~ '^[0-9]{2}$' then ltrim(btrim(c21), '0') end,
    nullif(btrim(c22), ''),
    case when ltrim(btrim(c23), '0') ~ '^[0-9]{2}$' then ltrim(btrim(c23), '0') end,
    nullif(btrim(c24), ''),
    case when ltrim(btrim(c25), '0') ~ '^[0-9]{2}$' then ltrim(btrim(c25), '0') end,
    nullif(btrim(c26), ''), lower(nullif(btrim(c27), '')), nullif(btrim(c28), ''),
    core.parse_date(c29), snapshot
  FROM _load.stg_estabelecimentos WHERE btrim(c0) <> ''
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION _load.run_socios(snapshot text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  INSERT INTO core.socios (cnpj_base, identificador_socio, nome_socio, nome_socio_busca,
    cpf_cnpj_socio, qualificacao_socio, data_entrada, pais, representante_legal,
    nome_representante, qualificacao_representante, faixa_etaria, snapshot)
  SELECT upper(btrim(c0)), nullif(btrim(c1), ''), nullif(btrim(c2), ''),
    coalesce(core.normalize_text(c2), ''), nullif(btrim(c3), ''), nullif(btrim(c4), ''),
    core.parse_date(c5), nullif(btrim(c6), ''), nullif(btrim(c7), ''), nullif(btrim(c8), ''),
    nullif(btrim(c9), ''), nullif(btrim(c10), ''), snapshot
  FROM _load.stg_socios WHERE btrim(c0) <> '';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION _load.run_simples(snapshot text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  INSERT INTO core.simples (cnpj_base, opcao_simples, data_opcao_simples, data_exclusao_simples,
    opcao_mei, data_opcao_mei, data_exclusao_mei, snapshot)
  SELECT upper(btrim(c0)), nullif(btrim(c1), ''), core.parse_date(c2), core.parse_date(c3),
    nullif(btrim(c4), ''), core.parse_date(c5), core.parse_date(c6), snapshot
  FROM _load.stg_simples WHERE btrim(c0) <> ''
  ON CONFLICT (cnpj_base) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
SQL

# --- helpers --------------------------------------------------------------

get() {
  url="$BASE/$1"
  dest="$RAW/$1"
  say "download $1"
  curl -sf -C - -u "$AUTH" -o "$dest" "$url"
  rc=$?
  if [ $rc -eq 0 ] || [ $rc -eq 33 ]; then
    return 0
  fi
  say "ERRO download $1 (rc=$rc)"
  return 1
}

extract() { # $1 zip name, $2 csv name
  python3 - "$RAW/$1" "$RAW/$2" <<'PY'
import zipfile, sys, shutil
z = zipfile.ZipFile(sys.argv[1])
name = z.namelist()[0]
with z.open(name) as src, open(sys.argv[2], 'wb') as dst:
    shutil.copyfileobj(src, dst)
PY
}

copy_in() { # $1 table, $2 csv
  psql -q -d "$DB" -v ON_ERROR_STOP=1 -c "\copy $1 FROM '$2' WITH (FORMAT csv, DELIMITER ';', QUOTE '\"', ENCODING 'LATIN1')"
}

load_dim() { # $1 file.zip, $2 table
  if done_marker "dim_$2"; then say "skip $1"; return 0; fi
  get "$1" || return 0
  extract "$1" "$1.csv" || { say "ERRO extract $1"; return 0; }
  psql -q -d "$DB" -v ON_ERROR_STOP=1 -c "TRUNCATE _load.stg_dim" || return 0
  copy_in _load.stg_dim "$RAW/$1.csv" || { say "ERRO copy $1"; return 0; }
  if psql -q -d "$DB" -v ON_ERROR_STOP=1 -c \
    "INSERT INTO core.$2 (codigo, descricao)
     SELECT nullif(btrim(codigo), ''), max(nullif(btrim(descricao), ''))
     FROM _load.stg_dim WHERE btrim(codigo) <> '' GROUP BY 1
     ON CONFLICT (codigo) DO UPDATE SET descricao = EXCLUDED.descricao"; then
    say "ok $2"
    mark "dim_$2"
  else
    say "ERRO insert $2"
  fi
  rm -f "$RAW/$1" "$RAW/$1.csv"
}

done_marker() { [ -f "/tmp/done_$1" ]; }
mark() { touch "/tmp/done_$1"; }

# --- execução --------------------------------------------------------------

say "=== inicio $SNAP ==="

for pair in "Cnaes.zip:dim_cnae" "Motivos.zip:dim_motivo" "Municipios.zip:dim_municipio" \
            "Naturezas.zip:dim_natureza" "Paises.zip:dim_pais" "Qualificacoes.zip:dim_qualificacao"; do
  f=${pair%%:*}; t=${pair##*:}
  load_dim "$f" "$t"
done

load_group() { # $1 prefixo, $2 staging, $3 função
  i=0
  while [ $i -le 9 ]; do
    name="$1$i.zip"
    csv="$1$i.csv"
    if done_marker "$1$i"; then say "skip $name"; i=$((i+1)); continue; fi
    if get "$name"; then
      if extract "$name" "$csv"; then
        psql -q -d "$DB" -v ON_ERROR_STOP=1 -c "TRUNCATE $2"
        if copy_in "$2" "$RAW/$csv"; then
          n=$(psql -tA -d "$DB" -v ON_ERROR_STOP=1 -c "select _load.$3('$SNAP')" 2>>"$LOG")
          if [ -n "$n" ]; then
            say "ok $name -> +$n"
            mark "$1$i"
            rm -f "$RAW/$name" "$RAW/$csv"
          else
            say "ERRO insert $name"
          fi
        else
          say "ERRO copy $name"
        fi
      else
        say "ERRO extract $name"
      fi
    fi
    i=$((i+1))
  done
}

load_group Empresas _load.stg_empresas run_empresas
load_group Estabelecimentos _load.stg_estabelecimentos run_estabelecimentos
load_group Socios _load.stg_socios run_socios

if ! done_marker Simples; then
  if get "Simples.zip"; then
    extract "Simples.zip" "Simples.csv"
    psql -q -d "$DB" -v ON_ERROR_STOP=1 -c "TRUNCATE _load.stg_simples"
    copy_in _load.stg_simples "$RAW/Simples.csv"
    n=$(psql -tA -d "$DB" -v ON_ERROR_STOP=1 -c "select _load.run_simples('$SNAP')")
    say "ok Simples -> +$n"
    mark Simples
    rm -f "$RAW/Simples.zip" "$RAW/Simples.csv"
  fi
fi

say "=== carga concluida ==="
psql -tA -d "$DB" -c "select 'empresas='||count(*) from core.empresas union all select 'estabelecimentos='||count(*) from core.estabelecimentos union all select 'socios='||count(*) from core.socios" >> "$LOG" 2>&1
