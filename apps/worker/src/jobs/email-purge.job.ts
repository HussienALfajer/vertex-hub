import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { EMAIL_PURGE_JOB } from '@vertex-hub/contracts';
import { PgBossService } from './pg-boss.service.js';

/**
 * Schedules the daily purge of staff emails older than 90 days (F14 email rule 25) at 03:30 in
 * Asia/Damascus. The API process works the queue through the `email` module (ADR 0008).
 */
@Injectable()
export class EmailPurgeJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmailPurgeJob.name);

  constructor(private readonly pgBoss: PgBossService) {}

  async onApplicationBootstrap(): Promise<void> {
    const { boss } = this.pgBoss;
    const { queue, cron, tz } = EMAIL_PURGE_JOB;
    await boss.createQueue(queue);
    await boss.schedule(queue, cron, null, { tz });
    this.logger.log(`Scheduled ${queue} (${cron} ${tz})`);
  }
}
