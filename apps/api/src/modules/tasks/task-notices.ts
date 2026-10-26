import { Injectable } from '@nestjs/common';
import {
  type DepartmentCode,
  isTaskFinished,
  type NotificationData,
  type NotificationType,
  type TaskDependency,
  type TaskResolutionState,
  type TimeOfDay,
  taskResolutions,
} from '@vertex-hub/contracts';
import { type Database, type Transaction, taskStages, tasks } from '@vertex-hub/db';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { UserDirectory } from '../auth/index.js';
import { ClientDirectory, type ClientSummary } from '../clients/index.js';
import {
  type Notice,
  NotificationCenter,
  RecordFollowers,
  type Resolution,
} from '../notifications/index.js';
import { EngagementDirectory, type ProjectLink } from '../projects/index.js';
import { accessColumns, type ParentRef, parentsOf, type TaskRow } from './task-access.js';
import { dependentsOf, isBlocked } from './task-dependencies.js';
import { TaskQueueHooks } from './task-queue-hooks.js';

type Executor = Database | Transaction;

/** A task with the client, project and parent its snapshot and recipients come from. */
export type NoticeTask = TaskRow & {
  client: ClientSummary | null;
  project: ProjectLink | null;
  parent: ParentRef | null;
};

/** A delivered subtask as a handover names it (F06B rule A12). */
export type HandoverSnapshot = { title: string; by: string | null; note: string | null };

/** Types whose snapshot is a task plus fields of their own. */
type TaskNoticeType = {
  [Type in NotificationType]: NotificationData<Type> extends { task: unknown } ? Type : never;
}[NotificationType];

/** What a task notice carries besides the task snapshot. */
type Extra<Type extends TaskNoticeType> = Omit<NotificationData<Type>, 'task'>;

/** A task is a request of its creator when someone else works it (`request_finished`). */
export const requesterOf = (task: NoticeTask): string | null =>
  task.createdById !== task.assigneeId ? task.createdById : null;

/** The task blocks the tasks waiting on it: live and not finished or cancelled (F06 rule 3). */
export const blocksDependents = (task: Pick<TaskRow, 'status' | 'archivedAt'>): boolean =>
  !task.archivedAt && !isTaskFinished(task.status) && task.status !== 'cancelled';

/** The fields the F16 resolution rules read. */
const resolutionState = (task: TaskRow): TaskResolutionState => ({
  status: task.status,
  reviewStage: task.reviewStage,
  assigneeId: task.assigneeId,
  dueDate: task.dueDate,
  dueTime: toTimeOfDay(task.dueTime),
  archived: !!task.archivedAt,
});

/** The task waits in its department's queue: open, not archived and unassigned. */
const queued = (task: TaskRow): boolean =>
  !task.assigneeId && !task.archivedAt && task.status !== 'cancelled';

const leftQueue = (before: TaskRow, after: TaskRow): boolean => queued(before) && !queued(after);

/** `HH:MM:SS` from the database to `HH:MM`. */
export const toTimeOfDay = (time: string | null): TimeOfDay | null => time?.slice(0, 5) ?? null;

/**
 * Builds and sends the task notifications of F14 ("Notification types"): recipients by role at
 * the moment of the change (rule 14) and the task snapshot. Callers pass every notice of one
 * change in one `send`, so the first-match order applies.
 */
@Injectable()
export class TaskNotices {
  constructor(
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
    private readonly engagements: EngagementDirectory,
    private readonly center: NotificationCenter,
    private readonly followers: RecordFollowers,
    private readonly queueHooks: TaskQueueHooks,
  ) {}

  /** The task as it is now in the transaction, with its client and project. */
  async load(executor: Executor, id: string): Promise<NoticeTask> {
    const [task] = await this.loadMany(executor, [id]);
    if (!task) throw new Error(`Task ${id} not found`);
    return task;
  }

  async loadMany(executor: Executor, ids: string[]): Promise<NoticeTask[]> {
    if (ids.length === 0) return [];
    const rows = await executor.select(accessColumns).from(tasks).where(inArray(tasks.id, ids));
    const linked = (key: 'clientId' | 'projectId') =>
      rows.flatMap((row) => (row[key] ? [row[key]] : []));
    const [clients, projects, parents] = await Promise.all([
      this.clients.summaries(linked('clientId'), executor),
      this.engagements.projects(linked('projectId'), executor),
      parentsOf(executor, rows),
    ]);
    return rows.map((row) => ({
      ...row,
      client: (row.clientId && clients.get(row.clientId)) || null,
      project: (row.projectId && projects.get(row.projectId)) || null,
      parent: (row.parentId && parents.get(row.parentId)) || null,
    }));
  }

  /** A notice about `task`; null recipients (no assignee, no creator) are left out. */
  notice<Type extends TaskNoticeType>(
    task: NoticeTask,
    type: Type,
    recipients: readonly (string | null)[],
    actorId: string | null,
    ...extra: keyof Extra<Type> extends never ? [] : [Extra<Type>]
  ): Notice {
    return {
      type,
      recipients: recipients.filter((id): id is string => !!id),
      actorId,
      subjectId: task.id,
      data: {
        task: {
          title: task.title,
          department: task.department,
          client: task.client?.name ?? null,
          project: task.project?.name ?? null,
          ...(task.parent && { parent: task.parent.title }),
        },
        ...extra[0],
      },
    } as Notice;
  }

  /** The current managers of the department (rule 14); none when it has no manager. */
  async managers(executor: Executor, department: DepartmentCode): Promise<string[]> {
    return (await this.users.departmentManagers([department], executor)).get(department) ?? [];
  }

  /** The assignee, or the department's managers when the task is unassigned. */
  async assigneeOrManagers(
    executor: Executor,
    task: Pick<TaskRow, 'assigneeId' | 'department'>,
  ): Promise<string[]> {
    return task.assigneeId ? [task.assigneeId] : this.managers(executor, task.department);
  }

  /**
   * Rule 7 (A03): `task_opened` for each task waiting on one of `taskIds` that is `new`, not
   * archived and no longer blocked, after those tasks stopped blocking (approved, delivered,
   * cancelled or archived: owner decision). One notice per task, however many of its dependencies
   * stopped blocking in the transaction. A subtask opened through a `run` dependency gets its
   * turn or its handover instead (F06B rule A6).
   */
  async openedDependents(
    tx: Transaction,
    taskIds: readonly string[],
    actorId: string | null,
  ): Promise<Notice[]> {
    const waiting = new Map<string, TaskDependency>();
    const viaRun = new Set<string>();
    for (const taskId of taskIds) {
      for (const dependent of await dependentsOf(taskId, tx)) {
        if (dependent.status === 'new' && !dependent.archived) waiting.set(dependent.id, dependent);
        if (dependent.source === 'run') viaRun.add(dependent.id);
      }
    }
    // Serializes with a change that unblocks the same task at once, so one of them sees it open.
    if (waiting.size > 0) {
      await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(inArray(tasks.id, [...waiting.keys()]))
        .orderBy(tasks.id)
        .for('update');
    }
    const notices: Notice[] = [];
    for (const dependent of waiting.values()) {
      if (await isBlocked(dependent.id, tx)) continue;
      const task = await this.load(tx, dependent.id);
      const opened = viaRun.has(task.id) ? await this.subtaskOpened(tx, task, actorId) : null;
      notices.push(
        opened ??
          this.notice(task, 'task_opened', await this.assigneeOrManagers(tx, task), actorId),
      );
    }
    return notices;
  }

  /**
   * F06B rules A6 and A12: a subtask its run opened. In sequence it is its turn, after the live
   * subtask before it; by stages it receives the previous non-empty stage's handover. Null when
   * the parent runs neither way.
   */
  async subtaskOpened(
    executor: Executor,
    task: NoticeTask,
    actorId: string | null,
  ): Promise<Notice | null> {
    const parent = task.parent;
    if (!parent || task.position === null) return null;
    const recipients = await this.assigneeOrManagers(executor, task);
    const siblings = await executor
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        assigneeId: tasks.assigneeId,
        position: tasks.position,
        stageId: tasks.stageId,
        handoverNote: tasks.handoverNote,
      })
      .from(tasks)
      .where(
        and(eq(tasks.parentId, parent.id), isNull(tasks.archivedAt), ne(tasks.status, 'cancelled')),
      )
      .orderBy(asc(tasks.position));
    const names = await this.users.summaries(
      siblings.flatMap((s) => (s.assigneeId ? [s.assigneeId] : [])),
      executor,
    );
    const snapshot = (sibling: (typeof siblings)[number]): HandoverSnapshot => ({
      title: sibling.title,
      by: sibling.assigneeId ? (names.get(sibling.assigneeId)?.name ?? null) : null,
      note: sibling.handoverNote,
    });
    if (parent.runMode === 'sequential') {
      const before = siblings.filter((s) => (s.position ?? 0) < (task.position ?? 0)).at(-1);
      return this.notice(task, 'subtask_turn', recipients, actorId, {
        parent: parent.title,
        previous: before ? snapshot(before) : null,
      });
    }
    if (parent.runMode !== 'stages' || !task.stageId) return null;
    const stages = await executor
      .select({ id: taskStages.id, name: taskStages.name })
      .from(taskStages)
      .where(and(eq(taskStages.taskId, parent.id), isNull(taskStages.archivedAt)))
      .orderBy(asc(taskStages.position));
    const at = stages.findIndex((stage) => stage.id === task.stageId);
    const previous = stages
      .slice(0, Math.max(at, 0))
      .reverse()
      .find((stage) => siblings.some((s) => s.stageId === stage.id));
    if (!previous) return null;
    return this.notice(task, 'subtask_handover', recipients, actorId, {
      parent: parent.title,
      stage: previous.name,
      handover: siblings
        .filter((s) => s.stageId === previous.id && s.status === 'delivered')
        .map(snapshot),
    });
  }

  /**
   * A delivered task: its requester, then (F16 part C) the project manager and the account
   * manager.
   */
  delivered(task: NoticeTask, actorId: string | null): Notice[] {
    return [
      this.notice(task, 'request_finished', [requesterOf(task)], actorId, {
        outcome: 'delivered',
      }),
      this.notice(
        task,
        'task_delivered',
        [task.project?.projectManagerId ?? null, task.client?.accountManagerId ?? null],
        actorId,
      ),
    ];
  }

  /** A cancelled task: its assignee and its requester hear about it. */
  cancelled(task: NoticeTask, actorId: string | null): Notice[] {
    return [
      this.notice(task, 'task_changed', [task.assigneeId], actorId, {
        change: 'cancelled',
        from: null,
        to: null,
      }),
      this.notice(task, 'request_finished', [requesterOf(task)], actorId, {
        outcome: 'cancelled',
      }),
    ];
  }

  send(
    tx: Transaction,
    notices: readonly Notice[],
    resolutions: readonly Resolution[] = [],
  ): Promise<number> {
    return this.center.notify(tx, notices, resolutions);
  }

  /**
   * F16 part C: sends the notices of one change of the task (`before`: the task as it was) with
   * what the change closes (rule B5) and, when its status moved, `task_progressed` to its
   * followers, which the first-match order drops for those another notice of the change already
   * tells (rule B12). `resolutions` adds what events of the change close.
   */
  async sendChange(
    tx: Transaction,
    before: TaskRow,
    actorId: string | null,
    notices: readonly Notice[] = [],
    resolutions: readonly Resolution[] = [],
  ): Promise<number> {
    const after = await this.load(tx, before.id);
    const subject = { type: 'task' as const, id: before.id };
    const progressed =
      before.status === after.status
        ? []
        : [
            this.notice(
              after,
              'task_progressed',
              await this.followers.recipients(tx, subject, 'tasks.read'),
              actorId,
              { status: after.status },
            ),
          ];
    // F16 part C: a generated task assigned or closed may empty its run's queue.
    if (leftQueue(before, after)) {
      await this.queueHooks.left(tx, { taskId: before.id, actorId });
    }
    return this.center.notify(
      tx,
      [...notices, ...progressed],
      [
        ...taskResolutions(resolutionState(before), resolutionState(after)).map((rule) => ({
          subject,
          ...rule,
          actorId,
        })),
        ...resolutions,
      ],
    );
  }

  /** Rule B12: the users follow the task from now on, unless they unfollowed it. */
  follow(tx: Transaction, taskId: string, userIds: readonly (string | null)[]): Promise<void> {
    return this.followers.follow(tx, { type: 'task', id: taskId }, userIds);
  }

  /** Rule B12: the followers who receive the task's notices. */
  followersOf(tx: Transaction, taskId: string): Promise<string[]> {
    return this.followers.recipients(tx, { type: 'task', id: taskId }, 'tasks.read');
  }

  /** Rule B5: closes what an event of a task change closes (a mention answered, a task linked). */
  resolve(tx: Transaction, resolution: Resolution): Promise<number> {
    return this.center.resolve(tx, resolution);
  }
}
