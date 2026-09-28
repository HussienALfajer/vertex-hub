import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { healthResponseSchema } from '@vertex-hub/contracts';
import { createDatabase } from '@vertex-hub/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DATABASE } from '../src/database/database.module.js';

async function startApp(
  override?: (builder: TestingModuleBuilder) => void,
): Promise<{ app: INestApplication; url: string }> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  override?.(builder);
  const app = (await builder.compile()).createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  return { app, url: await app.getUrl() };
}

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
    ({ app, url } = await startApp((builder) => {
      builder.overrideProvider(DATABASE).useValue(unreachable.db);
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
