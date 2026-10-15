import { createDatabase, runMigrations } from '@vertex-hub/db';
import { workerDatabaseUrls } from '@vertex-hub/db/testing';
import { removeLeftoverUsers } from './helpers.js';

/**
 * Migrates every worker's test database (one per Vitest worker, packages/db testing.ts), then
 * clears what an interrupted earlier run left behind in it.
 */
export async function setup(): Promise<void> {
  await Promise.all(
    workerDatabaseUrls('api').map(async (url) => {
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
}
