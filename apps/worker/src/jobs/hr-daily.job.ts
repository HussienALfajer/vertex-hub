import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { HR_DAILY_JOB } from '@vertex-hub/contracts';
import { PgBossService } from './pg-boss.service.js';

/**
 * Schedules the daily HR run (F17: reminders, ended services; later the attendance days and
 * leave accruals) at 00:10 in Asia/Damascus. The API process works the queue through the `hr`
 * module (ADR 0008).
 */
@Injectable()
export class HrDailyJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(HrDailyJob.name);

  constructor(private readonly pgBoss: PgBossService) {}

  async onApplicationBootstrap(): Promise<void> {
    const { boss } = this.pgBoss;
    const { queue, cron, tz } = HR_DAILY_JOB;
    await boss.createQueue(queue);
    await boss.schedule(queue, cron, null, { tz });
    this.logger.log(`Scheduled ${queue} (${cron} ${tz})`);
  }
}
