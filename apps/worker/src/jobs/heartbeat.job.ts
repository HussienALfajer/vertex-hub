import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { type Database, workerHeartbeats } from '@vertex-hub/db';
import { ENV, type Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { PgBossService } from './pg-boss.service.js';

export const HEARTBEAT_QUEUE = 'system.heartbeat';
export const HEARTBEAT_CRON = '* * * * *';

/** Sample scheduled job: records that this worker is alive, once a minute. Safe to retry. */
@Injectable()
export class HeartbeatJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(HeartbeatJob.name);

  constructor(
    private readonly pgBoss: PgBossService,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const { boss } = this.pgBoss;
    await boss.createQueue(HEARTBEAT_QUEUE);
    await boss.schedule(HEARTBEAT_QUEUE, HEARTBEAT_CRON);
    await boss.work(HEARTBEAT_QUEUE, async () => this.beat());
    this.logger.log(`Scheduled ${HEARTBEAT_QUEUE} (${HEARTBEAT_CRON})`);
  }

  /** Upserts this worker's heartbeat row, so running it twice leaves one row. */
  async beat(now = new Date()): Promise<void> {
    await this.db
      .insert(workerHeartbeats)
      .values({ worker: this.env.WORKER_NAME, beatAt: now })
      .onConflictDoUpdate({ target: workerHeartbeats.worker, set: { beatAt: now } });
  }
}
