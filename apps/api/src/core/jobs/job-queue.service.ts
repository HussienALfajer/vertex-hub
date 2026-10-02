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
  private readonly handlers = new Map<string, (data: unknown) => Promise<void>>();
  /** Queues this process sends to but another one works, created on first send. */
  private readonly created = new Set<string>();
  private boss: PgBoss | undefined;

  constructor(@Inject(ENV) private readonly env: Env) {}

  /**
   * Runs `handler` for each job of `queue`, with the job's data (unvalidated: parse it with its
   * contract schema). The handler must be idempotent: pg-boss retries.
   */
  work(queue: string, handler: (data: unknown) => Promise<void>): void {
    this.handlers.set(queue, handler);
  }

  /**
   * Queues a job, after the change that needs it committed: for a queue this process works, or
   * for one the worker works (F04 `quotes.pdf`). A no-op while pg-boss is off (tests, the
   * OpenAPI export): the handler's service must also pick up work it missed, since a job is only
   * a nudge.
   */
  async send(
    queue: string,
    data: object = {},
    options: { retryLimit?: number } = {},
  ): Promise<void> {
    if (!this.boss) return;
    try {
      if (!this.handlers.has(queue) && !this.created.has(queue)) {
        // A queue the worker works (F04 `quotes.pdf`) may not exist yet when the worker is down.
        await this.boss.createQueue(queue);
        this.created.add(queue);
      }
      await this.boss.send(queue, data, options);
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
      await boss.work(queue, async ([job]) => handler(job?.data));
      this.logger.log(`Working ${queue}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.boss?.stop({ graceful: true });
  }
}
