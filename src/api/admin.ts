import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { pgQuery } from '../db/postgres.js';

/**
 * Administração da base: o app dispara os scripts de carga e mostra o
 * progresso em /admin. Substitui o terminal do EasyPanel.
 *
 * Segurança: se ADMIN_TOKEN estiver definida, todas as rotas exigem o header
 * x-admin-token. Sem a variável, o painel fica aberto (uso interno).
 */

interface JobDef {
  script: string;
  label: string;
}

const JOBS: Record<string, JobDef> = {
  migrate: { script: 'db:migrate', label: 'Aplicar migrações no Postgres' },
  download: { script: 'prepare:snapshot', label: 'Baixar e extrair snapshot' },
  load: { script: 'db:load:snapshot', label: 'Carregar no Postgres' },
  all: { script: 'db:load:snapshot', label: 'Baixar, extrair e carregar' },
};

const EXPECTED_FILES = 37;

let currentJob: string | null = null;

function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return true;
  if (request.headers['x-admin-token'] === token) return true;
  reply.status(401).send({ error: 'Token de administração inválido' });
  return false;
}

async function appendLog(jobId: string, line: string): Promise<void> {
  if (!line.trim()) return;
  try {
    await pgQuery('INSERT INTO app.job_logs (job_id, line) VALUES ($1, $2)', [jobId, line]);
  } catch {
    // banco indisponível: o processo continua, só não registra
  }
}

async function setJob(
  jobId: string,
  fields: { status?: string; step?: string; exitCode?: number | null; message?: string },
): Promise<void> {
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
  if (fields.status === 'success' || fields.status === 'error' || fields.status === 'cancelled') {
    sets.push('finished_at = now()');
  }
  values.push(jobId);
  await pgQuery(`UPDATE app.jobs SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
}

function startJob(kind: string, jobId: string): void {
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
    const ok = code === 0;
    void setJob(jobId, {
      status: ok ? 'success' : 'error',
      exitCode: code,
      message: ok ? `${def.label}: concluído` : `${def.label}: terminou com código ${code}`,
    });
    currentJob = null;
  });
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
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

    let counts: Record<string, number> = {};
    let meta: Record<string, string> = {};
    let progress: Array<{ section: string; file: string; loaded_at: string }> = [];
    let dbReady = false;

    try {
      const result = await pgQuery<{ name: string; n: string }>(`
        SELECT 'empresas' AS name, count(*)::text AS n FROM core.empresas
        UNION ALL SELECT 'estabelecimentos', count(*)::text FROM core.estabelecimentos
        UNION ALL SELECT 'socios', count(*)::text FROM core.socios
        UNION ALL SELECT 'simples', count(*)::text FROM core.simples
        UNION ALL SELECT 'estabelecimentos_busca', count(*)::text FROM read.estabelecimentos_busca
        UNION ALL SELECT 'rede_contatos', count(*)::text FROM read.rede_contatos
      `);
      counts = Object.fromEntries(result.rows.map((row) => [row.name, Number(row.n)]));
      dbReady = true;
    } catch {
      dbReady = false;
    }

    try {
      const metaRows = await pgQuery<{ key: string; value: string }>(
        'SELECT key, value FROM core.meta ORDER BY key',
      );
      meta = Object.fromEntries(metaRows.rows.map((row) => [row.key, row.value]));
    } catch {
      meta = {};
    }

    try {
      const progressRows = await pgQuery<{ section: string; file: string; loaded_at: string }>(
        'SELECT section, file, loaded_at::text FROM core.load_progress ORDER BY loaded_at DESC LIMIT 50',
      );
      progress = progressRows.rows;
    } catch {
      progress = [];
    }

    const job = await pgQuery<Record<string, unknown>>(
      'SELECT id, kind, status, step, started_at, finished_at, exit_code, message FROM app.jobs ORDER BY started_at DESC NULLS LAST LIMIT 1',
    ).catch(() => null);

    return {
      snapshot,
      db_ready: dbReady,
      files,
      files_expected: EXPECTED_FILES,
      extracted: fs.existsSync(extractedDir),
      counts,
      meta,
      progress,
      job: job?.rows[0] ?? null,
      running: currentJob,
    };
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

    const inserted = await pgQuery<{ id: string }>(
      `INSERT INTO app.jobs (kind, status, step, started_at)
       VALUES ($1, 'running', $2, now()) RETURNING id`,
      [kind, JOBS[kind].label],
    );
    const id = inserted.rows[0].id;
    startJob(kind, id);
    return { id, kind, status: 'running' };
  });

  app.get('/api/admin/jobs/:id/logs', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const after = Number((request.query as { after?: string }).after ?? 0) || 0;

    const result = await pgQuery<{ id: string; line: string; ts: string }>(
      'SELECT id::text, line, ts::text FROM app.job_logs WHERE job_id = $1 AND id > $2 ORDER BY id LIMIT 500',
      [id, after],
    );
    const job = await pgQuery<Record<string, unknown>>(
      'SELECT id, status, step, message FROM app.jobs WHERE id = $1',
      [id],
    );
    return { logs: result.rows, job: job.rows[0] ?? null };
  });
}
