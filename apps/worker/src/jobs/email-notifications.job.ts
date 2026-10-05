import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { EMAIL_NOTIFICATIONS_JOB } from '@vertex-hub/contracts';
import { PgBossService } from './pg-boss.service.js';

/**
 * Schedules the notification email batches every 5 minutes (F14 email rules 6–7); they
 * act only on work days from 08:10 to 20:00, in Asia/Damascus.
 * The API process works the queue through the `notifications` module (ADR 0008).
 */
@Injectable()
export class EmailNotificationsJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmailNotificationsJob.name);

  constructor(private readonly pgBoss: PgBossService) {}

  async onApplicationBootstrap(): Promise<void> {
    const { boss } = this.pgBoss;
    const { queue, cron, tz } = EMAIL_NOTIFICATIONS_JOB;
    await boss.createQueue(queue);
    await boss.schedule(queue, cron, null, { tz });
    this.logger.log(`Scheduled ${queue} (${cron} ${tz})`);
  }
}
