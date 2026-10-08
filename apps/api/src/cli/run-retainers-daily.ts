/**
 * Runs the `retainers.cycles` job once, as if on the given business date (default: today):
 * starts, completes and renews terms, ends retainers whose term ends them, closes and opens
 * cycles and drafts the charges that became due, for trying F05B locally (acceptance steps 5 and
 * 7). Refused in production, where the worker schedules the job.
 *
 *   pnpm --filter @vertex-hub/api retainers:run-daily [--date YYYY-MM-DD]
 */
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { calendarDateSchema } from '@vertex-hub/contracts';
import { loadRootEnv } from '@vertex-hub/db';
import { AppModule } from '../app.module.js';
import { RetainerCyclesService } from '../modules/projects/index.js';

loadRootEnv();

if (process.env.NODE_ENV === 'production') {
  console.error('retainers:run-daily is a development script; the worker runs the job.');
  process.exit(1);
}

const { values } = parseArgs({ options: { date: { type: 'string' } } });
const date = calendarDateSchema.optional().safeParse(values.date);
if (!date.success) {
  console.error('Usage: retainers:run-daily [--date YYYY-MM-DD]');
  process.exit(1);
}

// Run the handler here, not through pg-boss.
process.env.JOBS_ENABLED = 'false';
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const result = await app.get(RetainerCyclesService).runDaily(date.data);
  process.stdout.write(
    `Daily retainers: ${result.closed} cycles closed, ${result.opened} opened, ` +
      `${result.due} charges due, ${result.ended} retainers ended, ${result.renewed} terms renewed\n`,
  );
} finally {
  await app.close();
}
