import { testDatabaseUrl } from '@vertex-hub/db/testing';

/*
 * Each Vitest worker has its own test database (packages/db testing.ts), so test files run in
 * parallel without seeing each other's rows. Runs before each test file imports the app, which
 * reads it at startup.
 */
process.env.DATABASE_URL = testDatabaseUrl();
