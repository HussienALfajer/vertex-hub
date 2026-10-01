import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { OPEN_TASK_STATUSES, type TaskCounts } from '@vertex-hub/contracts';
import { type Database, type Transaction, tasks } from '@vertex-hub/db';
import { and, asc, count, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { DATABASE } from '../../core/database/database.module.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { ResponsibilityRegistry } from '../auth/index.js';
import { EngagementDirectory, WorkProgress } from '../projects/index.js';
import { ClientReviewHooks } from './client-review-hooks.js';
import { PostTaskHooks, unlinkRemovedTask } from './post-task-hooks.js';
import { TaskGuards } from './task-guards.js';
import { blocksDependents, TaskNotices } from './task-notices.js';

/** What cancelling needs of an open task, read under its lock. */
export type CancelledTask = Pick<
  typeof tasks.$inferSelect,
  'id' | 'title' | 'status' | 'extraWorkItemId' | 'postId'
>;

/** The columns of `CancelledTask`. */
export const cancelledColumns = {
  id: tasks.id,
  title: tasks.title,
  status: tasks.status,
  extraWorkItemId: tasks.extraWorkItemId,
  postId: tasks.postId,
};

/**
 * What tasks feed into other modules (spec F06, "Links F06 fills in F05" and "Changes to F01"):
 * task counts and the project close hooks for `projects`, and open assigned tasks for `auth`.
 */
@Injectable()
export class TaskHooksService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly progress: WorkProgress,
    private readonly responsibilities: ResponsibilityRegistry,
    private readonly engagements: EngagementDirectory,
    private readonly notices: TaskNotices,
    private readonly reviewHooks: ClientReviewHooks,
    private readonly postHooks: PostTaskHooks,
    private readonly guards: TaskGuards,
  ) {}

  onModuleInit(): void {
    this.progress.register({
      projects: (ids, executor) => this.counts(tasks.projectId, ids, executor),
      milestones: (ids, executor) => this.counts(tasks.milestoneId, ids, executor),
      cycleLines: (ids, executor) => this.counts(tasks.cycleLineId, ids, executor),
      openTasks: (tx, projectId) => this.openTasks(tx, projectId),
      cancelOpenTasks: (tx, projectId, reason, actor) =>
        this.cancelOpenTasks(tx, projectId, reason, actor),
    });
    // F01 change: a user with open assigned tasks cannot be archived.
    this.responsibilities.register({
      find: async (tx, userId) => {
        const assigned = await tx
          .select({ id: tasks.id, name: tasks.title })
          .from(tasks)
          .where(
            and(
              eq(tasks.assigneeId, userId),
              inArray(tasks.status, [...OPEN_TASK_STATUSES]),
              isNull(tasks.archivedAt),
            ),
          )
          .orderBy(asc(tasks.dueDate), asc(tasks.title));
        return assigned.map((task) => ({ type: 'assignee_of_open_tasks' as const, ...task }));
      },
    });
  }

  /** `total`: non-archived, non-cancelled tasks; `delivered`: those delivered. */
  private async counts(
    column: PgColumn,
    ids: string[],
    executor: Database | Transaction = this.db,
  ): Promise<Map<string, TaskCounts>> {
    const rows = await executor
      .select({
        id: sql<string>`${column}`,
        total: count(),
        delivered: sql<number>`count(*) filter (where ${tasks.status} = 'delivered')`.mapWith(
          Number,
        ),
      })
      .from(tasks)
      .where(and(inArray(column, ids), isNull(tasks.archivedAt), ne(tasks.status, 'cancelled')))
      .groupBy(column);
    return new Map(
      rows.map((row) => [
        row.id,
        { total: row.total, delivered: row.delivered, open: row.total - row.delivered },
      ]),
    );
  }

  private openTaskFilter(projectId: string) {
    return and(
      eq(tasks.projectId, projectId),
      inArray(tasks.status, [...OPEN_TASK_STATUSES]),
      isNull(tasks.archivedAt),
    );
  }

  private async openTasks(tx: Transaction, projectId: string) {
    return tx
      .select({ id: tasks.id, name: tasks.title })
      .from(tasks)
      .where(this.openTaskFilter(projectId))
      .orderBy(asc(tasks.dueDate), asc(tasks.title));
  }

  /** Cancelling a project cancels its open tasks with its reason, each audited. */
  private async cancelOpenTasks(
    tx: Transaction,
    projectId: string,
    reason: string,
    actor: AuditActor,
  ): Promise<void> {
    const open = await tx
      .select(cancelledColumns)
      .from(tasks)
      .where(this.openTaskFilter(projectId))
      // By id, the order every task lock set follows, so a concurrent move cannot deadlock.
      .orderBy(asc(tasks.id))
      .for('update');
    // F11 edge case 7: a task a scheduled shoot holds keeps the project open.
    await this.guards.assertFree(
      tx,
      open.map((task) => task.id),
    );
    await this.cancelLocked(tx, open, reason, actor, { projectId });
  }

  /**
   * Cancels open tasks the caller locked, with the reason and `context` (what cancelled them) in
   * each audit entry: unbilled extra work withdrawn, client review left, post unlinked, notices.
   */
  async cancelLocked(
    tx: Transaction,
    open: CancelledTask[],
    reason: string,
    actor: AuditActor,
    context: Record<string, string>,
  ): Promise<void> {
    if (open.length === 0) return;
    await tx
      .update(tasks)
      .set({
        status: 'cancelled',
        reviewStage: null,
        cancelledAt: new Date(),
        cancelReason: reason,
      })
      .where(
        inArray(
          tasks.id,
          open.map((task) => task.id),
        ),
      );
    // Edge case 10: cancelled out-of-scope requests withdraw their unbilled extra work.
    const items = await this.engagements.extraWork(
      open.flatMap((task) => (task.extraWorkItemId ? [task.extraWorkItemId] : [])),
      tx,
    );
    for (const task of open) {
      const item = task.extraWorkItemId ? items.get(task.extraWorkItemId) : undefined;
      const withdrawn = !!item && !item.archived && item.billingStatus === 'unbilled';
      if (withdrawn) {
        await this.engagements.archiveExtraWork(tx, item.id, actor);
        await tx.update(tasks).set({ extraWorkItemId: null }).where(eq(tasks.id, task.id));
      }
      await recordAudit(tx, {
        actor,
        action: 'task.status_changed',
        entityType: 'task',
        entityId: task.id,
        before: { status: task.status, ...(withdrawn && { extraWorkItemId: item.id }) },
        after: {
          status: 'cancelled',
          note: reason,
          ...context,
          ...(withdrawn && { extraWorkItemId: null }),
        },
      });
      // F09 rule 17: a cancelled task is no longer with the client.
      if (task.status === 'awaiting_client') {
        await this.reviewHooks.left(tx, { taskId: task.id, actor, response: null });
      }
      // F08 rule 8: a cancelled task leaves its post.
      await unlinkRemovedTask(tx, this.postHooks, task, 'cancelled', actor);
      const cancelled = await this.notices.load(tx, task.id);
      await this.notices.send(tx, this.notices.cancelled(cancelled, actor.id));
    }
    // Rule 7: the tasks waiting on the cancelled ones, once each.
    const blocking = open.filter((task) => blocksDependents({ ...task, archivedAt: null }));
    await this.notices.send(
      tx,
      await this.notices.openedDependents(
        tx,
        blocking.map((task) => task.id),
        actor.id,
      ),
    );
  }
}
