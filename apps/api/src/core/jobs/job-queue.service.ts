import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import { ENV, type Env } from '../config/env.js';

/**
 * Works pg-boss queues that `apps/worker` schedules (ADR 0008). Modules register a handler in
 * `onModuleInit`; pg-boss starts on bootstrap only when handlers exist and `JOBS_ENABLED` is on,
 * so tests and the OpenAPI export never start it.
 */
@Injectable()
export class JobQueue implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(JobQueue.name);
  private readonly handlers = new Map<string, () => Promise<void>>();
  private boss: PgBoss | undefined;

  constructor(@Inject(ENV) private readonly env: Env) {}

  /** Runs `handler` for each job of `queue`. The handler must be idempotent: pg-boss retries. */
  work(queue: string, handler: () => Promise<void>): void {
    this.handlers.set(queue, handler);
  }

  /**
   * Queues a job for a queue this process works, after the change that needs it committed. A
   * no-op while pg-boss is off (tests, the OpenAPI export): the handler's service must also pick
   * up work it missed, since a job is only a nudge.
   */
  async send(queue: string): Promise<void> {
    if (!this.boss) return;
    try {
      await this.boss.send(queue, {});
    } catch (error) {
      this.logger.error(error, `Could not queue ${queue}`);
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.JOBS_ENABLED || this.handlers.size === 0) return;
    const boss = new PgBoss(this.env.DATABASE_URL);
    boss.on('error', (error) => this.logger.error(error));
    await boss.start();
    this.boss = boss;
    for (const [queue, handler] of this.handlers) {
      await boss.createQueue(queue);
      await boss.work(queue, async () => handler());
      this.logger.log(`Working ${queue}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.boss?.stop({ graceful: true });
  }
}
