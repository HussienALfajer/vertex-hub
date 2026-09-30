import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/core/config/env.js';

const base = {
  DATABASE_URL: 'postgres://user:secret@127.0.0.1:5432/app',
};

describe('environment', () => {
  it('starts production only with a signing secret and an https origin', () => {
    const production = {
      ...base,
      NODE_ENV: 'production',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      APP_URL: 'https://hub.example.com',
    };
    expect(parseEnv(production).APP_URL).toBe('https://hub.example.com');
    expect(() => parseEnv({ ...production, BETTER_AUTH_SECRET: undefined })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
    expect(() => parseEnv({ ...production, APP_URL: 'http://hub.example.com' })).toThrow(/APP_URL/);
    // A lost APP_URL falls back to the local origin, which production refuses.
    expect(() => parseEnv({ ...production, APP_URL: undefined })).toThrow(/APP_URL/);
  });

  it('runs locally with defaults and a derived secret', () => {
    const env = parseEnv({ ...base });
    expect(env.NODE_ENV).toBe('development');
    expect(env.APP_URL).toBe('http://127.0.0.1:5173');
    expect(env.BETTER_AUTH_SECRET).toHaveLength(64);
  });
});
