import { Inject, Injectable } from '@nestjs/common';
import {
  type CalendarDate,
  createTaskSchema,
  type DepartmentCode,
  SHOOT_DEPARTMENT,
  type TaskStatus,
} from '@vertex-hub/contracts';
import { type Database, type Transaction, taskDependencies, tasks } from '@vertex-hub/db';
import { and, count, eq, inArray, isNull, ne, notInArray } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientReviewHooks } from './client-review-hooks.js';
import { actorOf } from './task-access.js';
import { cancelledColumns, TaskHooksService } from './task-hooks.service.js';
import { blocksDependents, requesterOf, TaskNotices } from './task-notices.js';
import { TasksService } from './tasks.service.js';

type Executor = Database | Transaction;

/** A task as the `calendar` module sees it: a shoot task or an editing task. */
export interface ShootTask {
  id: string;
  title: string;
  department: DepartmentCode;
  status: TaskStatus;
  assigneeId: string | null;
  dueDate: CalendarDate;
  clientId: string | null;
  projectId: string | null;
  milestoneId: string | null;
  retainerCycleId: string | null;
  cycleLineId: string | null;
  /** The post the task produces media for (F08): delivered through the post, never a shoot. */
  postId: string | null;
  archived: boolean;
}

/** The engagement links a new shoot task takes (F11 rule 3). */
export interface ShootTaskLinks {
  projectId: string | null;
  milestoneId: string | null;
  retainerCycleId: string | null;
  cycleLineId: string | null;
}

/** Rule 12: the editing task closing creates, with what the caller checked. */
export interface EditingTaskDraft {
  title: string;
  department: DepartmentCode;
  assigneeId: string | null;
  dueDate: CalendarDate;
  needsClientApproval: boolean;
  brief: string | null;
  rawFilesUrl: string | null;
  /** The assignee is team crew of the shoot in the department, or none: no assign scope needed. */
  onBehalf: boolean;
}

const shootTaskColumns = {
  id: tasks.id,
  title: tasks.title,
  department: tasks.department,
  status: tasks.status,
  assigneeId: tasks.assigneeId,
  dueDate: tasks.dueDate,
  clientId: tasks.clientId,
  projectId: tasks.projectId,
  milestoneId: tasks.milestoneId,
  retainerCycleId: tasks.retainerCycleId,
  cycleLineId: tasks.cycleLineId,
  postId: tasks.postId,
  archivedAt: tasks.archivedAt,
};

type ShootTaskRow = Omit<ShootTask, 'archived'> & { archivedAt: Date | null };

const toShootTask = ({ archivedAt, ...row }: ShootTaskRow): ShootTask => ({
  ...row,
  archived: !!archivedAt,
});

/** The statuses a task is open in. */
const CLOSED: TaskStatus[] = ['delivered', 'cancelled'];

/**
 * What the `calendar` module reads and changes of tasks (spec F11 rules 2–4, 11–13; ADR 0022):
 * the shoot task booked, created, kept on the shoot's day, delivered on close or cancelled with
 * the shoot, and the editing task closing creates. Each change writes F06's task audit entry and
 * notices. The caller holds the shoot's lock, taken before any task lock.
 */
@Injectable()
export class ShootTasks {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly tasks: TasksService,
    private readonly notices: TaskNotices,
    private readonly hooks: TaskHooksService,
    private readonly reviewHooks: ClientReviewHooks,
  ) {}

  /** The tasks by id, archived ones included. */
  async summaries(ids: readonly string[], executor: Executor = this.db) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map<string, ShootTask>();
    const rows = await executor
      .select(shootTaskColumns)
      .from(tasks)
      .where(inArray(tasks.id, unique));
    return new Map(rows.map((row) => [row.id, toShootTask(row)]));
  }

  /** The task, locked; null when it does not exist. */
  async lock(tx: Transaction, id: string): Promise<ShootTask | null> {
    const [row] = await tx
      .select(shootTaskColumns)
      .from(tasks)
      .where(eq(tasks.id, id))
      .for('update');
    return row ? toShootTask(row) : null;
  }

  /**
   * Rule 2: open, not archived and in Photography (another active shoot is the caller's check).
   * A task linked to a post is delivered by publishing the post (F08 rules 7 and 18), so closing
   * a shoot could never deliver it.
   */
  isBookable(task: ShootTask): boolean {
    return (
      !task.archived &&
      !task.postId &&
      task.department === SHOOT_DEPARTMENT &&
      !CLOSED.includes(task.status)
    );
  }

  /** Rule 12: the live, non-cancelled tasks that depend on each task. */
  async dependentCounts(ids: readonly string[], executor: Executor = this.db) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map<string, number>();
    const rows = await executor
      .select({ id: taskDependencies.dependsOnId, value: count() })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.taskId))
      .where(
        and(
          inArray(taskDependencies.dependsOnId, unique),
          isNull(tasks.archivedAt),
          ne(tasks.status, 'cancelled'),
        ),
      )
      .groupBy(taskDependencies.dependsOnId);
    return new Map(rows.map((row) => [row.id, row.value]));
  }

  /**
   * Rule 3: a Photography task for the shoot, created for the booker on the system's behalf: no
   * client approval, assigned to `assigneeId` (the lead when in Photography) or left in the queue.
   * F06 checks the links and sends the assignment or request notice.
   */
  async createShootTask(
    tx: Transaction,
    actor: CurrentUserInfo,
    draft: {
      title: string;
      clientId: string | null;
      links: ShootTaskLinks;
      dueDate: CalendarDate;
      assigneeId: string | null;
    },
  ): Promise<ShootTask> {
    const id = await this.tasks.createIn(
      tx,
      actor,
      createTaskSchema.parse({
        title: draft.title,
        department: SHOOT_DEPARTMENT,
        assigneeId: draft.assigneeId,
        dueDate: draft.dueDate,
        clientId: draft.clientId,
        ...draft.links,
        needsClientApproval: false,
      }),
      { onBehalf: true },
    );
    const task = await this.lock(tx, id);
    if (!task) throw new Error(`Shoot task ${id} was not created`);
    return task;
  }

  /** Rule 4: the shoot task is due on the shoot's day; an audited task change by the actor. */
  async setDueDate(
    tx: Transaction,
    task: ShootTask,
    dueDate: CalendarDate,
    actor: AuditActor,
  ): Promise<void> {
    if (task.dueDate === dueDate) return;
    await tx.update(tasks).set({ dueDate }).where(eq(tasks.id, task.id));
    await recordAudit(tx, {
      actor,
      action: 'task.updated',
      entityType: 'task',
      entityId: task.id,
      before: { dueDate: task.dueDate },
      after: { dueDate },
    });
  }

  /**
   * Rule 11: closing the shoot delivers its task from any open status, a system move recorded as
   * "Shoot closed", so the deliverables counter counts it (ADR 0015). A delivered task is left as
   * it is.
   */
  async deliver(
    tx: Transaction,
    taskId: string,
    shootId: string,
    actor: CurrentUserInfo,
  ): Promise<void> {
    const task = await this.notices.load(tx, taskId);
    if (CLOSED.includes(task.status)) return;
    await tx
      .update(tasks)
      .set({ status: 'delivered', reviewStage: null, deliveredAt: new Date() })
      .where(eq(tasks.id, taskId));
    await recordAudit(tx, {
      actor: actorOf(actor),
      action: 'task.status_changed',
      entityType: 'task',
      entityId: taskId,
      before: { status: task.status },
      after: { status: 'delivered', reason: 'shoot_closed', shootId },
    });
    // F09 rule 17: a delivered task is no longer with the client.
    if (task.status === 'awaiting_client') {
      await this.reviewHooks.left(tx, { taskId, actor: actorOf(actor), response: null });
    }
    await this.notices.send(tx, [
      this.notices.notice(task, 'request_finished', [requesterOf(task)], actor.id, {
        outcome: 'delivered',
      }),
      ...(blocksDependents(task)
        ? await this.notices.openedDependents(tx, [taskId], actor.id)
        : []),
    ]);
  }

  /** Rule 13: "Also cancel the shoot task", with the shoot's reason, as F06 cancels it. */
  async cancel(
    tx: Transaction,
    taskId: string,
    reason: string,
    shootId: string,
    actor: AuditActor,
  ): Promise<void> {
    const open = await tx
      .select(cancelledColumns)
      .from(tasks)
      .where(and(eq(tasks.id, taskId), notInArray(tasks.status, CLOSED), isNull(tasks.archivedAt)))
      .for('update');
    await this.hooks.cancelLocked(tx, open, reason, actor, { shootId });
  }

  /**
   * Rule 12: the editing task follows the shoot task: its client and project or milestone, or its
   * retainer cycle without a line; it depends on the shoot task and holds the raw files link.
   */
  async createEditingTask(
    tx: Transaction,
    actor: CurrentUserInfo,
    shootTask: ShootTask,
    draft: EditingTaskDraft,
  ): Promise<ShootTask> {
    const id = await this.tasks.createIn(
      tx,
      actor,
      createTaskSchema.parse({
        title: draft.title,
        brief: draft.brief,
        department: draft.department,
        assigneeId: draft.assigneeId,
        dueDate: draft.dueDate,
        clientId: shootTask.clientId,
        projectId: shootTask.projectId,
        milestoneId: shootTask.milestoneId,
        retainerCycleId: shootTask.retainerCycleId,
        cycleLineId: null,
        needsClientApproval: draft.needsClientApproval,
        dependsOn: [shootTask.id],
        links: draft.rawFilesUrl ? [{ url: draft.rawFilesUrl }] : [],
      }),
      { onBehalf: draft.onBehalf, inheritsLinks: true },
    );
    const task = await this.lock(tx, id);
    if (!task) throw new Error(`Editing task ${id} was not created`);
    return task;
  }
}
