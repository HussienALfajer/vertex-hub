import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Transaction } from '@vertex-hub/db';
import { type SQL, sql } from 'drizzle-orm';
import { PgBoss, type SendOptions } from 'pg-boss';
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
      await this.ensureQueue(this.boss, queue);
      await this.boss.send(queue, data, options);
    } catch (error) {
      this.logger.error(error, `Could not queue ${queue}`);
    }
  }

  /**
   * Queues a job inside `tx`, so it commits or rolls back with the change (ADR 0028: an email and
   * its `email.send` job). A failure fails the transaction. A no-op while pg-boss is off, as `send`.
   */
  async sendInTransaction(
    tx: Transaction,
    queue: string,
    data: object,
    options: Pick<SendOptions, 'retryLimit' | 'retryDelay' | 'retryBackoff'> = {},
  ): Promise<void> {
    if (!this.boss) return;
    await this.ensureQueue(this.boss, queue);
    await this.boss.send(queue, data, {
      ...options,
      db: { executeSql: (text, values = []) => tx.execute(positionalSql(text, values)) },
    });
  }

  private async ensureQueue(boss: PgBoss, queue: string): Promise<void> {
    if (this.handlers.has(queue) || this.created.has(queue)) return;
    // A queue the worker works (F04 `quotes.pdf`) may not exist yet when the worker is down.
    await boss.createQueue(queue);
    this.created.add(queue);
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

/** pg-boss's `$1`-style statement as a Drizzle query, so it runs on a transaction's connection. */
function positionalSql(text: string, values: unknown[]): SQL {
  const chunks: SQL[] = [];
  let rest = 0;
  for (const match of text.matchAll(/\$(\d+)/g)) {
    chunks.push(sql.raw(text.slice(rest, match.index)));
    chunks.push(sql`${sql.param(values[Number(match[1]) - 1])}`);
    rest = match.index + match[0].length;
  }
  chunks.push(sql.raw(text.slice(rest)));
  return sql.join(chunks);
}
