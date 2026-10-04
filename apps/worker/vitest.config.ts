import { randomUUID } from 'node:crypto';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Nest needs decorator metadata, which Vite's default transform does not emit.
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true, tsx: true },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
          react: { runtime: 'automatic' },
        },
      },
    }),
  ],
  test: {
    globalSetup: ['./test/global-setup.ts'],
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      WORKER_NAME: `test-${randomUUID()}`,
      DATABASE_URL: testDatabaseUrl(),
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
