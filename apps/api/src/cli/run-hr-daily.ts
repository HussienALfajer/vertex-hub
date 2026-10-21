/**
 * Runs the `hr.daily` job once, as if on the given business date (default: today): the contract
 * and probation reminders and the archiving of accounts whose service ended (spec F17 part A),
 * for trying them locally. Refused in production, where the worker schedules the job.
 *
 *   pnpm --filter @vertex-hub/api hr:run-daily [--date YYYY-MM-DD]
 */
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { calendarDateSchema } from '@vertex-hub/contracts';
import { loadRootEnv } from '@vertex-hub/db';
import { AppModule } from '../app.module.js';
import { HrDailyService } from '../modules/hr/index.js';

loadRootEnv();

if (process.env.NODE_ENV === 'production') {
  console.error('hr:run-daily is a development script; the worker runs the job.');
  process.exit(1);
}

const { values } = parseArgs({ options: { date: { type: 'string' } } });
const date = calendarDateSchema.optional().safeParse(values.date);
if (!date.success) {
  console.error('Usage: hr:run-daily [--date YYYY-MM-DD]');
  process.exit(1);
}

// Run the handler here, not through pg-boss.
process.env.JOBS_ENABLED = 'false';
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const result = await app.get(HrDailyService).runDaily(date.data);
  process.stdout.write(
    `Daily HR: ${result.reminded} reminders sent, ${result.archived} accounts archived\n`,
  );
} finally {
  await app.close();
}
