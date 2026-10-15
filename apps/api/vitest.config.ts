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
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/worker-env.ts'],
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      // test/worker-env.ts sets DATABASE_URL to the worker's database.
      TEST_DATABASE_SUITE: 'api',
      // Tests call job handlers directly; pg-boss stays off.
      JOBS_ENABLED: 'false',
    },
  },
});
