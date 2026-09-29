import { Injectable } from '@nestjs/common';
import {
  type DepartmentCode,
  isTaskFinished,
  type NotificationData,
  type NotificationType,
  type TaskDependency,
  type TimeOfDay,
} from '@vertex-hub/contracts';
import { type Database, type Transaction, tasks } from '@vertex-hub/db';
import { inArray } from 'drizzle-orm';
import { UserDirectory } from '../auth/index.js';
import { ClientDirectory, type ClientSummary } from '../clients/index.js';
import { type Notice, NotificationCenter } from '../notifications/index.js';
import { EngagementDirectory, type ProjectLink } from '../projects/index.js';
import { accessColumns, type TaskRow } from './task-access.js';
import { dependentsOf, isBlocked } from './task-dependencies.js';

type Executor = Database | Transaction;

/** A task with the client and project its snapshot and recipients come from. */
export type NoticeTask = TaskRow & { client: ClientSummary | null; project: ProjectLink | null };

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
    const [clients, projects] = await Promise.all([
      this.clients.summaries(linked('clientId'), executor),
      this.engagements.projects(linked('projectId'), executor),
    ]);
    return rows.map((row) => ({
      ...row,
      client: (row.clientId && clients.get(row.clientId)) || null,
      project: (row.projectId && projects.get(row.projectId)) || null,
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
  async assigneeOrManagers(executor: Executor, task: NoticeTask): Promise<string[]> {
    return task.assigneeId ? [task.assigneeId] : this.managers(executor, task.department);
  }

  /**
   * Rule 7 (A03): `task_opened` for each task waiting on one of `taskIds` that is `new`, not
   * archived and no longer blocked, after those tasks stopped blocking (approved, delivered,
   * cancelled or archived: owner decision). One notice per task, however many of its dependencies
   * stopped blocking in the transaction.
   */
  async openedDependents(
    tx: Transaction,
    taskIds: readonly string[],
    actorId: string | null,
  ): Promise<Notice[]> {
    const waiting = new Map<string, TaskDependency>();
    for (const taskId of taskIds) {
      for (const dependent of await dependentsOf(taskId, tx)) {
        if (dependent.status === 'new' && !dependent.archived) waiting.set(dependent.id, dependent);
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
      notices.push(
        this.notice(task, 'task_opened', await this.assigneeOrManagers(tx, task), actorId),
      );
    }
    return notices;
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

  send(tx: Transaction, notices: readonly Notice[]): Promise<number> {
    return this.center.notify(tx, notices);
  }
}
