import { loadRootEnv } from './env.js';
import { runMigrations } from './migrate.js';

/**
 * Parallel Vitest workers of the api suite. Each worker has a test database of its own, so test
 * files run in parallel without seeing each other's rows; files in one worker run one after
 * another, as the whole suite did on a single database before. Keep in step with TEST_WORKERS in
 * scripts/setup-local-db.mjs and the CI workflow, which create the databases.
 */
export const TEST_WORKERS = 4;

function baseTestDatabaseUrl(): string {
  loadRootEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL is not set. Copy .env.example to .env (see README).');
  }
  return url;
}

/** `<test database>_<suite>_<worker>`: the database of one Vitest worker of an app suite. */
export function workerDatabaseUrl(url: string, suite: string, worker: number | string): string {
  const parsed = new URL(url);
  parsed.pathname = `${parsed.pathname}_${suite}_${worker}`;
  return parsed.href;
}

/**
 * Test database URL from the environment or the root .env file. Inside a Vitest worker of a
 * suite with databases of its own (TEST_DATABASE_SUITE set by its config), the worker's database.
 */
export function testDatabaseUrl(): string {
  const url = baseTestDatabaseUrl();
  const suite = process.env.TEST_DATABASE_SUITE;
  const worker = process.env.VITEST_POOL_ID;
  return suite && worker ? workerDatabaseUrl(url, suite, worker) : url;
}

/** Every worker database of a suite. */
export function workerDatabaseUrls(suite: string): string[] {
  const url = baseTestDatabaseUrl();
  return Array.from({ length: TEST_WORKERS }, (_, index) =>
    workerDatabaseUrl(url, suite, index + 1),
  );
}

/** Vitest global setup: bring the test database schema up to date before any test runs. */
export async function setup(): Promise<void> {
  await runMigrations(testDatabaseUrl());
}
