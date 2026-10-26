import { TEST_WORKERS } from '@vertex-hub/db/testing';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Nest needs decorator metadata, which Vite's default transform does not emit.
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    // Each worker has its own test database (packages/db testing.ts): files run in parallel, and
    // files in one worker run one after another on it, since some rows are global (one manager
    // per department).
    maxWorkers: TEST_WORKERS,
    // A worker keeps its modules from one file to the next instead of loading the whole app again
    // for each file (that reload was 46% of the suite's time). Each file still starts its own app
    // and seeds its own data; a run with shuffled files passed whole (2026-10-26).
    isolate: false,
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/worker-env.ts'],
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      // test/worker-env.ts sets DATABASE_URL to the worker's database.
      TEST_DATABASE_SUITE: 'api',
      // Tests call job handlers directly; pg-boss stays off.
      JOBS_ENABLED: 'false',
      // Each worker's app opens at most 4 connections, so 12 workers fit PostgreSQL's default 100.
      DATABASE_POOL_MAX: '4',
    },
  },
});
