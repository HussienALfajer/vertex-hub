import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseConnection {
  db: Database;
  pool: pg.Pool;
  close: () => Promise<void>;
}

/**
 * Limits for a serving process, so a stuck query or a pool held by waiting transactions fails
 * instead of hanging. Migrations and scripts leave them off: they may wait on a lock.
 */
export interface DatabaseLimits {
  /** Pool size. */
  max: number;
  /** How long a request waits for a free connection. */
  connectionTimeoutMs: number;
  statementTimeoutMs: number;
  idleInTransactionTimeoutMs: number;
}

export const SERVER_DATABASE_LIMITS: DatabaseLimits = {
  max: 10,
  connectionTimeoutMs: 10_000,
  statementTimeoutMs: 30_000,
  idleInTransactionTimeoutMs: 60_000,
};

export function createDatabase(
  connectionString: string,
  limits?: DatabaseLimits,
): DatabaseConnection {
  const pool = new pg.Pool({
    connectionString,
    ...(limits && {
      max: limits.max,
      connectionTimeoutMillis: limits.connectionTimeoutMs,
      options: `-c statement_timeout=${limits.statementTimeoutMs} -c idle_in_transaction_session_timeout=${limits.idleInTransactionTimeoutMs}`,
    }),
  });
  const db = drizzle({ client: pool, schema, casing: 'snake_case' });
  return { db, pool, close: () => pool.end() };
}

/** The handle inside `db.transaction(async (tx) => ...)`. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface Listener {
  close: () => Promise<void>;
}

/**
 * A dedicated connection that `LISTEN`s on `channel` and hands each payload to `onPayload`
 * (ADR 0018). `onError` runs once when the connection fails or ends; the caller reconnects.
 */
export async function listen(
  connectionString: string,
  channel: string,
  onPayload: (payload: string) => void,
  onError: (error: Error) => void,
): Promise<Listener> {
  if (!/^[a-z_]+$/.test(channel)) throw new Error(`Invalid channel name: ${channel}`);
  const client = new pg.Client({ connectionString });
  let closing = false;
  let failed = false;
  const fail = (error: Error) => {
    if (closing || failed) return;
    failed = true;
    onError(error);
    client.end().catch(() => {});
  };
  client.on('notification', (message) => {
    if (message.channel === channel && message.payload) onPayload(message.payload);
  });
  client.on('error', fail);
  client.on('end', () => fail(new Error('Listener connection ended')));
  await client.connect();
  await client.query(`LISTEN ${channel}`);
  return {
    close: async () => {
      closing = true;
      await client.end();
    },
  };
}
