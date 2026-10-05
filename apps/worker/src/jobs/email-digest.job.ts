import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { EMAIL_DIGEST_JOB } from '@vertex-hub/contracts';
import { PgBossService } from './pg-boss.service.js';

/**
 * Schedules the morning digest at 08:00 on work days (F14 email rule 10), in Asia/Damascus.
 * The API process works the queue through the `notifications` module (ADR 0008).
 */
@Injectable()
export class EmailDigestJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmailDigestJob.name);

  constructor(private readonly pgBoss: PgBossService) {}

  async onApplicationBootstrap(): Promise<void> {
    const { boss } = this.pgBoss;
    const { queue, cron, tz } = EMAIL_DIGEST_JOB;
    await boss.createQueue(queue);
    await boss.schedule(queue, cron, null, { tz });
    this.logger.log(`Scheduled ${queue} (${cron} ${tz})`);
  }
}
