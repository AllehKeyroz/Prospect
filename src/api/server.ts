import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { config } from '../config.js';
import { closeDatabase, openDatabase } from '../db/duckdb.js';
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

async function main(): Promise<void> {
  if (!fs.existsSync(config.dbPath)) {
    console.error(`Banco não encontrado em ${config.dbPath}`);
    console.error('Gere a amostra e carregue o banco antes de iniciar a API:');
    console.error('  npm run sample && npm run ingest:sample');
    process.exit(1);
  }

  await app.register(cors, { origin: true });
  await app.register(fastifyStatic, {
    root: path.resolve('public'),
    prefix: '/',
  });

  await openDatabase({ readOnly: true });
  await registerRoutes(app);

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
      process.exit(0);
    } catch (error) {
      app.log.error(error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`CNPJ Prospect em http://localhost:${config.port}`);
  app.log.info(`DuckDB: ${config.dbPath} (${config.memoryLimit}, ${config.threads} threads)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
