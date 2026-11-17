import 'dotenv/config';
import fs from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const { Client } = pg;

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** `db/migrations` pelo cwd e, se preciso, pela localização do módulo. */
function resolveMigrationsDir(): string {
  const candidates = [
    path.resolve('db/migrations'),
    path.resolve(moduleDir, '..', '..', 'db/migrations'),
    path.resolve(moduleDir, '..', '..', '..', 'db/migrations'),
    path.resolve(moduleDir, '..', 'db/migrations'),
  ];
  return candidates.find((dir) => fs.existsSync(dir)) ?? candidates[0];
}

export interface MigrateOptions {
  connectionString: string;
  log?: (message: string) => void;
}

/** Aplica as migrações pendentes em db/migrations (idempotente). */
export async function runMigrations({ connectionString, log = console.log }: MigrateOptions): Promise<void> {
  const migrationsDir = resolveMigrationsDir();
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 15_000,
    application_name: 'prospect-migrate',
  });

  await client.connect();
  log('[db] conectado');

  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS app');
    await client.query(`
      CREATE TABLE IF NOT EXISTS app.schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(migrationsDir))
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const applied = await client.query('SELECT 1 FROM app.schema_migrations WHERE version = $1', [file]);
      if (applied.rowCount) {
        log(`[skip] ${file}`);
        continue;
      }

      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      log(`[apply] ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO app.schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        log(`[ok] ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    const counts = await client.query(`
      SELECT schemaname, count(*)::int AS tables
      FROM pg_tables
      WHERE schemaname IN ('core', 'read', 'app', 'history', 'enrich')
      GROUP BY schemaname
      ORDER BY schemaname
    `);
    log(`[db] tabelas por schema: ${JSON.stringify(counts.rows)}`);
    log('[db] migrações concluídas');
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL não configurada.');
    console.error('Exemplo: postgres://usuario:senha@host:5432/banco?sslmode=disable');
    process.exit(1);
  }
  await runMigrations({ connectionString });
}

const invokedDirectly = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (invokedDirectly) {
  main().catch((error) => {
    console.error('[db] falha na migração:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
