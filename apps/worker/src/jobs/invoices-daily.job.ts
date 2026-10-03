import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { INVOICES_DAILY_JOB } from '@vertex-hub/contracts';
import { PgBossService } from './pg-boss.service.js';

/**
 * Schedules the daily overdue run of invoices (F13 A10) at 00:15 in Asia/Damascus. The API process works
 * the queue through the `invoices` module (ADR 0008).
 */
@Injectable()
export class InvoicesDailyJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(InvoicesDailyJob.name);

  constructor(private readonly pgBoss: PgBossService) {}

  async onApplicationBootstrap(): Promise<void> {
    const { boss } = this.pgBoss;
    const { queue, cron, tz } = INVOICES_DAILY_JOB;
    await boss.createQueue(queue);
    await boss.schedule(queue, cron, null, { tz });
    this.logger.log(`Scheduled ${queue} (${cron} ${tz})`);
  }
}
