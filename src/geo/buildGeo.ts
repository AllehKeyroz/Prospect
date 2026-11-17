import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

/**
 * Gera os arquivos estáticos do mapa a partir das malhas e localidades do IBGE.
 *
 * - public/geo/regioes.geojson
 * - public/geo/estados.geojson
 * - public/geo/municipios.geojson
 * - public/geo/municipios_ibge.csv
 *
 * Nenhuma chamada externa acontece em runtime: o build baixa uma vez
 * e o mapa consome apenas os arquivos locais.
 */

const OUT_DIR = path.join(config.publicDir, 'geo');
const RAW_DIR = path.join(config.dataDir, 'geo', 'raw');

const SOURCES = {
  localidades:
    'https://servicodados.ibge.gov.br/api/v1/localidades/municipios',
  regioes:
    'https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo%2Bjson&qualidade=minima&intrarregiao=regiao',
  estados:
    'https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo%2Bjson&qualidade=minima&intrarregiao=UF',
  municipios:
    'https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo%2Bjson&qualidade=minima&intrarregiao=municipio',
};

type Uf = {
  id: number;
  sigla: string;
  nome: string;
  regiao: { id: number; sigla: string; nome: string };
};

type Localidade = {
  id: number;
  nome: string;
  microrregiao?: { mesorregiao: { UF: Uf } } | null;
  'regiao-imediata'?: {
    'regiao-intermediaria': { UF: Uf };
  };
};

type Feature = {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: unknown;
};

type FeatureCollection = {
  type: 'FeatureCollection';
  features: Feature[];
};

async function download(name: string, url: string): Promise<Buffer> {
  await mkdir(RAW_DIR, { recursive: true });
  const file = path.join(RAW_DIR, name);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) {
    console.log(`[skip] ${name}`);
    return fs.readFileSync(file);
  }
  console.log(`[download] ${name}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(file, buffer);
  return buffer;
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  const localidades = JSON.parse(
    (await download('localidades-municipios.json', SOURCES.localidades)).toString('utf8'),
  ) as Localidade[];

  const regioesRaw = JSON.parse(
    (await download('regioes-raw.geojson', SOURCES.regioes)).toString('utf8'),
  ) as FeatureCollection;
  const estadosRaw = JSON.parse(
    (await download('estados-raw.geojson', SOURCES.estados)).toString('utf8'),
  ) as FeatureCollection;
  const municipiosRaw = JSON.parse(
    (await download('municipios-raw.geojson', SOURCES.municipios)).toString('utf8'),
  ) as FeatureCollection;

  const municipios = new Map<
    string,
    { nome: string; uf: string; regiao: string; regiaoCodigo: string }
  >();
  const estados = new Map<
    string,
    { nome: string; uf: string; regiao: string; regiaoCodigo: string }
  >();
  const regioes = new Map<string, { nome: string; sigla: string }>();

  for (const item of localidades) {
    const uf =
      item.microrregiao?.mesorregiao?.UF ??
      item['regiao-imediata']?.['regiao-intermediaria']?.UF;
    if (!uf) {
      console.warn(`[geo] localidade sem UF: ${item.id} ${item.nome}`);
      continue;
    }
    const regiao = uf.regiao;
    municipios.set(String(item.id), {
      nome: item.nome,
      uf: uf.sigla,
      regiao: regiao.nome,
      regiaoCodigo: String(regiao.id),
    });
    estados.set(String(uf.id), {
      nome: uf.nome,
      uf: uf.sigla,
      regiao: regiao.nome,
      regiaoCodigo: String(regiao.id),
    });
    regioes.set(String(regiao.id), { nome: regiao.nome, sigla: regiao.sigla });
  }

  const enrich = (
    collection: FeatureCollection,
    lookup: Map<string, Record<string, unknown>>,
    level: string,
  ): FeatureCollection => {
    let missing = 0;
    const features = collection.features.map((feature) => {
      const code = String(feature.properties.codarea ?? '');
      const info = lookup.get(code);
      if (!info) missing++;
      return {
        ...feature,
        properties: {
          ...feature.properties,
          codigo: code,
          ...(info ?? {}),
        },
      };
    });
    console.log(`[geo] ${level}: ${features.length} feições, ${missing} sem metadados`);
    return { type: 'FeatureCollection', features };
  };

  const regioesLookup = new Map(
    Array.from(regioes.entries()).map(([id, info]) => [
      id,
      { nome: info.nome, sigla: info.sigla },
    ]),
  );
  const estadosLookup = new Map(
    Array.from(estados.entries()).map(([id, info]) => [
      id,
      { ...info, codigo: id },
    ]),
  );
  const municipiosLookup = new Map(
    Array.from(municipios.entries()).map(([id, info]) => [
      id,
      { ...info, codigo: id },
    ]),
  );

  const regioesGeo = enrich(regioesRaw, regioesLookup, 'regiões');
  const estadosGeo = enrich(estadosRaw, estadosLookup, 'estados');
  const municipiosGeo = enrich(municipiosRaw, municipiosLookup, 'municípios');

  await writeFile(path.join(OUT_DIR, 'regioes.geojson'), JSON.stringify(regioesGeo));
  await writeFile(path.join(OUT_DIR, 'estados.geojson'), JSON.stringify(estadosGeo));
  await writeFile(path.join(OUT_DIR, 'municipios.geojson'), JSON.stringify(municipiosGeo));

  const rows = ['codigo,nome,uf,regiao,regiao_codigo'];
  for (const [codigo, info] of Array.from(municipios.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    rows.push(
      [codigo, info.nome, info.uf, info.regiao, info.regiaoCodigo].map(csvCell).join(','),
    );
  }
  await writeFile(path.join(OUT_DIR, 'municipios_ibge.csv'), `${rows.join('\n')}\n`);

  console.log('\n[ok] arquivos gerados em', OUT_DIR);
  console.log(`[ok] ${municipios.size} municípios no CSV`);
  console.log(`[ok] ${estados.size} estados e ${regioes.size} regiões`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
