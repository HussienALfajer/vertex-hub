import { z } from 'zod';

export const healthStatusSchema = z.enum(['ok', 'error']);

export const healthResponseSchema = z
  .object({
    status: healthStatusSchema,
    checks: z.object({
      database: z.enum(['up', 'down']),
    }),
    timestamp: z.iso.datetime(),
  })
  .meta({ id: 'HealthResponse', description: 'Liveness of the API and its dependencies' });

export type HealthResponse = z.infer<typeof healthResponseSchema>;
