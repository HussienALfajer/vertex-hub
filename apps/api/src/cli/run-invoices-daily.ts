/**
 * Runs the `invoices.daily` job once, as if on the given business date (default: today): marks
 * past-due invoices overdue and alerts their readers, for trying A10 locally (spec F13,
 * acceptance step 5). The weekly reminders run with `notifications:run-daily`. Refused in
 * production, where the worker schedules the job.
 *
 *   pnpm --filter @vertex-hub/api invoices:run-daily [--date YYYY-MM-DD]
 */
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { calendarDateSchema } from '@vertex-hub/contracts';
import { loadRootEnv } from '@vertex-hub/db';
import { AppModule } from '../app.module.js';
import { InvoiceOverdueService } from '../modules/invoices/index.js';

loadRootEnv();

if (process.env.NODE_ENV === 'production') {
  console.error('invoices:run-daily is a development script; the worker runs the job.');
  process.exit(1);
}

const { values } = parseArgs({ options: { date: { type: 'string' } } });
const date = calendarDateSchema.optional().safeParse(values.date);
if (!date.success) {
  console.error('Usage: invoices:run-daily [--date YYYY-MM-DD]');
  process.exit(1);
}

// Run the handler here, not through pg-boss.
process.env.JOBS_ENABLED = 'false';
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const marked = await app.get(InvoiceOverdueService).runDaily(date.data);
  process.stdout.write(`Daily invoices: ${marked} marked overdue\n`);
} finally {
  await app.close();
}
