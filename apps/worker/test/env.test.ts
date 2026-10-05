import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/core/config/env.js';

const production = {
  DATABASE_URL: 'postgres://user:secret@127.0.0.1:5432/app',
  NODE_ENV: 'production',
  FILES_ROOT: '/srv/hub.example.com/shared/files',
  APP_URL: 'https://hub.example.com',
  EMAIL_SECRET_KEY: Buffer.alloc(32, 7).toString('base64'),
  SMTP_HOST: 'smtp.example.com',
  SMTP_USER: 'info@example.com',
  SMTP_PASSWORD: 'secret',
};

describe('worker environment (F14 email rule 24)', () => {
  it('starts production with the email key, an https origin and SMTP', () => {
    const env = parseEnv(production);
    expect(env.EMAIL_TRANSPORT).toBe('smtp');
    expect(env.EMAIL_SECRET_KEY).toEqual(Buffer.alloc(32, 7));
    expect(() => parseEnv({ ...production, EMAIL_SECRET_KEY: undefined })).toThrow(
      /EMAIL_SECRET_KEY/,
    );
    expect(() => parseEnv({ ...production, APP_URL: undefined })).toThrow(/APP_URL/);
    expect(() => parseEnv({ ...production, SMTP_PASSWORD: undefined })).toThrow(/SMTP/);
  });

  it('derives a stable email key from DATABASE_URL outside production, as the API does', () => {
    const local = { DATABASE_URL: production.DATABASE_URL };
    expect(parseEnv(local).EMAIL_SECRET_KEY).toHaveLength(32);
    expect(parseEnv(local).EMAIL_SECRET_KEY).toEqual(parseEnv(local).EMAIL_SECRET_KEY);
  });
});
