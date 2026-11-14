# AGENTS.md

Internal CNPJ market-intelligence app: Fastify + DuckDB API, static HTML/JS UI, MapLibre. Data comes from Receita Federal open CNPJ files. Not a public SaaS.

## Run and verify

```bash
npm install
cp .env.example .env        # Windows: Copy-Item .env.example .env
npm run sample              # ~3 min: downloads shard 1 into data/sample/
npm run ingest:sample       # ~5 s: recreates data/cnpj.duckdb
npm run dev                 # http://localhost:3000
```

- `npm start` serves compiled code from `dist/src/api/server.js`; run `npm run build` first. The `src/` segment is expected (`rootDir: "."`).
- **Stop the API before any `ingest:*` command.** Ingest deletes/recreates `data/cnpj.duckdb`; on Windows the running server holds the file lock.
- Verification order: `npm run typecheck && npm test && npm run build`. There is no lint script.
- Single test: `npx vitest run test/queryBuilder.test.ts`.
- Frontend syntax check: `node --check public/app.js` (there is no frontend build).
- Full snapshot: `npm run prepare:snapshot` then `npm run ingest:snapshot`. Implemented but only exercised on small inputs, not the full 7.27 GB / ~26 GB run. Do not present local results as all-Brazil.
- Historical 2019: `npm run history:download-2019` (20 fixed-width ZIPs, ~5 GB) and `npm run history:validate-2019` (writes `docs/historico/2019-validacao.{json,md}`).

## Data reality

- The local DB is a **50k-establishment sample** (CNPJ base `00000000–04631960`, snapshot `2026-10`), not Brazil.
- `data/` is gitignored: DBs, ZIPs and extracted CSVs must never be committed.
- Official monthly snapshots exist for `2023-05` through `2026-10` at `<SOURCE_BASE>/<YYYY-MM>/`; discovery uses WebDAV `PROPFIND`. `SOURCE_BASE` already includes `/public.php/webdav`. A Casa dos Dados mirror covers `2023-03`/`2023-04`.
- Historical coverage: the current snapshot has company opening/closing dates back to 1901. Wayback has 2019 ZIPs and a partial 2020 capture; there is no bulk 2000–2018 source. Validate uncertain archives by sampling against official data before merging; never overwrite official data with uncertain data.
- Raw RFB CSVs are Latin-1, `;`-delimited, no header. `prepare:snapshot` transcodes to UTF-8; `load.ts` expects UTF-8. The sample generator writes quoted UTF-8 CSVs.
- The 2019 Wayback package is **not** CSV: it is a fixed-width 1,200-char layout with record types `1F` (company/establishment) and `2F` (partner). Use `src/history/wayback2019.ts` offsets; don't feed it to the modern CSV loader.
- CNPJ is always **text**. Alphanumeric CNPJ is in production since 31/07/2026. Never parse/cast CNPJ to integer. Partner CPF is masked by RFB and cannot be reconstructed.
- Two municipality IDs: `municipio_codigo` is the 4-digit RFB code; `municipio_ibge` is the 7-digit IBGE code. Map/dashboard use IBGE.

## Non-obvious architecture

- `estabelecimentos_busca` is the denormalized read table for search, map and dashboard. Rebuild it through the loader; don't patch derived columns ad hoc.
- `rede_contatos` is the normalized contact table behind the network graph: one row per CNPJ base + `email`/`telefone`/`endereco`/`marca`. It is built during ingest from `estabelecimentos` and is required by `/api/rede/empresa/:cnpj` and the passport network summary.
- `queryBuilder.ts` owns list/stats/dashboard SQL; `geoQueries.ts` owns map/market/timeline; `networkQueries.ts` owns partner/contact network SQL. All user values go through named parameters, never string interpolation.
- DuckDB `getRowObjectsJson()` returns decimals/bigints as strings. Routes normalize with `asNumber`/`asNullableNumber`; preserve that boundary when adding endpoints.
- `buildTimelineQuery` intentionally drops `situacao` and `idade` filters so closed companies still appear in births/deaths. Don't "fix" this without a product decision.
- `buildCompanyGraph` is a pure builder: network SQL returns flat rows, then nodes/edges are deduplicated there. Repeated contacts become hub nodes; never expand a hub into pairwise company edges.
- `hubQueries.ts` powers automatic network discovery (`/api/rede/hubs`, `/api/rede/hub`): it finds repeated emails/phones/addresses/brands and opens a hub graph without requiring the user to know a CNPJ.
- Graph rings are semantic: ring 0 = center/hub, ring 1 = direct connection, ring 2 = partners/companies in the second layer (purple), ring 3 = companies reached through those partners (pink). All nodes must render labels, not only the center.
- The graph layout is **radial by ring**, not force-directed: center, ring 1, ring 2, ring 3 expand outward with curved edges. Do not replace it with a force layout that lets edges overlap. SVG supports pan, Ctrl/Cmd+wheel zoom and node dragging.
- Page scroll is the default. Do not make the hub list an inner scroll container, and do not capture plain wheel events on the graph. MapLibre uses `cooperativeGestures: true` so wheel scrolls the page; Ctrl/Cmd+wheel zooms.
- The passport is assembled in `src/api/passport.ts` from the detail rows; dates and events are facts from the current snapshot, not a historical time machine.
- Filters in Busca, Mapa, Dashboard and Rede are auto-applied on change (debounced where needed). Do not reintroduce a state where the visible data depends on pressing "Aplicar".
- The network map must load `public/geo/estados.geojson` as a visible Brazil layer; a blank ocean with a dot is a regression.
- The API opens the analytics DB read-only with 4 connections; ingest opens it read-write with 1. They cannot safely share the same file at the same time.
- Saved searches use a separate `data/app.duckdb`, created automatically at startup; it is not part of ingest.
- `public/geo/municipios_ibge.csv` is required by the loader at `path.resolve('public/geo/...')`. Regenerate committed geo assets with `npm run geo:build`; run commands from the repo root.
- No frontend bundler: `public/app.js` is served raw and imports MapLibre from `/vendor/maplibre-gl.mjs`, with the worker set via `setWorkerUrl`. After upgrading `maplibre-gl`, re-copy `maplibre-gl.mjs`, `maplibre-gl-worker.mjs` and `maplibre-gl.css` from `node_modules/maplibre-gl/dist/` into `public/vendor/`. Never add a CDN.
- ESM/NodeNext: local TS imports need the `.js` suffix, e.g. `../lib/cnpj.js`.
- `explore/` is scratch/probe material, not application code.

## Product constraints

- Internal use only. No AI inside the product; API/MCP for external AI comes later. No external runtime APIs: MapLibre and IBGE geometry are local.
- **No composite score.** `fit_score` was removed from the API/UI/CSV; do not reintroduce it or add new scoring. Use explicit facts/metrics (age, capital, units, active share, centrality, contactability) and let the user choose the ranking.
- UI copy is pt-BR; keep it that way.
- Planned direction: company historical passport, connection/network graph (partners, emails, phones, addresses, brands), accounting-firm/hub discovery, franchise/network explorer. Model typed edges with evidence/confidence; represent repeated contacts as hubs, never n² pairwise edges.
- Franchises are inferred (there is no franchise field): brand tokens, shared partners/contacts/addresses, same CNAE, geographic spread, plus manual curation. There is no revenue data; never rank units by revenue.

## Change checkpoints

- Adding a filter means updating the Zod schema (`src/api/schemas.ts`), `buildWhere`, and the query-builder tests.
- Adding a column used by list/map/dashboard means adding it to `estabelecimentos_busca` in `src/db/schema.ts` and rebuilding the DB.
- Keep the `snapshot` column and `meta` table in sync; `/health` reads `meta`.
- README documents deploy/EasyPanel and data flow. When README and scripts/config disagree, trust the executable source.
- UI has five views: `Mapa`, `Busca`, `Rede`, `Dashboard`, `Dados`. Hash routing supports `#busca`, `#dashboard`, `#dados`, and `#rede=<cnpj>`.
- `Rede` opens with automatically identified hubs, not an empty CNPJ prompt. Typing a company name shows live suggestions; selecting one replaces the input with the formatted CNPJ.
- Labels must distinguish the local sample (`50.000 estabelecimentos`) from the 2019 archive (`1.902.007 empresas` in file 01). They are different universes and must never be presented as the same total.
- Historical coverage is deliberately layered (`oficial`, `validado`, `reconstruido`, `sem_fonte`); never present reconstructed 2000–2018 as an official market snapshot.
