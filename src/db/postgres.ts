import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPgPool(): pg.Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL não configurada');
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: 'prospect-api',
    });
    pool.on('error', (error) => {
      console.error('[postgres] erro no pool:', error.message);
    });
  }
  return pool;
}

export async function pgQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return getPgPool().query<T>(sql, params);
}

export async function pgQueryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const result = await pgQuery<T>(sql, params);
  return result.rows[0] ?? null;
}

export async function pgClose(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
