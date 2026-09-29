import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseConnection {
  db: Database;
  pool: pg.Pool;
  close: () => Promise<void>;
}

export function createDatabase(connectionString: string): DatabaseConnection {
  const pool = new pg.Pool({ connectionString });
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
