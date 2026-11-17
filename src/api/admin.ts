import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { isOpen, query as duckQuery } from '../db/duckdb.js';
import { pgQuery } from '../db/postgres.js';

/**
 * Administração da base: o app dispara os scripts de carga e mostra o
 * progresso em /admin. Substitui o terminal do EasyPanel.
 *
 * O app lê DuckDB; o Postgres é opcional. Por isso os jobs precisam funcionar
 * mesmo sem DATABASE_URL — quando o Postgres não responde, o estado e o log
 * ficam em memória, e o painel continua capaz de carregar a base que o app usa.
 *
 * Segurança: se ADMIN_TOKEN estiver definida, todas as rotas exigem o header
 * x-admin-token. Sem a variável, o painel fica aberto (uso interno).
 */

interface JobDef {
  script: string;
  label: string;
  reload?: boolean;
}

const JOBS: Record<string, JobDef> = {
  sample: {
    script: 'setup:sample',
    label: 'Carregar amostra no DuckDB (app)',
    reload: true,
  },
  snapshot: {
    script: 'setup:snapshot',
    label: 'Baixar e carregar snapshot no DuckDB (app)',
    reload: true,
  },
  migrate: { script: 'db:migrate', label: 'Aplicar migrações no Postgres' },
  download: { script: 'prepare:snapshot', label: 'Baixar e extrair snapshot' },
  load: { script: 'db:load:snapshot', label: 'Carregar no Postgres' },
};

const EXPECTED_FILES = 37;

export interface DbSnapshotStatus {
  ready: boolean;
  reason: string | null;
  path: string;
  exists: boolean;
}

interface AdminHooks {
  dbStatus?: () => DbSnapshotStatus;
  reload?: () => Promise<{ ready: boolean; reason: string | null }>;
  onJobSuccess?: () => Promise<{ ready: boolean; reason: string | null }>;
}

interface MemoryJob {
  id: string;
  kind: string;
  status: string;
  step: string | null;
  started_at: string;
  finished_at: string | null;
  exit_code: number | null;
  message: string | null;
}

interface MemoryLog {
  id: number;
  ts: string;
  line: string;
}

const MAX_MEMORY_JOBS = 20;
const MAX_MEMORY_LINES = 5000;
const memoryJobs = new Map<string, MemoryJob>();
const memoryLogs = new Map<string, MemoryLog[]>();
let memoryLogSeq = 0;

let currentJob: string | null = null;

function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return true;
  if (request.headers['x-admin-token'] === token) return true;
  reply.status(401).send({ error: 'Token de administração inválido' });
  return false;
}

/** Executa no Postgres, mas nunca deixa a ausência dele derrubar o painel. */
async function tryPg<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch {
    return null;
  }
}

function trimMemoryJobs(): void {
  const ordered = [...memoryJobs.values()].sort((a, b) => b.started_at.localeCompare(a.started_at));
  for (const job of ordered.slice(MAX_MEMORY_JOBS)) {
    memoryJobs.delete(job.id);
    memoryLogs.delete(job.id);
  }
}

function createMemoryJob(kind: string, label: string): MemoryJob {
  const job: MemoryJob = {
    id: randomUUID(),
    kind,
    status: 'running',
    step: label,
    started_at: new Date().toISOString(),
    finished_at: null,
    exit_code: null,
    message: null,
  };
  memoryJobs.set(job.id, job);
  memoryLogs.set(job.id, []);
  trimMemoryJobs();
  return job;
}

async function appendLog(jobId: string, line: string): Promise<void> {
  if (!line.trim()) return;

  // Espelho em memória: é o único registro garantido quando não há Postgres.
  const logs = memoryLogs.get(jobId) ?? [];
  logs.push({ id: ++memoryLogSeq, ts: new Date().toISOString(), line });
  if (logs.length > MAX_MEMORY_LINES) logs.splice(0, logs.length - MAX_MEMORY_LINES);
  memoryLogs.set(jobId, logs);

  await tryPg(() =>
    pgQuery('INSERT INTO app.job_logs (job_id, line) VALUES ($1, $2)', [jobId, line]),
  );
}

async function setJob(
  jobId: string,
  fields: { status?: string; step?: string; exitCode?: number | null; message?: string },
): Promise<void> {
  const memory = memoryJobs.get(jobId);
  if (memory) {
    if (fields.status) memory.status = fields.status;
    if (fields.step) memory.step = fields.step;
    if (fields.exitCode !== undefined) memory.exit_code = fields.exitCode;
    if (fields.message !== undefined) memory.message = fields.message;
    if (['success', 'error', 'cancelled'].includes(fields.status ?? '')) {
      memory.finished_at = new Date().toISOString();
    }
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  if (fields.status) {
    values.push(fields.status);
    sets.push(`status = $${values.length}`);
  }
  if (fields.step) {
    values.push(fields.step);
    sets.push(`step = $${values.length}`);
  }
  if (fields.exitCode !== undefined) {
    values.push(fields.exitCode);
    sets.push(`exit_code = $${values.length}`);
  }
  if (fields.message !== undefined) {
    values.push(fields.message);
    sets.push(`message = $${values.length}`);
  }
  if (sets.length === 0) return;
  if (fields.status === 'success' || fields.status === 'error' || fields.status === 'cancelled') {
    sets.push('finished_at = now()');
  }
  values.push(jobId);
  await tryPg(() => pgQuery(`UPDATE app.jobs SET ${sets.join(', ')} WHERE id = $${values.length}`, values));
}

function startJob(kind: string, jobId: string, hooks: AdminHooks): void {
  const def = JOBS[kind];
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(npmCommand, ['run', def.script], {
    cwd: process.cwd(),
    env: { ...process.env, FORCE_COLOR: '0' },
    shell: process.platform === 'win32',
  });

  currentJob = jobId;

  const push = (chunk: Buffer, stream: 'out' | 'err') => {
    const text = chunk.toString('utf8');
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) void appendLog(jobId, stream === 'err' ? `[err] ${line}` : line);
    }
  };

  child.stdout.on('data', (chunk: Buffer) => push(chunk, 'out'));
  child.stderr.on('data', (chunk: Buffer) => push(chunk, 'err'));

  child.on('error', (error) => {
    void appendLog(jobId, `[falha ao iniciar] ${error.message}`);
    void setJob(jobId, { status: 'error', message: error.message, exitCode: -1 });
    currentJob = null;
  });

  child.on('close', (code) => {
    void (async () => {
      const ok = code === 0;
      await setJob(jobId, {
        status: ok ? 'success' : 'error',
        exitCode: code,
        message: ok ? `${def.label}: concluído` : `${def.label}: terminou com código ${code}`,
      });

      if (ok && def.reload && hooks.onJobSuccess) {
        try {
          const status = await hooks.onJobSuccess();
          await appendLog(
            jobId,
            status.ready
              ? '[app] base recarregada; as rotas já estão respondendo'
              : `[app] carga concluída, mas a base não abriu: ${status.reason ?? 'motivo desconhecido'}`,
          );
        } catch (error) {
          await appendLog(jobId, `[app] falha ao recarregar a base: ${(error as Error).message}`);
        }
      }

      currentJob = null;
    })();
  });
}

async function latestJob(): Promise<Record<string, unknown> | null> {
  const fromPg = await tryPg(() =>
    pgQuery<Record<string, unknown>>(
      'SELECT id, kind, status, step, started_at, finished_at, exit_code, message FROM app.jobs ORDER BY started_at DESC NULLS LAST LIMIT 1',
    ),
  );
  if (fromPg?.rows.length) return fromPg.rows[0];

  const ordered = [...memoryJobs.values()].sort((a, b) => b.started_at.localeCompare(a.started_at));
  return ordered[0] ? { ...ordered[0] } : null;
}

async function duckdbOverview(): Promise<{
  ready: boolean;
  reason: string | null;
  path: string;
  exists: boolean;
  bytes: number;
  counts: Record<string, number>;
  meta: Record<string, string>;
}> {
  const path = config.dbPath;
  let bytes = 0;
  try {
    bytes = fs.statSync(path).size;
  } catch {
    bytes = 0;
  }

  const base = {
    ready: isOpen(),
    reason: null as string | null,
    path,
    exists: bytes > 0,
    bytes,
    counts: {} as Record<string, number>,
    meta: {} as Record<string, string>,
  };

  if (!isOpen()) return base;

  try {
    const metaRows = await duckQuery<{ key: string; value: string }>('SELECT key, value FROM meta');
    base.meta = Object.fromEntries(metaRows.map((row) => [row.key, row.value]));
    const counts = await duckQuery<Record<string, unknown>>(`
      SELECT
        (SELECT count(*) FROM empresas) AS empresas,
        (SELECT count(*) FROM estabelecimentos) AS estabelecimentos,
        (SELECT count(*) FROM socios) AS socios,
        (SELECT count(*) FROM simples) AS simples,
        (SELECT count(*) FROM estabelecimentos_busca) AS estabelecimentos_busca,
        (SELECT count(*) FROM rede_contatos) AS rede_contatos
    `);
    const row = counts[0] ?? {};
    base.counts = Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, Number(value ?? 0)]),
    );
  } catch (error) {
    base.ready = false;
    base.reason = (error as Error).message;
  }

  return base;
}

export async function registerAdminRoutes(app: FastifyInstance, hooks: AdminHooks = {}): Promise<void> {
  app.get('/api/admin/overview', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;

    const snapshot = config.snapshot;
    const rawDir = path.join(config.dataDir, 'raw', snapshot);
    const extractedDir = path.join(config.dataDir, 'extracted', snapshot);

    let files: Array<{ name: string; bytes: number; ready: boolean }> = [];
    try {
      files = fs
        .readdirSync(rawDir)
        .filter((name) => name.toLowerCase().endsWith('.zip'))
        .sort()
        .map((name) => {
          const full = path.join(rawDir, name);
          const bytes = fs.statSync(full).size;
          const partial = fs.existsSync(`${full}.part`) || fs.existsSync(`${full}.aria2`);
          return { name, bytes, ready: !partial };
        });
    } catch {
      files = [];
    }

    const duckdb = await duckdbOverview();
    const status = hooks.dbStatus?.();
    if (status) {
      duckdb.path = status.path;
      duckdb.exists = status.exists;
      if (!status.ready) {
        duckdb.ready = false;
        duckdb.reason = status.reason ?? duckdb.reason;
      }
    }

    let pgReady = false;
    let pgCounts: Record<string, number> = {};
    let pgMeta: Record<string, string> = {};
    let progress: Array<{ section: string; file: string; loaded_at: string }> = [];

    const countsResult = await tryPg(() =>
      pgQuery<{ name: string; n: string }>(`
        SELECT 'empresas' AS name, count(*)::text AS n FROM core.empresas
        UNION ALL SELECT 'estabelecimentos', count(*)::text FROM core.estabelecimentos
        UNION ALL SELECT 'socios', count(*)::text FROM core.socios
        UNION ALL SELECT 'simples', count(*)::text FROM core.simples
        UNION ALL SELECT 'estabelecimentos_busca', count(*)::text FROM read.estabelecimentos_busca
        UNION ALL SELECT 'rede_contatos', count(*)::text FROM read.rede_contatos
      `),
    );
    if (countsResult) {
      pgReady = true;
      pgCounts = Object.fromEntries(countsResult.rows.map((row) => [row.name, Number(row.n)]));
    }

    const metaResult = await tryPg(() =>
      pgQuery<{ key: string; value: string }>('SELECT key, value FROM core.meta ORDER BY key'),
    );
    if (metaResult) {
      pgMeta = Object.fromEntries(metaResult.rows.map((row) => [row.key, row.value]));
    }

    const progressResult = await tryPg(() =>
      pgQuery<{ section: string; file: string; loaded_at: string }>(
        'SELECT section, file, loaded_at::text FROM core.load_progress ORDER BY loaded_at DESC LIMIT 50',
      ),
    );
    if (progressResult) {
      progress = progressResult.rows;
    }

    return {
      snapshot,
      // Compatibilidade: db_ready agora significa "o app consegue consultar".
      db_ready: duckdb.ready,
      duckdb,
      postgres: {
        configured: Boolean(process.env.DATABASE_URL),
        ready: pgReady,
        counts: pgCounts,
        meta: pgMeta,
      },
      files,
      files_expected: EXPECTED_FILES,
      extracted: fs.existsSync(extractedDir),
      progress,
      job: await latestJob(),
      running: currentJob,
    };
  });

  app.get('/api/admin/db-status', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    return hooks.dbStatus?.() ?? { ready: isOpen(), reason: null, path: config.dbPath, exists: false };
  });

  app.post('/api/admin/reload', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    if (!hooks.reload) return reply.status(501).send({ error: 'Recarga indisponível' });
    const status = await hooks.reload();
    return { ...status, db_path: config.dbPath };
  });

  app.post('/api/admin/jobs', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const body = request.body as { kind?: string } | undefined;
    const kind = body?.kind;
    if (!kind || !JOBS[kind]) {
      return reply.status(400).send({ error: `kind inválido. Use: ${Object.keys(JOBS).join(', ')}` });
    }
    if (currentJob) {
      return reply.status(409).send({ error: 'Já existe uma carga em execução' });
    }

    const memory = createMemoryJob(kind, JOBS[kind].label);
    await tryPg(() =>
      pgQuery(
        `INSERT INTO app.jobs (id, kind, status, step, started_at)
         VALUES ($1, $2, 'running', $3, now())`,
        [memory.id, kind, JOBS[kind].label],
      ),
    );

    startJob(kind, memory.id, hooks);
    return { id: memory.id, kind, status: 'running' };
  });

  app.get('/api/admin/jobs/:id/logs', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const after = Number((request.query as { after?: string }).after ?? 0) || 0;

    const fromPg = await tryPg(() =>
      pgQuery<{ id: string; line: string; ts: string }>(
        'SELECT id::text, line, ts::text FROM app.job_logs WHERE job_id = $1 AND id > $2 ORDER BY id LIMIT 500',
        [id, after],
      ),
    );

    if (fromPg) {
      const job = await tryPg(() =>
        pgQuery<Record<string, unknown>>(
          'SELECT id, status, step, message FROM app.jobs WHERE id = $1',
          [id],
        ),
      );
      return {
        source: 'postgres',
        logs: fromPg.rows,
        job: job?.rows[0] ?? memoryJobs.get(id) ?? null,
      };
    }

    const logs = (memoryLogs.get(id) ?? []).filter((entry) => entry.id > after).slice(0, 500);
    return {
      source: 'memory',
      logs,
      job: memoryJobs.get(id) ?? null,
    };
  });
}
