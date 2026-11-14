import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  DuckDBInstance,
  type DuckDBConnection,
  type DuckDBValue,
} from '@duckdb/node-api';
import { config } from '../config.js';

let instance: DuckDBInstance | null = null;
let connection: DuckDBConnection | null = null;

export async function openAppDb(): Promise<void> {
  if (instance) return;
  fs.mkdirSync(path.dirname(config.appDbPath), { recursive: true });
  instance = await DuckDBInstance.create(config.appDbPath, {
    threads: '2',
    memory_limit: '512MB',
  });
  connection = await instance.connect();
  await connection.run(`
    CREATE TABLE IF NOT EXISTS saved_searches (
      id VARCHAR PRIMARY KEY,
      name VARCHAR NOT NULL,
      filters VARCHAR NOT NULL,
      created_at TIMESTAMP DEFAULT current_timestamp
    )
  `);
}

function db(): DuckDBConnection {
  if (!connection) throw new Error('App DB não inicializado');
  return connection;
}

export interface SavedSearchRow {
  id: string;
  name: string;
  filters: string;
  created_at: unknown;
}

export async function listSavedSearches(): Promise<SavedSearchRow[]> {
  const result = await db().runAndReadAll(
    'SELECT id, name, filters, created_at FROM saved_searches ORDER BY created_at DESC',
  );
  return result.getRowObjectsJson() as unknown as SavedSearchRow[];
}

export async function createSavedSearch(
  name: string,
  filters: Record<string, string>,
): Promise<SavedSearchRow> {
  const id = randomUUID();
  await db().run(
    'INSERT INTO saved_searches (id, name, filters) VALUES ($id, $name, $filters)',
    { id, name, filters: JSON.stringify(filters) } as Record<string, DuckDBValue>,
  );
  return { id, name, filters: JSON.stringify(filters), created_at: null };
}

export async function deleteSavedSearch(id: string): Promise<void> {
  await db().run('DELETE FROM saved_searches WHERE id = $id', { id });
}

export async function closeAppDb(): Promise<void> {
  try {
    connection?.disconnectSync();
  } catch {
    // ignore
  }
  try {
    instance?.closeSync();
  } catch {
    // ignore
  }
  connection = null;
  instance = null;
}
