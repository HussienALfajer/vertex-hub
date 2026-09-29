import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { NOTIFICATIONS_DAILY_JOB } from '@vertex-hub/contracts';
import { PgBossService } from './pg-boss.service.js';

/**
 * Schedules the daily notification run (F14 rule 8) at 09:00 in Asia/Damascus on work days. The
 * API process works the queue through the `notifications` module, which runs the reminder
 * sources the other modules register (ADR 0008, ADR 0018).
 */
@Injectable()
export class NotificationsDailyJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationsDailyJob.name);

  constructor(private readonly pgBoss: PgBossService) {}

  async onApplicationBootstrap(): Promise<void> {
    const { boss } = this.pgBoss;
    const { queue, cron, tz } = NOTIFICATIONS_DAILY_JOB;
    await boss.createQueue(queue);
    await boss.schedule(queue, cron, null, { tz });
    this.logger.log(`Scheduled ${queue} (${cron} ${tz})`);
  }
}
