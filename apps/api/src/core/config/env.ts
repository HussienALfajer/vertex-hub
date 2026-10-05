import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { z } from 'zod';

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    /** Public origin of the web app; the API is served under it at /api (nginx or the Vite proxy). */
    APP_URL: z.url({ protocol: /^https?$/ }).default('http://127.0.0.1:5173'),
    /** Works the pg-boss queues the worker schedules (ADR 0008). `false` in tests. */
    JOBS_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    /** Where uploaded files live (F10, ADR 0019): outside the releases in production. */
    FILES_ROOT: z.string().min(1).default('./.data/files'),
    /**
     * Serve file content through nginx's internal location (`X-Accel-Redirect`) instead of
     * streaming it; defaults to on in production, where nginx is in front.
     */
    FILES_X_ACCEL: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => (value === undefined ? undefined : value === 'true')),
    /** Signs session cookies. Required in production; derived locally when unset. */
    BETTER_AUTH_SECRET: z.string().min(32).optional(),
    /**
     * F14 email (ADR 0028): 32 bytes, base64, shared with the worker; encrypts token links in
     * `email.send` jobs. Required in production; derived locally when unset.
     */
    EMAIL_SECRET_KEY: z
      .string()
      .refine((value) => Buffer.from(value, 'base64').length === 32, 'Expected 32 bytes, base64')
      .optional(),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.EMAIL_SECRET_KEY, {
    message: 'EMAIL_SECRET_KEY is required in production',
    path: ['EMAIL_SECRET_KEY'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.BETTER_AUTH_SECRET, {
    message: 'BETTER_AUTH_SECRET is required in production',
    path: ['BETTER_AUTH_SECRET'],
  })
  // Production is served over TLS: an http origin would issue cookies without `Secure` and trust
  // the wrong origin, so a lost or wrong value stops the start instead of weakening it.
  // A relative root would put uploads inside a release, which the next deploys delete.
  .refine((env) => env.NODE_ENV !== 'production' || isAbsolute(env.FILES_ROOT), {
    message: 'FILES_ROOT must be an absolute path in production',
    path: ['FILES_ROOT'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.APP_URL.startsWith('https://'), {
    message: 'APP_URL must be an https origin in production',
    path: ['APP_URL'],
  })
  .transform(({ BETTER_AUTH_SECRET, EMAIL_SECRET_KEY, FILES_X_ACCEL, ...env }) => ({
    ...env,
    FILES_X_ACCEL: FILES_X_ACCEL ?? env.NODE_ENV === 'production',
    // Outside production, fall back to a stable per-machine value: DATABASE_URL carries the random
    // password that `pnpm db:setup-local` generated, and it never leaves the machine.
    BETTER_AUTH_SECRET:
      BETTER_AUTH_SECRET ??
      createHash('sha256').update(`vertex-hub-dev-auth:${env.DATABASE_URL}`).digest('hex'),
    // The worker derives the same key from the same DATABASE_URL.
    EMAIL_SECRET_KEY: EMAIL_SECRET_KEY
      ? Buffer.from(EMAIL_SECRET_KEY, 'base64')
      : createHash('sha256').update(`vertex-hub-dev-email:${env.DATABASE_URL}`).digest(),
  }));

export type Env = z.infer<typeof envSchema>;

/** Injection token for the validated environment. */
export const ENV = Symbol('ENV');

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
