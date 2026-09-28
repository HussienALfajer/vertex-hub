import { loadRootEnv } from './env.js';
import { runMigrations } from './migrate.js';

/** Test database URL from the environment or the root .env file. */
export function testDatabaseUrl(): string {
  loadRootEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL is not set. Copy .env.example to .env (see README).');
  }
  return url;
}

/** Vitest global setup: bring the test database schema up to date before any test runs. */
export async function setup(): Promise<void> {
  await runMigrations(testDatabaseUrl());
}
