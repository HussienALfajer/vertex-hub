import { createDatabase } from '@vertex-hub/db';
import { setup as migrate, testDatabaseUrl } from '@vertex-hub/db/testing';
import { removeLeftoverUsers } from './helpers.js';

/** Migrates the test database, then clears what an interrupted earlier run left behind. */
export async function setup(): Promise<void> {
  await migrate();
  const { db, close } = createDatabase(testDatabaseUrl());
  try {
    await removeLeftoverUsers(db);
  } catch (error) {
    // Leftovers still tied to other records (a client they manage) stay; the run goes on.
    process.stderr.write(`Leftover test users not removed: ${String(error)}
`);
  } finally {
    await close();
  }
}
