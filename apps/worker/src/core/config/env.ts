import { hostname } from 'node:os';
import { isAbsolute } from 'node:path';
import { z } from 'zod';

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** Identifies this worker process in the heartbeat table. */
    WORKER_NAME: z.string().min(1).default(hostname()),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    /**
     * The API's files directory (F10, ADR 0019), where quote PDFs are written (F04). The default
     * is the API's own default seen from `apps/worker` in development.
     */
    FILES_ROOT: z.string().min(1).default('../api/.data/files'),
    /**
     * F14 email rule 24: `smtp` sends; `log` writes each email as an `.eml` file under
     * `EMAIL_LOG_DIR` and sends nothing. Defaults to `log` outside production.
     */
    EMAIL_TRANSPORT: z.enum(['smtp', 'log']).optional(),
    EMAIL_FROM: z.email().default('info@vertexmedia.pro'),
    EMAIL_LOG_DIR: z.string().min(1).default('.data/emails'),
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
    /** TLS from the start (port 465); `false` upgrades with STARTTLS (port 587). */
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
  })
  .refine((env) => env.NODE_ENV !== 'production' || isAbsolute(env.FILES_ROOT), {
    message: 'FILES_ROOT must be an absolute path in production',
    path: ['FILES_ROOT'],
  })
  .transform((env) => ({
    ...env,
    EMAIL_TRANSPORT: env.EMAIL_TRANSPORT ?? (env.NODE_ENV === 'production' ? 'smtp' : 'log'),
  }))
  .refine(
    (env) =>
      env.EMAIL_TRANSPORT === 'log' || Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD),
    {
      message: 'The smtp email transport needs SMTP_HOST, SMTP_USER and SMTP_PASSWORD',
      path: ['EMAIL_TRANSPORT'],
    },
  );

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
