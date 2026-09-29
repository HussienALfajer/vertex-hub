/**
 * Runs the `notifications.daily` job once, as if on the given business date (default: today), for
 * trying reminders locally (spec F14, acceptance step 6). Refused in production, where the worker
 * schedules the job.
 *
 *   pnpm --filter @vertex-hub/api notifications:run-daily [--date YYYY-MM-DD]
 */
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { calendarDateSchema } from '@vertex-hub/contracts';
import { loadRootEnv } from '@vertex-hub/db';
import { AppModule } from '../app.module.js';
import { DailyReminders } from '../modules/notifications/index.js';

loadRootEnv();

if (process.env.NODE_ENV === 'production') {
  console.error('notifications:run-daily is a development script; the worker runs the job.');
  process.exit(1);
}

const { values } = parseArgs({ options: { date: { type: 'string' } } });
const date = calendarDateSchema.optional().safeParse(values.date);
if (!date.success) {
  console.error('Usage: notifications:run-daily [--date YYYY-MM-DD]');
  process.exit(1);
}

// Run the handler here, not through pg-boss.
process.env.JOBS_ENABLED = 'false';
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const result = await app.get(DailyReminders).runDaily(date.data);
  process.stdout.write(`Daily notifications: ${result.sent} sent, ${result.purged} purged\n`);
} finally {
  await app.close();
}
