import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { FILES_PURGE_UPLOADS_JOB } from '@vertex-hub/contracts';
import { PgBossService } from './pg-boss.service.js';

/**
 * Schedules the daily purge of uploads left unattached for 24 hours (F10) at 03:00 in
 * Asia/Damascus. The API process works the queue through the `files` module (ADR 0008).
 */
@Injectable()
export class FilesPurgeUploadsJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(FilesPurgeUploadsJob.name);

  constructor(private readonly pgBoss: PgBossService) {}

  async onApplicationBootstrap(): Promise<void> {
    const { boss } = this.pgBoss;
    const { queue, cron, tz } = FILES_PURGE_UPLOADS_JOB;
    await boss.createQueue(queue);
    await boss.schedule(queue, cron, null, { tz });
    this.logger.log(`Scheduled ${queue} (${cron} ${tz})`);
  }
}
