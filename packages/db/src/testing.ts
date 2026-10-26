import pg from 'pg';
import { loadRootEnv } from './env.js';
import { runMigrations } from './migrate.js';
import { testWorkers } from './test-workers.js';

/**
 * Parallel Vitest workers of the api suite (test-workers.ts: `TEST_WORKERS` from the environment
 * or .env, else sized to the machine). Each worker has a test database of its own, so test files
 * run in parallel without seeing each other's rows; files in one worker run one after another on
 * it. The api global setup creates the ones that are missing.
 */
export const TEST_WORKERS = loadedTestWorkers();

function loadedTestWorkers(): number {
  loadRootEnv();
  return testWorkers();
}

/** How long a test run waits for another run of the same suite to end. */
const HOLD_WAIT_MS = 20 * 60_000;

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

/**
 * Holds the test databases of `suite` for one test run, with a session advisory lock on the test
 * database: a second run of the same suite (another session, a forgotten background run) waits
 * for the first to end instead of sharing its rows, which failed both. PostgreSQL releases the
 * lock when a run dies. Returns the release, for the global setup's teardown.
 */
export async function holdTestDatabases(suite: string): Promise<() => Promise<void>> {
  const client = new pg.Client({
    connectionString: baseTestDatabaseUrl(),
    application_name: `vertex-hub ${suite} tests (pid ${process.pid})`,
  });
  await client.connect();
  const started = Date.now();
  let toldAt = 0;
  for (;;) {
    const { rows } = await client.query<{ held: boolean }>(
      'select pg_try_advisory_lock(hashtext($1)) as held',
      [`vertex-hub-tests:${suite}`],
    );
    if (rows[0]?.held) return () => client.end();
    if (Date.now() - started > HOLD_WAIT_MS) {
      await client.end();
      throw new Error(`Another ${suite} test run has held the test databases for 20 minutes.`);
    }
    if (Date.now() - toldAt > 15_000) {
      process.stderr.write(`Another ${suite} test run is using the test databases; waiting.\n`);
      toldAt = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

/**
 * Creates the worker databases that do not exist yet (a new machine, a larger TEST_WORKERS) as the
 * test role, which needs CREATEDB for it; `pnpm db:setup-local` creates them otherwise.
 */
export async function createMissingDatabases(urls: readonly string[]): Promise<void> {
  const client = new pg.Client({ connectionString: baseTestDatabaseUrl() });
  await client.connect();
  try {
    for (const url of urls) {
      const name = decodeURIComponent(new URL(url).pathname.slice(1));
      const found = await client.query('select 1 from pg_database where datname = $1', [name]);
      if (found.rowCount) continue;
      try {
        await client.query(`create database ${client.escapeIdentifier(name)}`);
      } catch (error) {
        throw new Error(
          `Test database ${name} is missing and the test role cannot create it: run pnpm db:setup-local.`,
          { cause: error },
        );
      }
    }
  } finally {
    await client.end();
  }
}

/**
 * Vitest global setup of the suites on the shared test database (`packages/db`, `apps/worker`):
 * holds it for the run and brings its schema up to date before any test runs.
 */
export async function setup(): Promise<() => Promise<void>> {
  const release = await holdTestDatabases('shared');
  try {
    await runMigrations(testDatabaseUrl());
  } catch (error) {
    await release();
    throw error;
  }
  return release;
}
