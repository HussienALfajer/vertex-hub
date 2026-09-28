import { testDatabaseUrl } from '@vertex-hub/db/testing';
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
    globalSetup: ['./test/global-setup.ts'],
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: testDatabaseUrl() },
  },
});
