import type { Server } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { loadRootEnv } from '@vertex-hub/db';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { ENV, type Env } from './core/config/env.js';

loadRootEnv();

// Better Auth parses its own request bodies; its Nest module re-adds parsers for other routes.
const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
configureApp(app);
app.enableShutdownHooks();
// Node ends any request not received in full within 5 minutes; a 250 MB upload on a slow line
// takes longer (F10). nginx's per-read body timeout guards against stalled clients instead.
(app.getHttpServer() as Server).requestTimeout = 0;

const env = app.get<Env>(ENV);
await app.listen(env.API_PORT, env.API_HOST);
