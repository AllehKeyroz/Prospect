import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { config } from '../config.js';
import { closeDatabase, openDatabase } from '../db/duckdb.js';
import { closeAppDb, openAppDb } from '../db/appDb.js';
import { runMigrations } from '../db/migrate.js';
import { registerAdminRoutes } from './admin.js';
import { registerRoutes } from './routes.js';

const isProduction = process.env.NODE_ENV === 'production';

const app = Fastify({
  logger: isProduction
    ? true
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      },
  trustProxy: true,
});

app.setErrorHandler((error: unknown, request, reply) => {
  const err = error as { statusCode?: number; message?: string };
  request.log.error(error);
  if (reply.sent) return;
  reply.status(err.statusCode ?? 500).send({
    error: err.statusCode && err.statusCode < 500 ? err.message : 'Erro interno',
  });
});

function logBoot(dbReady: boolean): void {
  // Primeira linha do log em produção. Se o EasyPanel não mostrar isto, o
  // processo nem chegou a executar (problema de imagem/porta/plataforma).
  app.log.info({
    msg: 'boot',
    node: process.version,
    pid: process.pid,
    port: config.port,
    host: config.host,
    db_ready: dbReady,
    db_path: config.dbPath,
    cwd: process.cwd(),
  });
}

async function ensureSchema(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    app.log.warn('DATABASE_URL ausente: administração da base fica indisponível');
    return;
  }
  try {
    await runMigrations({
      connectionString,
      log: (message) => app.log.info(message),
    });
  } catch (error) {
    app.log.warn(`migrações não aplicadas: ${(error as Error).message}`);
  }
}

async function startDegraded(): Promise<void> {
  app.get('/health', async () => ({
    // Liveness: o processo está vivo. O banco é readiness e aparece em
    // db_ready/database; as rotas /api/* continuam 503 até a carga.
    ok: true,
    status: 'degraded',
    db_ready: false,
    database: 'missing',
    db_path: config.dbPath,
    message: 'Banco ainda não carregado. Rode npm run sample && npm run ingest:sample no terminal do serviço e reinicie.',
  }));

  // A administração da base funciona sem DuckDB: ela lê o PostgreSQL.
  await registerAdminRoutes(app);

  app.get('/', async (_request, reply) => reply.sendFile('offline.html'));

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.status(503).send({
        error: 'Banco ainda não carregado',
        hint: 'Use /admin para carregar a base no PostgreSQL.',
      });
    }
    return reply.sendFile('offline.html');
  });

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} recebido; encerrando modo degradado`);
    try {
      await app.close();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  logBoot(false);
  await app.listen({ port: config.port, host: config.host });
  app.log.error(`DuckDB ausente em ${config.dbPath}; API em modo degradado.`);
  app.log.error('Abra o terminal do serviço e rode: npm run sample && npm run ingest:sample');
}

async function main(): Promise<void> {
  await app.register(cors, { origin: true });
  await app.register(fastifyStatic, {
    root: path.resolve('public'),
    prefix: '/',
    index: false,
  });

  app.get('/admin', async (_request, reply) => reply.sendFile('admin.html'));

  await ensureSchema();

  if (!fs.existsSync(config.dbPath)) {
    await startDegraded();
    return;
  }

  app.get('/', async (_request, reply) => reply.sendFile('index.html'));

  await openDatabase({ readOnly: true });
  await openAppDb();
  await registerRoutes(app);
  await registerAdminRoutes(app);

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.status(404).send({ error: 'Rota não encontrada' });
    }
    return reply.sendFile('index.html');
  });

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} recebido; encerrando`);
    try {
      await app.close();
      await closeDatabase();
      await closeAppDb();
      process.exit(0);
    } catch (error) {
      app.log.error(error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: config.host });
  logBoot(true);
  app.log.info(`CNPJ Prospect em http://localhost:${config.port}`);
  app.log.info(`DuckDB: ${config.dbPath} (${config.memoryLimit}, ${config.threads} threads)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
