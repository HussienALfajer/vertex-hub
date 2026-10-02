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
  })
  .refine((env) => env.NODE_ENV !== 'production' || isAbsolute(env.FILES_ROOT), {
    message: 'FILES_ROOT must be an absolute path in production',
    path: ['FILES_ROOT'],
  });

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
