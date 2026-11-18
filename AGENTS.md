# AGENTS.md

Internal CNPJ market-intelligence app: Fastify API, static HTML/JS UI, MapLibre. Data comes from Receita Federal open CNPJ files. Not a public SaaS.

**Database direction:** PostgreSQL 17 is the target primary database (self-hosted/EasyPanel). DuckDB is the current legacy runtime store while the query layer is migrated. New structural work belongs in `db/migrations/*.sql` and `db/README.md`, not only in the DuckDB schema.

## Run and verify

```bash
npm install
npm run sample              # ~3–5 min: downloads shard 1 into data/sample/
npm run ingest:sample       # ~5 s: recreates data/cnpj.duckdb
npm run setup:sample        # sample + ingest in one command
npm run dev                 # http://localhost:3000
npm run build:minimal       # compiles the no-DB diagnostic server
npm run start:minimal       # runs it (no DuckDB/Postgres imports)
```

- `.env.example` exists and has **all values commented out**; `.env` is optional and gitignored. `src/config.ts` has working defaults (`SNAPSHOT=2026-10`, `PORT=3000`), and `DATA_DIR` alone drives the DB paths.
- **Deploy mode:** the root `Dockerfile` is the **no-DB diagnostic image** (Fastify + static only; `package.minimal.json`, `tsconfig.minimal.json`, `src/api/server.minimal.ts`). The full app is `Dockerfile.full` (DuckDB, admin, ingest). Never import DB modules in `server.minimal.ts` — the point is to not load native drivers.
- Data paths derive from `DATA_DIR` (default `data/`, Docker `/data`): `DUCKDB_PATH`, `APP_DB_PATH` and `DUCKDB_TEMP_DIR` override individually. Do not hardcode `data/...` in new code.
- `npm start` serves compiled code from `dist/src/api/server.js`; run `npm run build` first. The `src/` segment is expected (`rootDir: "."`). Build also emits `dist/test/`.
- **Stop the API before any `ingest:*` command.** Ingest deletes/recreates `data/cnpj.duckdb`; on Windows the running server holds the file lock.
- Missing or corrupt DuckDB is not fatal: the API always binds, `/health` stays 200 with `db_ready:false` + `reason`, `/api/*` returns 503, `/` serves `public/offline.html`, and `/admin` still works (it reads Postgres or falls back to in-memory job state). `/ready` is the readiness endpoint (503 until the DB opens). This is deliberate liveness/readiness separation so EasyPanel gives you a terminal instead of a restart loop.
- Verification order: `npm run typecheck && npm test && npm run build`. There is no lint script.
- Single test: `npx vitest run test/queryBuilder.test.ts`. All tests are pure unit tests (no DB, no network, no fixtures).
- Frontend syntax check: `node --check public/app.js` and `node --check public/admin.js` (no frontend build).
- Windows shortcut `iniciar.cmd`: requires `data/cnpj.duckdb`, runs `npm run build`, then serves `dist` with `HOST=127.0.0.1` and opens the browser.

## PostgreSQL vs DuckDB

- `npm run db:up` (local Postgres in `docker-compose.db.yml`, port 5433), `npm run db:migrate` (uses `DATABASE_URL`), then `npm run db:load:sample` or `npm run db:load:snapshot`. See `db/README.md` for EasyPanel sizing.
- **The app still reads DuckDB** for all business endpoints; Postgres is load-only. Only `/admin` and `/api/admin/*` query PostgreSQL (`src/db/postgres.ts`, pool of 10).
- Two scripts share the name `loadSnapshot.ts`: `npm run ingest:snapshot` → `src/ingest/loadSnapshot.ts` (DuckDB), `npm run db:load:*` → `src/db/loadSnapshot.ts` (PostgreSQL). Editing the wrong one silently changes nothing.
- Both `ingest:snapshot` and `db:load:snapshot` read `data/extracted/<SNAPSHOT>/`; `db:load:sample` reads `data/sample/` (same directory `npm run sample` fills). Run `prepare:snapshot` first for full loads.
- The Postgres loader uses `COPY` into temp tables + `INSERT ... SELECT`, drops/rebuilds 24 indexes, and rebuilds `read.*`. It is resumable via `core.load_progress`; first run truncates destinations, `--reset` forces a full reload, `--skip-migrate` skips migrations.
- Migrations: the runner applies every `db/migrations/*.sql` in filename order and records it in `app.schema_migrations`. Add a new numbered file; never edit an applied migration. With `DATABASE_URL` set, the API runs migrations **after** `app.listen` (fire-and-forget) so a Postgres outage cannot delay the healthcheck.
- `registerRoutes` is called exactly once, at boot, whether or not the DB exists; a global `onRequest` hook returns 503 for `/api/*` until DuckDB is open. Do not reintroduce a separate degraded route tree.
- `/admin` (`public/admin.html`, `public/admin.js`) starts load jobs by spawning `npm run <script>`: `sample` → `setup:sample` (DuckDB, reloads after success), `snapshot` → `setup:snapshot` (DuckDB), `migrate` → `db:migrate`, `download` → `prepare:snapshot`, `load` → `db:load:snapshot` (Postgres). `onJobSuccess` calls `reloadDatabases()` so the app starts serving without a restart. Job state/logs live in `app.jobs`/`app.job_logs` (migration 004) with an in-memory fallback when Postgres is absent.
- Admin auth: if `ADMIN_TOKEN` is set, every `/api/admin/*` call needs `x-admin-token` (the UI also accepts `?token=`); unset means open. Locally the admin pages fail gracefully without Postgres.
- `prepare:snapshot` uses `aria2c` when available (`ARIA2_CONNECTIONS`, `ARIA2_JOBS`, `USE_ARIA2=false` to disable); the Docker image ships aria2. Full snapshot = 37 ZIPs (~7.3 GB) → ~26 GB CSV. Implemented but only exercised on small inputs, never the full run; do not present local results as all-Brazil.
- Historical 2019: `npm run history:download-2019` (20 fixed-width ZIPs, ~5 GB) and `npm run history:validate-2019` (writes `docs/historico/2019-validacao.{json,md}`).

## Storage (Supabase)

- Raw RFB ZIPs live in the private Supabase bucket `cnpj-raw`, under `<SNAPSHOT>/`.
- Self-hosted Storage caps objects at **50 MB** (global `FILE_SIZE_LIMIT`). `src/tools/syncStorage.ts` downloads from RFB **server-side** and uploads 40 MB parts plus `<SNAPSHOT>/manifest.json`; parts are `_parts/<name>/part-00000`.
- Run it in the app container (server egress), never from a developer uplink: `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node dist/src/tools/syncStorage.js`.
- The loader must read the manifest and concatenate parts using each file's `chunk_size`/`parts`; do not assume a fixed chunk size.
- `src/tools/loadFromStorage.ts` + `Dockerfile.loader` (`:loader`) materialize the parts into `/data/extracted` and spawn `src/db/loadSnapshot.ts`. It must run in the Supabase network (`DATABASE_URL=postgres://postgres:...@db:5432/postgres`) and is built from `package.loader.json`/`tsconfig.loader.json` without DuckDB.
- Bucket is private; service role key only server-side. Never put it in the frontend or commit it.

## Data reality

- The local DB is a **50k-establishment sample** (CNPJ base `00000000–04631960`, snapshot `2026-10`), not Brazil.
- `data/` is gitignored: DBs, ZIPs and extracted CSVs must never be committed.
- Official monthly snapshots exist for `2023-05` through `2026-10` at `<SOURCE_BASE>/<YYYY-MM>/`; discovery uses WebDAV `PROPFIND`. `SOURCE_BASE` already includes `/public.php/webdav`. A Casa dos Dados mirror covers `2023-03`/`2023-04`.
- Historical coverage: the current snapshot has company opening/closing dates back to 1901. Wayback has 2019 ZIPs and a partial 2020 capture; there is no bulk 2000–2018 source. Validate uncertain archives by sampling against official data before merging; never overwrite official data with uncertain data.
- Raw RFB CSVs are Latin-1, `;`-delimited, no header. `prepare:snapshot` transcodes to UTF-8; both loaders expect UTF-8. The sample generator writes quoted UTF-8 CSVs.
- The 2019 Wayback package is **not** CSV: it is a fixed-width 1,200-char layout with record types `1F` (company/establishment) and `2F` (partner). Use `src/history/wayback2019.ts` offsets; don't feed it to the modern CSV loader.
- CNPJ is always **text**. Alphanumeric CNPJ is in production since 31/07/2026. Never parse/cast CNPJ to integer. Partner CPF is masked by RFB and cannot be reconstructed.
- Two municipality IDs: `municipio_codigo` is the 4-digit RFB code; `municipio_ibge` is the 7-digit IBGE code. Map/dashboard use IBGE.

## Non-obvious architecture

- `estabelecimentos_busca` is the denormalized read table for search, map and dashboard. DuckDB version: `src/db/schema.ts`; Postgres version: `db/migrations/001_init.sql` + `SQL_BUSCA` in `src/db/loadSnapshot.ts`. Rebuild through the loaders; don't patch derived columns ad hoc.
- `rede_contatos` is the normalized contact table behind the network graph: one row per CNPJ base + `email`/`telefone`/`endereco`/`marca`. Built during ingest; required by `/api/rede/empresa/:cnpj` and the passport network summary.
- `queryBuilder.ts` owns list/stats/dashboard SQL; `geoQueries.ts` owns map/market/timeline; `networkQueries.ts` owns partner/contact network SQL. All user values go through named parameters, never string interpolation.
- DuckDB `getRowObjectsJson()` returns decimals/bigints as strings. Routes normalize with `asNumber`/`asNullableNumber`; preserve that boundary when adding endpoints.
- `buildTimelineQuery` intentionally drops `situacao` and `idade` filters so closed companies still appear in births/deaths. Don't "fix" this without a product decision.
- `buildCompanyGraph` is a pure builder: network SQL returns flat rows, then nodes/edges are deduplicated there. Repeated contacts become hub nodes; never expand a hub into pairwise company edges.
- `hubQueries.ts` powers automatic network discovery (`/api/rede/hubs`, `/api/rede/hub`): it finds repeated emails/phones/addresses/brands and opens a hub graph without requiring the user to know a CNPJ.
- Graph rings are semantic: ring 0 = center/hub, ring 1 = direct connection, ring 2 = partners/companies in the second layer (purple), ring 3 = companies reached through those partners (pink). All nodes must render labels.
- The graph layout is **radial by ring**, not force-directed. Do not replace it with a force layout that lets edges overlap. SVG supports pan, Ctrl/Cmd+wheel zoom and node dragging.
- Page scroll is the default. Do not make the hub list an inner scroll container; it shows 8 rows and a "Ver mais" button. Do not capture plain wheel events on the graph. MapLibre uses `cooperativeGestures: true` so wheel scrolls the page; Ctrl/Cmd+wheel zooms.
- The graph panel has an `Expandir` mode (fixed overlay + `body.graph-expanded`); Escape closes it. Re-render the graph after toggling because its SVG dimensions change.
- The passport is assembled in `src/api/passport.ts` from detail rows; dates and events are facts from the current snapshot, not a historical time machine.
- Filters in Busca, Mapa, Dashboard and Rede are auto-applied on change (debounced where needed). Do not reintroduce a state where visible data depends on pressing "Aplicar".
- The network map must load `public/geo/estados.geojson` as a visible Brazil layer; a blank ocean with a dot is a regression.
- The API opens the analytics DB read-only with 4 connections; ingest opens it read-write with 1. On Windows they cannot share the file (the admin load fails while the API runs); on Linux ingest unlinks the file and the API reopens it through `reloadDatabases()`. Do not remove that reload.
- Saved searches use a separate `data/app.duckdb`, created automatically at startup; it is not part of ingest and is not migrated to Postgres yet.
- `public/geo/municipios_ibge.csv` is required by both loaders. Use `config.publicDir`/`config.docsDir` (resolved from cwd **and** module location) instead of `path.resolve('public')`; this keeps the app booting when the platform changes the working directory. Regenerate committed geo assets with `npm run geo:build`.
- No frontend bundler: `public/app.js` is served raw and imports MapLibre from `/vendor/maplibre-gl.mjs`, with the worker set via `setWorkerUrl`. After upgrading `maplibre-gl`, re-copy `maplibre-gl.mjs`, `maplibre-gl-worker.mjs` and `maplibre-gl.css` from `node_modules/maplibre-gl/dist/` into `public/vendor/`. Never add a CDN.
- ESM/NodeNext: local TS imports need the `.js` suffix, e.g. `../lib/cnpj.js`.
- `explore/` is scratch/probe material, not application code.
- `DEPLOY.md` is the operational guide for EasyPanel. The root `Dockerfile` deploys the no-DB diagnostic mode; the full app uses `Dockerfile.full` (or the `:full` GHCR image). There is no `docker-compose.yml` in the root (`docker-compose.local.yml` builds `Dockerfile.full`, `docker-compose.db.yml` runs local Postgres).

## Product constraints

- Internal use only. No AI inside the product; API/MCP for external AI comes later. No external runtime APIs: MapLibre and IBGE geometry are local.
- **No composite score.** `fit_score` was removed from the API/UI/CSV; do not reintroduce it or add new scoring. Use explicit facts/metrics (age, capital, units, active share, centrality, contactability) and let the user choose the ranking.
- UI copy is pt-BR; keep it that way.
- Planned direction: company historical passport, connection/network graph (partners, emails, phones, addresses, brands), accounting-firm/hub discovery, franchise/network explorer. Model typed edges with evidence/confidence; represent repeated contacts as hubs, never n² pairwise edges.
- Franchises are inferred (there is no franchise field): brand tokens, shared partners/contacts/addresses, same CNAE, geographic spread, plus manual curation. There is no revenue data; never rank units by revenue.

## Change checkpoints

- Adding a filter means updating the Zod schema (`src/api/schemas.ts`), `buildWhere`, and the query-builder tests.
- Adding a column to `estabelecimentos_busca` means touching both stores: `src/db/schema.ts` (DuckDB) and a Postgres migration plus `SQL_BUSCA` in `src/db/loadSnapshot.ts`; then rebuild/reload.
- Keep snapshot metadata in sync in both places: DuckDB `meta` (read by `/health`) and Postgres `core.meta` + `history.snapshots` (read by `/admin`).
- UI has five views: `Mapa`, `Busca`, `Rede`, `Dashboard`, `Dados`. Hash routing supports `#busca`, `#dashboard`, `#dados`, and `#rede=<cnpj>`. `/admin` is a separate page, not a tab.
- `Rede` opens with automatically identified hubs, not an empty CNPJ prompt. Typing a company name shows live suggestions; selecting one replaces the input with the formatted CNPJ.
- Labels must distinguish the local sample (`50.000 estabelecimentos`) from the 2019 archive (`1.902.007 empresas` in file 01). They are different universes and must never be presented as the same total.
- Historical coverage is deliberately layered (`oficial`, `validado`, `reconstruido`, `sem_fonte`); never present reconstructed 2000–2018 as an official market snapshot.
