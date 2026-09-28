import { NestFactory } from '@nestjs/core';
import { loadRootEnv } from '@vertex-hub/db';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { ENV, type Env } from './config/env.js';

loadRootEnv();

// Better Auth parses its own request bodies; its Nest module re-adds parsers for other routes.
const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
configureApp(app);
app.enableShutdownHooks();

const env = app.get<Env>(ENV);
await app.listen(env.API_PORT, env.API_HOST);
