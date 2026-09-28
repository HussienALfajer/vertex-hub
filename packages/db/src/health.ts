import { sql } from 'drizzle-orm';
import type { Database } from './client.js';

/** Returns true when the database answers a trivial query. Never throws. */
export async function pingDatabase(db: Database): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
