import { NestFactory } from '@nestjs/core';
import { loadRootEnv } from '@vertex-hub/db';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module.js';

loadRootEnv();

// Standalone context: no HTTP server. pg-boss timers keep the process alive.
const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
app.useLogger(app.get(Logger));
app.enableShutdownHooks();
