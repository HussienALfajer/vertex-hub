import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { APPROVALS_REMINDERS_JOB } from '@vertex-hub/contracts';
import { PgBossService } from './pg-boss.service.js';

/**
 * Schedules the hourly approval reminders (F09 rules 24 and 25, A04) at minute 15. The API
 * process works the queue through the `approvals` module, which owns the requests (ADR 0008).
 */
@Injectable()
export class ApprovalsRemindersJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(ApprovalsRemindersJob.name);

  constructor(private readonly pgBoss: PgBossService) {}

  async onApplicationBootstrap(): Promise<void> {
    const { boss } = this.pgBoss;
    const { queue, cron, tz } = APPROVALS_REMINDERS_JOB;
    await boss.createQueue(queue);
    await boss.schedule(queue, cron, null, { tz });
    this.logger.log(`Scheduled ${queue} (${cron} ${tz})`);
  }
}
