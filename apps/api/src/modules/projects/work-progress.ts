import { Injectable } from '@nestjs/common';
import type { TaskCounts } from '@vertex-hub/contracts';
import type { Database, Transaction } from '@vertex-hub/db';
import type { AuditActor } from '../audit/index.js';

/**
 * Task counts per project, milestone and retainer cycle line, reported by the module that owns
 * tasks (F06), and the project close hooks. Maps leave out ids without tasks. A caller inside a
 * transaction passes it, so the counts see the transaction's own changes on the same connection.
 */
export interface WorkProgressSource {
  projects(ids: string[], executor?: Executor): Promise<Map<string, TaskCounts>>;
  milestones(ids: string[], executor?: Executor): Promise<Map<string, TaskCounts>>;
  /** `delivered` feeds the deliverables counter (R7). */
  cycleLines(ids: string[], executor?: Executor): Promise<Map<string, TaskCounts>>;
  /** The project's open, non-archived tasks, for the complete check (F06). */
  openTasks(tx: Transaction, projectId: string): Promise<{ id: string; name: string }[]>;
  /** Cancels the project's open tasks with the project's reason, each audited (F06). */
  cancelOpenTasks(
    tx: Transaction,
    projectId: string,
    reason: string,
    actor: AuditActor,
  ): Promise<void>;
}

type Executor = Database | Transaction;

export const NO_TASKS: TaskCounts = { total: 0, delivered: 0, open: 0 };

/**
 * Lets the `tasks` module feed progress into projects without `projects` importing it (spec F05,
 * "Links F06 fills"). Until a source registers, every count is 0.
 */
@Injectable()
export class WorkProgress {
  private source: WorkProgressSource | undefined;

  register(source: WorkProgressSource): void {
    this.source = source;
  }

  async projects(ids: string[], executor?: Executor): Promise<Map<string, TaskCounts>> {
    return ids.length && this.source ? this.source.projects(ids, executor) : new Map();
  }

  async milestones(ids: string[], executor?: Executor): Promise<Map<string, TaskCounts>> {
    return ids.length && this.source ? this.source.milestones(ids, executor) : new Map();
  }

  async cycleLines(ids: string[], executor?: Executor): Promise<Map<string, TaskCounts>> {
    return ids.length && this.source ? this.source.cycleLines(ids, executor) : new Map();
  }

  async openTasks(tx: Transaction, projectId: string): Promise<{ id: string; name: string }[]> {
    return this.source ? this.source.openTasks(tx, projectId) : [];
  }

  async cancelOpenTasks(
    tx: Transaction,
    projectId: string,
    reason: string,
    actor: AuditActor,
  ): Promise<void> {
    await this.source?.cancelOpenTasks(tx, projectId, reason, actor);
  }
}

/** Delivered tasks ÷ tasks as a whole percentage rounded down; null without tasks (rule 9). */
export const progressOf = (counts: TaskCounts): number | null =>
  counts.total === 0 ? null : Math.floor((counts.delivered * 100) / counts.total);
