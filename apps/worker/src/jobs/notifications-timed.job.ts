import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { NOTIFICATIONS_TIMED_JOB } from '@vertex-hub/contracts';
import { PgBossService } from './pg-boss.service.js';

/**
 * Schedules the minute notification run (F16 rule B13) every minute in Asia/Damascus. The API
 * process works the queue through the `notifications` module (ADR 0008, ADR 0018).
 */
@Injectable()
export class NotificationsTimedJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationsTimedJob.name);

  constructor(private readonly pgBoss: PgBossService) {}

  async onApplicationBootstrap(): Promise<void> {
    const { boss } = this.pgBoss;
    const { queue, cron, tz } = NOTIFICATIONS_TIMED_JOB;
    await boss.createQueue(queue);
    await boss.schedule(queue, cron, null, { tz });
    this.logger.log(`Scheduled ${queue} (${cron} ${tz})`);
  }
}
