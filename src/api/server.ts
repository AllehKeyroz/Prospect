import fs from 'node:fs';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { config } from '../config.js';
import { closeDatabase, isOpen, openDatabase, query } from '../db/duckdb.js';
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

interface DbStatus {
  ready: boolean;
  reason: string | null;
}

let analyticsStatus: DbStatus = { ready: false, reason: 'ainda não inicializado' };

app.setErrorHandler((error: unknown, request, reply) => {
  const err = error as { statusCode?: number; message?: string };
  request.log.error(error);
  if (reply.sent) return;
  reply.status(err.statusCode ?? 500).send({
    error: err.statusCode && err.statusCode < 500 ? err.message : 'Erro interno',
  });
});

function metaToObject(rows: Array<{ key: string; value: string }>): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

function logBoot(): void {
  // Primeira linha do log em produção. Se o EasyPanel não mostrar isto, o
  // processo nem chegou a executar (problema de imagem/porta/plataforma).
  const publicDir = config.publicDir;
  app.log.info({
    msg: 'boot',
    node: process.version,
    pid: process.pid,
    port: config.port,
    host: config.host,
    db_ready: analyticsStatus.ready,
    db_reason: analyticsStatus.reason,
    db_path: config.dbPath,
    data_dir: config.dataDir,
    app_db_path: config.appDbPath,
    cwd: process.cwd(),
    public_dir: publicDir,
    public_exists: fs.existsSync(publicDir),
    duckdb_exists: fs.existsSync(config.dbPath),
    database_url: Boolean(process.env.DATABASE_URL),
    admin_token: Boolean(process.env.ADMIN_TOKEN),
    memory_limit: config.memoryLimit,
    threads: config.threads,
  });
}

process.on('unhandledRejection', (reason) => {
  app.log.error({ msg: 'unhandledRejection', reason: String(reason) });
});

process.on('uncaughtException', (error) => {
  app.log.error({
    msg: 'uncaughtException',
    error: String(error),
    stack: (error as Error).stack,
  });
});

async function ensureSchema(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    app.log.warn('DATABASE_URL ausente: administração da base fica sem persistência de jobs');
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

/**
 * Abre o DuckDB e valida que ele tem a tabela `meta`.
 *
 * Qualquer falha vira modo degradado — nunca derruba o processo. É isso que
 * impede o restart loop no EasyPanel quando o volume tem um arquivo corrompido,
 * parcial ou com permissão errada.
 */
async function openAnalyticsDatabase(): Promise<DbStatus> {
  if (!fs.existsSync(config.dbPath)) {
    analyticsStatus = {
      ready: false,
      reason: `arquivo não encontrado: ${config.dbPath}`,
    };
    return analyticsStatus;
  }

  try {
    await openDatabase({ readOnly: true });
    // Uma base vazia/corrompida pode abrir e falhar só na primeira consulta.
    await query('SELECT key, value FROM meta LIMIT 1');
    analyticsStatus = { ready: true, reason: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await closeDatabase().catch(() => undefined);
    analyticsStatus = {
      ready: false,
      reason: `não foi possível usar ${config.dbPath}: ${message}`,
    };
  }

  return analyticsStatus;
}

async function openSearchDatabase(): Promise<void> {
  try {
    await openAppDb();
  } catch (error) {
    // app.duckdb só guarda buscas salvas; não impede o app de subir.
    app.log.warn(`app.duckdb indisponível: ${(error as Error).message}`);
  }
}

async function reloadDatabases(): Promise<DbStatus> {
  await closeDatabase().catch(() => undefined);
  const status = await openAnalyticsDatabase();
  await openSearchDatabase();
  app.log.info({ msg: 'db_reload', ...status });
  return status;
}

function dbSnapshotStatus(): { ready: boolean; reason: string | null; path: string; exists: boolean } {
  return {
    ready: analyticsStatus.ready && isOpen(),
    reason: analyticsStatus.reason,
    path: config.dbPath,
    exists: fs.existsSync(config.dbPath),
  };
}

function registerStatusRoutes(): void {
  // Liveness: sempre 200 enquanto o processo estiver vivo. O EasyPanel usa
  // isto para não reiniciar o container durante uma carga. Readiness fica em
  // db_ready / /ready.
  app.get('/health', async () => {
    const memory = process.memoryUsage();
    const base = {
      ok: true,
      db_path: config.dbPath,
      data_dir: config.dataDir,
      duckdb_exists: fs.existsSync(config.dbPath),
      postgres: Boolean(process.env.DATABASE_URL),
      memory_mb: Math.round(memory.rss / 1024 / 1024),
      uptime_s: Math.round(process.uptime()),
    };

    if (!isOpen()) {
      return {
        ...base,
        status: 'degraded',
        db_ready: false,
        reason: analyticsStatus.reason,
      };
    }

    try {
      const meta = metaToObject(await query<{ key: string; value: string }>('SELECT key, value FROM meta'));
      return {
        ...base,
        status: 'ok',
        db_ready: true,
        snapshot: meta.snapshot ?? config.snapshot,
        generated_at: meta.generated_at ?? null,
        rows: {
          estabelecimentos: Number(meta.estabelecimentos ?? 0),
          empresas: Number(meta.empresas ?? 0),
          socios: Number(meta.socios ?? 0),
        },
      };
    } catch (error) {
      await closeDatabase().catch(() => undefined);
      analyticsStatus = {
        ready: false,
        reason: `base aberta mas ilegível: ${(error as Error).message}`,
      };
      return {
        ...base,
        status: 'degraded',
        db_ready: false,
        reason: analyticsStatus.reason,
      };
    }
  });

  app.get('/ready', async (_request, reply) => {
    const status = dbSnapshotStatus();
    return reply.status(status.ready ? 200 : 503).send({
      ready: status.ready,
      reason: status.reason,
      db_path: status.path,
    });
  });
}

async function main(): Promise<void> {
  app.log.info('[startup] registrando CORS e arquivos estáticos');
  await app.register(cors, { origin: true });
  await app.register(fastifyStatic, {
    root: config.publicDir,
    prefix: '/',
    index: false,
  });

  app.get('/admin', async (_request, reply) => reply.sendFile('admin.html'));
  app.log.info('[startup] tela /admin registrada');

  // Uma única árvore de rotas: as consultas respondem 503 enquanto a base não
  // estiver pronta, em vez de o processo subir com um conjunto diferente de
  // rotas e precisar de restart depois da carga.
  registerStatusRoutes();
  const status = await openAnalyticsDatabase();
  await openSearchDatabase();
  await registerRoutes(app);
  await registerAdminRoutes(app, {
    dbStatus: dbSnapshotStatus,
    reload: reloadDatabases,
    onJobSuccess: reloadDatabases,
  });

  app.get('/', async (_request, reply) =>
    reply.sendFile(isOpen() ? 'index.html' : 'offline.html'),
  );

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.status(404).send({ error: 'Rota não encontrada' });
    }
    return reply.sendFile(isOpen() ? 'index.html' : 'offline.html');
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
  logBoot();

  // Migrações nunca atrasam o boot: se o Postgres estiver fora, o app precisa
  // responder /health em segundos para o EasyPanel não reiniciar o container.
  void ensureSchema();

  if (status.ready) {
    app.log.info(`CNPJ Prospect em http://localhost:${config.port}`);
    app.log.info(`DuckDB: ${config.dbPath} (${config.memoryLimit}, ${config.threads} threads)`);
  } else {
    app.log.warn(
      `[startup] modo degradado: ${status.reason} — UI em /, admin em /admin, health em /health`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
