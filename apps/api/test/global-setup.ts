import { createDatabase, runMigrations } from '@vertex-hub/db';
import {
  createMissingDatabases,
  holdTestDatabases,
  workerDatabaseUrls,
} from '@vertex-hub/db/testing';
import { removeLeftoverUsers } from './helpers.js';

/**
 * Holds the suite's worker databases for the run (one per Vitest worker, packages/db testing.ts),
 * creates the missing ones and migrates them, then clears what an interrupted earlier run left
 * behind in each. Returns the teardown that releases them.
 */
export async function setup(): Promise<() => Promise<void>> {
  const release = await holdTestDatabases('api');
  try {
    const urls = workerDatabaseUrls('api');
    await createMissingDatabases(urls);
    await Promise.all(
      urls.map(async (url) => {
        await runMigrations(url);
        const { db, close } = createDatabase(url);
        try {
          await removeLeftoverUsers(db);
        } catch (error) {
          // Leftovers still tied to other records stay; the run goes on.
          process.stderr.write(`Leftover test users not removed: ${String(error)}
`);
        } finally {
          await close();
        }
      }),
    );
  } catch (error) {
    await release();
    throw error;
  }
  return release;
}
