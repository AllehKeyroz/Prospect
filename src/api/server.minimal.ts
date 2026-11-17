import fs from 'node:fs';
import os from 'node:os';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { config } from '../config.js';

/**
 * Servidor de diagnóstico: sobe a estrutura HTTP + UI estática sem importar
 * DuckDB, PostgreSQL ou qualquer módulo nativo. Serve para descobrir se o
 * travamento do servidor vem do banco/build nativo ou da plataforma.
 *
 * Rotas:
 *   GET /            página de diagnóstico
 *   GET /health      liveness + memória + caminhos
 *   GET /app         shell real do app (sem dados; /api/* responde 503)
 *   GET /api/*       503 "modo sem banco"
 */

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  trustProxy: true,
});

function memoryMb(): Record<string, number> {
  const memory = process.memoryUsage();
  return {
    rss_mb: Math.round(memory.rss / 1024 / 1024),
    heap_used_mb: Math.round(memory.heapUsed / 1024 / 1024),
    heap_total_mb: Math.round(memory.heapTotal / 1024 / 1024),
    external_mb: Math.round(memory.external / 1024 / 1024),
    array_buffers_mb: Math.round(memory.arrayBuffers / 1024 / 1024),
    max_rss_mb: Math.round(process.resourceUsage().maxRSS / 1024),
  };
}

function systemInfo(): Record<string, unknown> {
  return {
    cpus: os.cpus().length,
    loadavg: os.loadavg().map((value) => Number(value.toFixed(2))),
    total_mem_mb: Math.round(os.totalmem() / 1024 / 1024),
    free_mem_mb: Math.round(os.freemem() / 1024 / 1024),
    platform: process.platform,
    arch: process.arch,
  };
}

async function main(): Promise<void> {
  app.log.info('[startup] modo sem banco: nenhum driver de DB será carregado');

  await app.register(cors, { origin: true });
  await app.register(fastifyStatic, {
    root: config.publicDir,
    prefix: '/',
    index: false,
  });

  app.get('/health', async () => ({
    ok: true,
    mode: 'no-db',
    status: 'ok',
    db_enabled: false,
    db_ready: false,
    node: process.version,
    pid: process.pid,
    port: config.port,
    host: config.host,
    cwd: process.cwd(),
    public_dir: config.publicDir,
    public_exists: fs.existsSync(config.publicDir),
    data_dir: config.dataDir,
    uptime_s: Math.round(process.uptime()),
    ...memoryMb(),
    system: systemInfo(),
    env: {
      database_url: Boolean(process.env.DATABASE_URL),
      admin_token: Boolean(process.env.ADMIN_TOKEN),
      memory_limit: process.env.MEMORY_LIMIT ?? null,
      threads: process.env.THREADS ?? null,
    },
  }));

  // Readiness separado: em modo sem banco o HTTP está pronto, mas não há base.
  app.get('/ready', async (_request, reply) =>
    reply.status(503).send({
      ready: false,
      db_enabled: false,
      message: 'Modo diagnóstico sem banco. Use /health para liveness.',
    }),
  );

  app.get('/', async (_request, reply) => reply.sendFile('diagnostico.html'));
  app.get('/admin', async (_request, reply) => reply.sendFile('diagnostico.html'));
  app.get('/app', async (_request, reply) => reply.sendFile('index.html'));

  app.all('/api/*', async (_request, reply) =>
    reply.status(503).send({
      error: 'Modo diagnóstico sem banco',
      db_enabled: false,
      hint: 'Este deploy não carrega DuckDB nem PostgreSQL. Use /app para ver a UI e /health para o estado.',
    }),
  );

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.status(404).send({ error: 'Rota não encontrada' });
    }
    return reply.sendFile('diagnostico.html');
  });

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} recebido; encerrando`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: config.host });

  // Heartbeat: se o processo ou o host travar, os logs param aqui.
  setInterval(() => {
    app.log.info({
      msg: 'heartbeat',
      uptime_s: Math.round(process.uptime()),
      ...memoryMb(),
      loadavg: os.loadavg().map((value) => Number(value.toFixed(2))),
    });
  }, 60_000).unref();

  app.log.info({
    msg: 'boot',
    mode: 'no-db',
    node: process.version,
    pid: process.pid,
    port: config.port,
    host: config.host,
    cwd: process.cwd(),
    public_dir: config.publicDir,
    public_exists: fs.existsSync(config.publicDir),
    data_dir: config.dataDir,
    ...memoryMb(),
    system: systemInfo(),
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
