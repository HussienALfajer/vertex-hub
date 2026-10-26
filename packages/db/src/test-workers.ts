import { availableParallelism } from 'node:os';

/**
 * Parallel Vitest workers of the api suite, each with a test database of its own (testing.ts).
 * `TEST_WORKERS` sets the number; otherwise half the logical CPUs, from 4 (CI runners) to 12. The
 * suite mostly waits on its HTTP and database round trips, so a worker per two CPUs keeps a large
 * machine busy; with the tests' pool of 4 connections (apps/api vitest.config.ts) 12 workers stay
 * under PostgreSQL's default `max_connections` of 100. Shared with scripts/setup-local-db.mjs,
 * which creates the databases: it imports nothing local.
 */
export function testWorkers(env: NodeJS.ProcessEnv = process.env): number {
  const value = env.TEST_WORKERS;
  if (value === undefined || value === '') {
    return Math.min(12, Math.max(4, Math.floor(availableParallelism() / 2)));
  }
  const workers = Number(value);
  if (!Number.isInteger(workers) || workers < 1 || workers > 32) {
    throw new Error(`TEST_WORKERS must be a whole number from 1 to 32, not "${value}".`);
  }
  return workers;
}
