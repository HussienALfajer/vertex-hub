import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { RETAINER_CYCLES_JOB } from '@vertex-hub/contracts';
import { PgBossService } from './pg-boss.service.js';

/**
 * Schedules the daily retainer cycle run (F05 R2) at 00:05 in Asia/Damascus. The API process
 * works the queue through the `projects` module, where task counts (F06) are known (ADR 0008).
 */
@Injectable()
export class RetainerCyclesJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(RetainerCyclesJob.name);

  constructor(private readonly pgBoss: PgBossService) {}

  async onApplicationBootstrap(): Promise<void> {
    const { boss } = this.pgBoss;
    const { queue, cron, tz } = RETAINER_CYCLES_JOB;
    await boss.createQueue(queue);
    await boss.schedule(queue, cron, null, { tz });
    this.logger.log(`Scheduled ${queue} (${cron} ${tz})`);
  }
}
