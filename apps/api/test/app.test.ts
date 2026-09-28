import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { healthResponseSchema } from '@vertex-hub/contracts';
import { createDatabase } from '@vertex-hub/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DATABASE } from '../src/core/database/database.module.js';
import { startApp } from './start-app.js';

describe('api against the test database', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    ({ app, url } = await startApp());
  });
  afterAll(() => app.close());

  it('GET /api/health reports ok when the database is up', async () => {
    const response = await fetch(`${url}/api/health`);
    expect(response.status).toBe(200);
    const body = healthResponseSchema.parse(await response.json());
    expect(body).toMatchObject({ status: 'ok', checks: { database: 'up' } });
  });

  it('serves an OpenAPI document generated from the Zod contracts', async () => {
    const response = await fetch(`${url}/api/docs-json`);
    expect(response.status).toBe(200);
    const document = (await response.json()) as OpenAPIObject;
    const healthRef = { $ref: '#/components/schemas/HealthResponse' };
    expect(document).toMatchObject({
      components: { schemas: { HealthResponse: { type: 'object' } } },
      paths: {
        '/api/health': {
          get: {
            responses: {
              200: { content: { 'application/json': { schema: healthRef } } },
              503: { content: { 'application/json': { schema: healthRef } } },
            },
          },
        },
      },
    });
  });
});

describe('api with an unreachable database', () => {
  const unreachable = createDatabase('postgres://nobody:nothing@127.0.0.1:1/none');
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    ({ app, url } = await startApp({
      override: (builder) => {
        builder.overrideProvider(DATABASE).useValue(unreachable.db);
      },
    }));
  });
  afterAll(async () => {
    await app.close();
    await unreachable.close();
  });

  it('GET /api/health returns 503 with the database marked down', async () => {
    const response = await fetch(`${url}/api/health`);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: 'error', checks: { database: 'down' } });
  });
});
