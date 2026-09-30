import { createHash } from 'node:crypto';
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
    /** Signs session cookies. Required in production; derived locally when unset. */
    BETTER_AUTH_SECRET: z.string().min(32).optional(),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.BETTER_AUTH_SECRET, {
    message: 'BETTER_AUTH_SECRET is required in production',
    path: ['BETTER_AUTH_SECRET'],
  })
  // Production is served over TLS: an http origin would issue cookies without `Secure` and trust
  // the wrong origin, so a lost or wrong value stops the start instead of weakening it.
  .refine((env) => env.NODE_ENV !== 'production' || env.APP_URL.startsWith('https://'), {
    message: 'APP_URL must be an https origin in production',
    path: ['APP_URL'],
  })
  .transform(({ BETTER_AUTH_SECRET, ...env }) => ({
    ...env,
    // Outside production, fall back to a stable per-machine value: DATABASE_URL carries the random
    // password that `pnpm db:setup-local` generated, and it never leaves the machine.
    BETTER_AUTH_SECRET:
      BETTER_AUTH_SECRET ??
      createHash('sha256').update(`vertex-hub-dev-auth:${env.DATABASE_URL}`).digest('hex'),
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
