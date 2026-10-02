import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { QUOTES_DAILY_JOB } from '@vertex-hub/contracts';
import { PgBossService } from './pg-boss.service.js';

/**
 * Schedules the daily quote expiry (F04 rule 9) at 00:10 in Asia/Damascus. The API process works
 * the queue through the `quotes` module (ADR 0008).
 */
@Injectable()
export class QuotesDailyJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(QuotesDailyJob.name);

  constructor(private readonly pgBoss: PgBossService) {}

  async onApplicationBootstrap(): Promise<void> {
    const { boss } = this.pgBoss;
    const { queue, cron, tz } = QUOTES_DAILY_JOB;
    await boss.createQueue(queue);
    await boss.schedule(queue, cron, null, { tz });
    this.logger.log(`Scheduled ${queue} (${cron} ${tz})`);
  }
}
