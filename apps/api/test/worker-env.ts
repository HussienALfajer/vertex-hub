import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { afterAll } from 'vitest';

/*
 * Each Vitest worker has its own test database (packages/db testing.ts), so test files run in
 * parallel without seeing each other's rows. Runs before each test file imports the app, which
 * reads it at startup.
 */
process.env.DATABASE_URL = testDatabaseUrl();

// A worker runs one file after another without isolation (vitest.config.ts): what a file sets in
// process.env (FILES_ROOT, …) is put back after it, so it never reaches the next file.
const environment = { ...process.env };
afterAll(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in environment)) delete process.env[key];
  }
  Object.assign(process.env, environment);
});
