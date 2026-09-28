/**
 * Writes the OpenAPI document to apps/web/src/lib/api/openapi.json, where the web app generates
 * its typed client from it (ADR 0003). CI fails when the committed file is out of date.
 *
 *   pnpm --filter @vertex-hub/api openapi:export
 */
import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { loadRootEnv } from '@vertex-hub/db';
import { AppModule } from '../app.module.js';
import { API_PREFIX, createOpenApiDocument } from '../app.setup.js';

loadRootEnv();

const target = new URL('../../../web/src/lib/api/openapi.json', import.meta.url);
// No request is served, so no database connection is opened.
const app = await NestFactory.create(AppModule, { logger: false, bodyParser: false });
app.setGlobalPrefix(API_PREFIX);
writeFileSync(target, `${JSON.stringify(createOpenApiDocument(app), null, 2)}\n`);
await app.close();
process.stdout.write(`Wrote ${target.pathname}\n`);
