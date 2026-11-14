import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL não configurada.');
  console.error('Exemplo: postgres://usuario:senha@host:5432/banco?sslmode=disable');
  process.exit(1);
}

const migrationsDir = path.resolve('db/migrations');

async function main(): Promise<void> {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 15_000,
    application_name: 'prospect-migrate',
  });

  await client.connect();
  console.log('[db] conectado');

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
      const applied = await client.query(
        'SELECT 1 FROM app.schema_migrations WHERE version = $1',
        [file],
      );
      if (applied.rowCount) {
        console.log(`[skip] ${file}`);
        continue;
      }

      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      console.log(`[apply] ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO app.schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`[ok] ${file}`);
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
    console.log('[db] tabelas por schema:', counts.rows);
    console.log('[db] migrações concluídas');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[db] falha na migração:', error instanceof Error ? error.message : error);
  process.exit(1);
});
