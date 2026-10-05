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
      EMAIL_SECRET_KEY: Buffer.alloc(32, 7).toString('base64'),
      APP_URL: 'https://hub.example.com',
      FILES_ROOT: '/srv/hub.example.com/shared/files',
    };
    expect(parseEnv(production).APP_URL).toBe('https://hub.example.com');
    expect(() => parseEnv({ ...production, BETTER_AUTH_SECRET: undefined })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
    expect(() => parseEnv({ ...production, APP_URL: 'http://hub.example.com' })).toThrow(/APP_URL/);
    // A lost APP_URL falls back to the local origin, which production refuses.
    expect(() => parseEnv({ ...production, APP_URL: undefined })).toThrow(/APP_URL/);
  });

  it('keeps production files outside the releases and serves them through nginx (F10)', () => {
    const production = {
      ...base,
      NODE_ENV: 'production',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      EMAIL_SECRET_KEY: Buffer.alloc(32, 7).toString('base64'),
      APP_URL: 'https://hub.example.com',
    };
    expect(() => parseEnv(production)).toThrow(/FILES_ROOT/);
    const env = parseEnv({ ...production, FILES_ROOT: '/srv/files' });
    expect(env.FILES_X_ACCEL).toBe(true);
    expect(
      parseEnv({ ...production, FILES_ROOT: '/srv/files', FILES_X_ACCEL: 'false' }).FILES_X_ACCEL,
    ).toBe(false);
    expect(parseEnv({ ...base }).FILES_X_ACCEL).toBe(false);
  });

  it('runs locally with defaults and a derived secret', () => {
    const env = parseEnv({ ...base });
    expect(env.NODE_ENV).toBe('development');
    expect(env.APP_URL).toBe('http://127.0.0.1:5173');
    expect(env.BETTER_AUTH_SECRET).toHaveLength(64);
    expect(env.EMAIL_SECRET_KEY).toHaveLength(32);
  });

  it('needs a 32-byte email key in production (F14 email rule 24)', () => {
    const production = {
      ...base,
      NODE_ENV: 'production',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      APP_URL: 'https://hub.example.com',
      FILES_ROOT: '/srv/files',
    };
    expect(() => parseEnv(production)).toThrow(/EMAIL_SECRET_KEY/);
    const short = Buffer.alloc(16).toString('base64');
    expect(() => parseEnv({ ...production, EMAIL_SECRET_KEY: short })).toThrow(/32 bytes/);
    const key = Buffer.alloc(32, 7).toString('base64');
    expect(parseEnv({ ...production, EMAIL_SECRET_KEY: key }).EMAIL_SECRET_KEY).toEqual(
      Buffer.alloc(32, 7),
    );
  });
});
