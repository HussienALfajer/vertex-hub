/**
 * Runs the `email.digest` job once, as if at 08:00 on the given business date (default: today),
 * for trying the morning digest locally (spec F14 email, acceptance step 5). Refused in
 * production, where the worker schedules the job. The digests it queues are sent by the worker.
 *
 *   pnpm --filter @vertex-hub/api email:run-digest [--date YYYY-MM-DD]
 */
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { businessDate, businessInstant, calendarDateSchema } from '@vertex-hub/contracts';
import { loadRootEnv } from '@vertex-hub/db';
import { AppModule } from '../app.module.js';
import { JobQueue } from '../core/jobs/index.js';
import { NotificationEmails } from '../modules/notifications/index.js';

loadRootEnv();

if (process.env.NODE_ENV === 'production') {
  console.error('email:run-digest is a development script; the worker runs the job.');
  process.exit(1);
}

const { values } = parseArgs({ options: { date: { type: 'string' } } });
const date = calendarDateSchema.optional().safeParse(values.date);
if (!date.success) {
  console.error('Usage: email:run-digest [--date YYYY-MM-DD]');
  process.exit(1);
}

// Run the handler here, not through pg-boss, but send the `email.send` jobs to the worker.
process.env.JOBS_ENABLED = 'false';
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  await app.get(JobQueue).startSending();
  const day = date.data ?? businessDate();
  const sent = await app.get(NotificationEmails).runDigest(day, businessInstant(day, '08:00'));
  process.stdout.write(`Digests: ${sent} queued\n`);
} finally {
  await app.close();
}
