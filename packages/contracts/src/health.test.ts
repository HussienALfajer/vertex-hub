import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './health.js';

describe('healthResponseSchema', () => {
  it('accepts a healthy response', () => {
    const result = healthResponseSchema.safeParse({
      status: 'ok',
      checks: { database: 'up' },
      timestamp: '2026-09-28T10:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown status', () => {
    const result = healthResponseSchema.safeParse({
      status: 'degraded',
      checks: { database: 'up' },
      timestamp: '2026-09-28T10:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('exposes a JSON Schema through Standard Schema for OpenAPI generation', () => {
    const jsonSchema = healthResponseSchema['~standard'].jsonSchema.output({
      target: 'openapi-3.0',
    });
    expect(jsonSchema).toMatchObject({
      $ref: '#/definitions/HealthResponse',
      definitions: {
        HealthResponse: { type: 'object', required: ['status', 'checks', 'timestamp'] },
      },
    });
  });
});
