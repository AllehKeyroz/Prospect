import fs from 'node:fs';
import {
  DuckDBInstance,
  type DuckDBConnection,
  type DuckDBValue,
} from '@duckdb/node-api';
import { config } from '../config.js';

type Params = Record<string, unknown> | undefined;

type DuckDBParams = Record<string, DuckDBValue> | undefined;

let instance: DuckDBInstance | null = null;
let readOnly = false;
const available: DuckDBConnection[] = [];
const waiters: Array<(connection: DuckDBConnection) => void> = [];

function cleanParams(params: Params): DuckDBParams {
  if (!params) return undefined;
  const cleaned: Record<string, DuckDBValue> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) cleaned[key] = value as DuckDBValue;
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

export async function openDatabase(options: { readOnly?: boolean } = {}): Promise<void> {
  if (instance) return;
  readOnly = options.readOnly ?? false;
  fs.mkdirSync(config.tempDirectory, { recursive: true });
  instance = await DuckDBInstance.create(config.dbPath, {
    threads: String(config.threads),
    memory_limit: config.memoryLimit,
    temp_directory: config.tempDirectory,
    ...(readOnly ? { access_mode: 'READ_ONLY' } : {}),
  });

  const poolSize = readOnly ? 4 : 1;
  for (let i = 0; i < poolSize; i++) {
    available.push(await instance.connect());
  }
}

async function acquire(): Promise<DuckDBConnection> {
  const connection = available.pop();
  if (connection) return connection;
  return new Promise((resolve) => waiters.push(resolve));
}

function release(connection: DuckDBConnection): void {
  const waiter = waiters.shift();
  if (waiter) waiter(connection);
  else available.push(connection);
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: Params,
): Promise<T[]> {
  if (!instance) throw new Error('Banco não inicializado. Chame openDatabase() antes.');
  const connection = await acquire();
  try {
    const reader = await connection.runAndReadAll(sql, cleanParams(params));
    return reader.getRowObjectsJson() as T[];
  } finally {
    release(connection);
  }
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params?: Params,
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function exec(sql: string, params?: Params): Promise<void> {
  if (!instance) throw new Error('Banco não inicializado. Chame openDatabase() antes.');
  const connection = await acquire();
  try {
    await connection.run(sql, cleanParams(params));
  } finally {
    release(connection);
  }
}

export async function closeDatabase(): Promise<void> {
  for (const connection of available.splice(0)) {
    try {
      connection.disconnectSync();
    } catch {
      // ignore
    }
  }
  if (instance) {
    try {
      instance.closeSync();
    } catch {
      // ignore
    }
  }
  instance = null;
}

export function isOpen(): boolean {
  return instance !== null;
}

export function isReadOnly(): boolean {
  return readOnly;
}
