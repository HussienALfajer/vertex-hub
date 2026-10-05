/**
 * Runs the `email.notifications` job once, as if at the given instant (default: now), for trying
 * notification emails locally (spec F14 email, acceptance step 4). Refused in production, where
 * the worker schedules the job. The emails it queues are sent by the worker.
 *
 *   pnpm --filter @vertex-hub/api email:run-notifications [--at 2026-10-05T09:30:00+03:00]
 */
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { loadRootEnv } from '@vertex-hub/db';
import { z } from 'zod';
import { AppModule } from '../app.module.js';
import { JobQueue } from '../core/jobs/index.js';
import { NotificationEmails } from '../modules/notifications/index.js';

loadRootEnv();

if (process.env.NODE_ENV === 'production') {
  console.error('email:run-notifications is a development script; the worker runs the job.');
  process.exit(1);
}

const { values } = parseArgs({ options: { at: { type: 'string' } } });
const at = z.iso.datetime({ offset: true }).optional().safeParse(values.at);
if (!at.success) {
  console.error('Usage: email:run-notifications [--at <ISO date-time>]');
  process.exit(1);
}

// Run the handler here, not through pg-boss, but send the `email.send` jobs to the worker.
process.env.JOBS_ENABLED = 'false';
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  await app.get(JobQueue).startSending();
  const now = at.data ? new Date(at.data) : new Date();
  const sent = await app.get(NotificationEmails).runBatches(now);
  process.stdout.write(`Notification emails: ${sent} queued\n`);
} finally {
  await app.close();
}
