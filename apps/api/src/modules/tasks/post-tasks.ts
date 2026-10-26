import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type CalendarDate,
  type CreatePostTask,
  type CreateTask,
  createTaskSchema,
  type DepartmentCode,
  type HolidayRange,
  isTaskFinished,
  type LinkableTask,
  type LinkableTaskQuery,
  POST_LIMITS,
  shiftDueDate,
  type TaskStatus,
} from '@vertex-hub/contracts';
import { type Database, type Transaction, taskRevisions, tasks } from '@vertex-hub/db';
import { and, asc, count, eq, ilike, inArray, isNull, ne, notInArray, or } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { EngagementDirectory } from '../projects/index.js';
import { clearPostLink } from './post-task-hooks.js';
import { accessColumns, actorOf } from './task-access.js';
import { TaskCreation } from './task-creation.js';
import { TaskNotices } from './task-notices.js';
import { TaskReviews } from './task-reviews.js';
import { TasksService } from './tasks.service.js';

type Executor = Database | Transaction;

/** What linking needs of a post; the `content` module has locked it. */
export interface PostRef {
  id: string;
  clientId: string;
  /** The line the post counts on directly (rule 16): a task with a line cannot be linked too. */
  cycleLineId: string | null;
}

/** A task linked to a post, as the `content` module sees it. */
export interface LinkedTask {
  id: string;
  postId: string;
  title: string;
  department: DepartmentCode;
  assigneeId: string | null;
  status: TaskStatus;
  cycleLineId: string | null;
}

/** A task requested from a post (rule 9), with the defaults already worked out. */
export interface PostTaskDraft extends Pick<CreatePostTask, 'department' | 'cycleLineId'> {
  title: string;
  brief: string | null;
  dueDate: CalendarDate;
}

/** F08B rule B9: a linked task or one of its subtasks, with the due date a move gives it. */
export interface ShiftedTask {
  id: string;
  title: string;
  parentId: string | null;
  assigneeId: string | null;
  dueDate: CalendarDate;
  newDueDate: CalendarDate;
  /** The date would fall before today and became today (edge case 7). */
  clamped: boolean;
}

/** Rule 12: sending a linked task back; `response` is the client response that asked for it. */
export interface PostTaskReturn {
  note: string;
  response: { id: string; contactId: string } | null;
}

const linkedColumns = {
  id: tasks.id,
  postId: tasks.postId,
  title: tasks.title,
  department: tasks.department,
  assigneeId: tasks.assigneeId,
  status: tasks.status,
  cycleLineId: tasks.cycleLineId,
};

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** The statuses a task cannot be linked in (rule 6); the medical stage is checked beside them. */
const NOT_LINKABLE: TaskStatus[] = ['delivered', 'cancelled', 'awaiting_client'];

const toLinked = (row: Omit<LinkedTask, 'postId'> & { postId: string | null }): LinkedTask[] =>
  row.postId ? [{ ...row, postId: row.postId }] : [];

/**
 * What the `content` module reads and changes of tasks (spec F08 rules 5–9, 12, 16, 18, 19; ADR
 * 0021): the tasks linked to a post, linking and unlinking, a task requested from a post, sending
 * one back and delivering them when the post is published. `tasks.post_id` changes only here and
 * when a linked task is cancelled or archived. The caller holds the post's lock, taken before any
 * task lock.
 */
@Injectable()
export class PostTasks {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly tasks: TasksService,
    private readonly notices: TaskNotices,
    private readonly reviews: TaskReviews,
    private readonly engagements: EngagementDirectory,
    private readonly creation: TaskCreation,
  ) {}

  /** The tasks linked to each post, by link time. */
  async linked(
    postIds: readonly string[],
    executor: Executor = this.db,
  ): Promise<Map<string, LinkedTask[]>> {
    const byPost = new Map<string, LinkedTask[]>();
    if (postIds.length === 0) return byPost;
    const rows = await executor
      .select(linkedColumns)
      .from(tasks)
      .where(inArray(tasks.postId, [...new Set(postIds)]))
      .orderBy(asc(tasks.postLinkedAt), asc(tasks.id));
    for (const task of rows.flatMap(toLinked)) {
      byPost.set(task.postId, [...(byPost.get(task.postId) ?? []), task]);
    }
    return byPost;
  }

  /**
   * Rule 6: the client's open unlinked tasks the post may link, those of the retainer cycle of
   * its publish date first, then by due date; at most `POST_LIMITS.linkableTasks`.
   */
  async linkable(
    post: { clientId: string; publishDate: CalendarDate },
    query: LinkableTaskQuery,
  ): Promise<LinkableTask[]> {
    const rows = await this.db
      .select(accessColumns)
      .from(tasks)
      .where(
        and(
          this.tasks.visibleSql(),
          eq(tasks.clientId, post.clientId),
          isNull(tasks.postId),
          notInArray(tasks.status, NOT_LINKABLE),
          or(isNull(tasks.reviewStage), ne(tasks.reviewStage, 'medical')),
          query.q ? ilike(tasks.title, `%${escapeLike(query.q)}%`) : undefined,
          query.department ? eq(tasks.department, query.department) : undefined,
        ),
      )
      .orderBy(asc(tasks.dueDate), asc(tasks.id));
    const cycles = await this.engagements.cycles(
      rows.flatMap((row) => (row.retainerCycleId ? [row.retainerCycleId] : [])),
    );
    const inPublishCycle = (cycleId: string | null) => {
      const cycle = cycleId ? cycles.get(cycleId) : undefined;
      return (
        !!cycle && cycle.periodStart <= post.publishDate && post.publishDate <= cycle.periodEnd
      );
    };
    // The sort is stable: each group stays by due date.
    const offered = rows
      .map((row) => ({ row, first: inPublishCycle(row.retainerCycleId) }))
      .sort((a, b) => Number(b.first) - Number(a.first))
      .slice(0, POST_LIMITS.linkableTasks);
    const items = await this.tasks.present(
      offered.map(({ row }) => row),
      this.db,
      new Date(),
    );
    return items.map((item, index) => ({ ...item, inPublishCycle: !!offered[index]?.first }));
  }

  /**
   * Rules 6, 7 and 16: links a task of the post's client that is still in production and not
   * linked elsewhere, and turns its own client approval off. Linking a task again changes
   * nothing.
   */
  async link(
    tx: Transaction,
    post: PostRef,
    taskId: string,
    actor: AuditActor,
  ): Promise<LinkedTask> {
    const [task] = await tx
      .select({
        ...linkedColumns,
        clientId: tasks.clientId,
        reviewStage: tasks.reviewStage,
        needsClientApproval: tasks.needsClientApproval,
      })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), this.tasks.visibleSql()))
      .for('update');
    if (!task) throw new NotFoundException();
    const linked: LinkedTask = { ...task, postId: post.id };
    if (task.postId === post.id) return linked;
    if (task.postId) {
      throw new CodedException(409, 'TASK_ALREADY_LINKED', 'The task is linked to another post');
    }
    if (
      task.clientId !== post.clientId ||
      NOT_LINKABLE.includes(task.status) ||
      task.reviewStage === 'medical'
    ) {
      throw new CodedException(
        409,
        'TASK_NOT_LINKABLE',
        'A post links open tasks of its client that are not with the client or the medical reviewer',
      );
    }
    await this.assertRoom(tx, post.id);
    if (post.cycleLineId && task.cycleLineId) throw countedTwice();
    await tx
      .update(tasks)
      .set({ postId: post.id, postLinkedAt: new Date(), needsClientApproval: false })
      .where(eq(tasks.id, taskId));
    await recordAudit(tx, {
      actor,
      action: 'task.updated',
      entityType: 'task',
      entityId: taskId,
      before: {
        postId: null,
        ...(task.needsClientApproval && { needsClientApproval: true }),
      },
      after: {
        postId: post.id,
        ...(task.needsClientApproval && { needsClientApproval: false }),
      },
    });
    // F16 part C: a linked task answers the post's "a task was unlinked" notice.
    await this.notices.resolve(tx, {
      subject: { type: 'post', id: post.id },
      types: ['post_task_unlinked'],
      outcome: 'done',
      actorId: actor.id,
    });
    return linked;
  }

  /** Rule 8: unlinks a task of the post; 404 when it is not linked to it. */
  async unlink(
    tx: Transaction,
    postId: string,
    taskId: string,
    actor: AuditActor,
  ): Promise<LinkedTask> {
    const [task] = (
      await tx
        .select(linkedColumns)
        .from(tasks)
        .where(and(eq(tasks.id, taskId), eq(tasks.postId, postId)))
        .for('update')
    ).flatMap(toLinked);
    if (!task) throw new NotFoundException();
    await clearPostLink(tx, task, actor);
    return task;
  }

  /** Rule 19: a cancelled post gives its tasks back, as they are, for another post. */
  async unlinkAll(tx: Transaction, postId: string, actor: AuditActor): Promise<LinkedTask[]> {
    const linked = await this.lockLinked(tx, postId);
    for (const task of linked) await clearPostLink(tx, task, actor);
    return linked;
  }

  /**
   * Rule 9: an F06 request in a department's queue, linked to the post from the start: no
   * assignee, no client approval of its own, and optionally a line of an open cycle of the
   * client's retainer.
   */
  async create(
    tx: Transaction,
    post: PostRef,
    draft: PostTaskDraft,
    actor: CurrentUserInfo,
  ): Promise<LinkedTask> {
    await this.assertRoom(tx, post.id);
    let retainerCycleId: string | null = null;
    if (draft.cycleLineId) {
      if (post.cycleLineId) throw countedTwice();
      const line = (await this.engagements.cycleLines([draft.cycleLineId], tx)).get(
        draft.cycleLineId,
      );
      if (!line) {
        throw new CodedException(
          400,
          'INVALID_LINK',
          'The line is not of a retainer of this client',
        );
      }
      retainerCycleId = line.cycleId;
    }
    const id = await this.tasks.createIn(
      tx,
      actor,
      createTaskSchema.parse({
        title: draft.title,
        brief: draft.brief,
        department: draft.department,
        dueDate: draft.dueDate,
        clientId: post.clientId,
        retainerCycleId,
        cycleLineId: draft.cycleLineId,
        needsClientApproval: false,
      }),
      { postId: post.id },
    );
    const [task] = (await tx.select(linkedColumns).from(tasks).where(eq(tasks.id, id))).flatMap(
      toLinked,
    );
    if (!task) throw new Error(`Task ${id} was not linked to post ${post.id}`);
    return task;
  }

  /**
   * F08B rule B2: a task of the wizard with its subtasks, stages and files (F06B's create), on
   * the post's client and linked to it from the start. Returns whether a preview waits.
   */
  async createFull(
    tx: Transaction,
    post: PostRef,
    input: CreateTask,
    actor: CurrentUserInfo,
  ): Promise<{ task: LinkedTask; preview: boolean }> {
    await this.assertRoom(tx, post.id);
    if (post.cycleLineId && input.cycleLineId) throw countedTwice();
    const { id, preview } = await this.creation.createIn(
      tx,
      actor,
      { ...input, type: 'work', clientId: post.clientId, needsClientApproval: false },
      { postId: post.id },
    );
    const [task] = (await tx.select(linkedColumns).from(tasks).where(eq(tasks.id, id))).flatMap(
      toLinked,
    );
    if (!task) throw new Error(`Task ${id} was not linked to post ${post.id}`);
    return { task, preview };
  }

  /**
   * F08B rule B9: the due dates a move by `workDays` gives the post's linked tasks that are not
   * approved, delivered or cancelled, and their open subtasks; a subtask stays not after its
   * parent. `lock` locks the rows for the shift.
   */
  async shiftPlan(
    executor: Executor,
    postId: string,
    workDays: number,
    today: CalendarDate,
    holidays: readonly HolidayRange[],
    lock = false,
  ): Promise<ShiftedTask[]> {
    const open = (status: TaskStatus) => !isTaskFinished(status) && status !== 'cancelled';
    const columns = {
      id: tasks.id,
      title: tasks.title,
      parentId: tasks.parentId,
      assigneeId: tasks.assigneeId,
      status: tasks.status,
      dueDate: tasks.dueDate,
    };
    const linkedQuery = executor
      .select(columns)
      .from(tasks)
      .where(and(eq(tasks.postId, postId), this.tasks.visibleSql()))
      .orderBy(asc(tasks.postLinkedAt), asc(tasks.id));
    const parents = (lock ? await linkedQuery.for('update') : await linkedQuery).filter((task) =>
      open(task.status),
    );
    if (parents.length === 0) return [];
    const childQuery = executor
      .select(columns)
      .from(tasks)
      .where(
        and(
          inArray(
            tasks.parentId,
            parents.map((task) => task.id),
          ),
          this.tasks.visibleSql(),
        ),
      )
      .orderBy(asc(tasks.parentId), asc(tasks.position));
    const children = (lock ? await childQuery.for('update') : await childQuery).filter((task) =>
      open(task.status),
    );
    const plan: ShiftedTask[] = [];
    for (const parent of parents) {
      const shifted = shiftDueDate(parent.dueDate, workDays, today, holidays);
      plan.push({ ...parent, newDueDate: shifted.date, clamped: shifted.clamped });
      for (const child of children.filter((task) => task.parentId === parent.id)) {
        const moved = shiftDueDate(child.dueDate, workDays, today, holidays);
        // F06B: a subtask is due no later than its parent.
        const newDueDate = moved.date > shifted.date ? shifted.date : moved.date;
        plan.push({ ...child, newDueDate, clamped: moved.clamped });
      }
    }
    return plan.map(({ id, title, parentId, assigneeId, dueDate, newDueDate, clamped }) => ({
      id,
      title,
      parentId,
      assigneeId,
      dueDate,
      newDueDate,
      clamped,
    }));
  }

  /**
   * F08B rule B9: moves the due dates of the plan in the move's transaction, done by the system
   * for the post whatever the mover's task scope; each audited with reason `post_moved`. The due
   * reminders of each task are voided; its assignee hears of it through the post's `post_moved`.
   */
  async shiftDueDates(
    tx: Transaction,
    postId: string,
    workDays: number,
    actor: AuditActor,
    today: CalendarDate,
    holidays: readonly HolidayRange[],
  ): Promise<ShiftedTask[]> {
    const plan = await this.shiftPlan(tx, postId, workDays, today, holidays, true);
    const moved = plan.filter((task) => task.newDueDate !== task.dueDate);
    const before = await this.notices.loadMany(
      tx,
      moved.map((task) => task.id),
    );
    for (const task of moved) {
      await tx.update(tasks).set({ dueDate: task.newDueDate }).where(eq(tasks.id, task.id));
      await recordAudit(tx, {
        actor,
        action: 'task.updated',
        entityType: 'task',
        entityId: task.id,
        before: { dueDate: task.dueDate },
        after: { dueDate: task.newDueDate, reason: 'post_moved', postId },
      });
    }
    for (const row of before) await this.notices.sendChange(tx, row, actor.id);
    return moved;
  }

  /**
   * Rule 12: sends an approved task of the post back for changes. After the client asked for
   * changes on the post it is a client revision with that response's contact, counted against
   * the task's limit, once per task and response (`ALREADY_RETURNED`); otherwise an internal one.
   */
  async returnForChanges(
    tx: Transaction,
    postId: string,
    taskId: string,
    input: PostTaskReturn,
    actor: CurrentUserInfo,
  ): Promise<LinkedTask> {
    const [linked] = (
      await tx
        .select(linkedColumns)
        .from(tasks)
        .where(and(eq(tasks.id, taskId), eq(tasks.postId, postId), this.tasks.visibleSql()))
        .for('update')
    ).flatMap(toLinked);
    if (!linked) throw new NotFoundException();
    if (linked.status !== 'approved') {
      throw new CodedException(
        409,
        'INVALID_TRANSITION',
        `A ${linked.status} task is not sent back from its post`,
      );
    }
    const { note, response } = input;
    if (response) {
      const [returned] = await tx
        .select({ value: count() })
        .from(taskRevisions)
        .where(
          and(eq(taskRevisions.taskId, taskId), eq(taskRevisions.postResponseId, response.id)),
        );
      if (returned?.value) {
        throw new CodedException(
          409,
          'ALREADY_RETURNED',
          'The task was already sent back for this client response',
        );
      }
    }
    const task = await this.notices.load(tx, taskId);
    await tx.update(tasks).set({ status: 'revisions' }).where(eq(tasks.id, taskId));
    const revision = await this.reviews.recordRevision(
      tx,
      task,
      response ? 'client' : 'internal',
      note,
      response?.contactId ?? null,
      actor.id,
      response?.id ?? null,
    );
    await recordAudit(tx, {
      actor: actorOf(actor),
      action: 'task.status_changed',
      entityType: 'task',
      entityId: taskId,
      before: { status: 'approved' },
      after: {
        status: 'revisions',
        reason: 'post_return',
        postId,
        note,
        revisionSource: revision.source,
        ...(response && { contactId: response.contactId }),
        ...(revision.number && { revisionNumber: revision.number }),
        ...(revision.overLimit && { overLimit: true }),
      },
    });
    const notice = this.notices.notice.bind(this.notices);
    await this.notices.sendChange(tx, task, actor.id, [
      notice(task, 'task_returned', [task.assigneeId], actor.id, {
        source: response ? 'client' : 'internal',
      }),
      ...(revision.overLimit
        ? [notice(task, 'task_over_limit', [task.client?.accountManagerId ?? null], actor.id)]
        : []),
    ]);
    return { ...linked, status: 'revisions' };
  }

  /**
   * Rules 10 and 18: locks the tasks linked to the post and refuses unless every one is approved
   * (`POST_TASKS_NOT_READY`, listing the others).
   */
  async assertApproved(tx: Transaction, postId: string): Promise<LinkedTask[]> {
    const linked = await this.lockLinked(tx, postId);
    const waiting = linked.filter((task) => task.status !== 'approved');
    if (waiting.length > 0) {
      throw new CodedException(
        409,
        'POST_TASKS_NOT_READY',
        'Every linked task must be approved first',
        waiting.map(({ id, title, status }) => ({ id, title, status })),
      );
    }
    return linked;
  }

  /**
   * Rule 18: publishing the post delivers its linked tasks, in the transaction that publishes
   * it, so the unit counts on the task's cycle line now (ADR 0015).
   */
  async deliver(tx: Transaction, postId: string, actor: AuditActor): Promise<void> {
    const linked = await this.assertApproved(tx, postId);
    if (linked.length === 0) return;
    const ids = linked.map((task) => task.id);
    const delivered = await this.notices.loadMany(tx, ids);
    await tx
      .update(tasks)
      .set({ status: 'delivered', deliveredAt: new Date() })
      .where(inArray(tasks.id, ids));
    for (const task of delivered) {
      await recordAudit(tx, {
        actor,
        action: 'task.status_changed',
        entityType: 'task',
        entityId: task.id,
        before: { status: 'approved' },
        after: { status: 'delivered', reason: 'post_published', postId },
      });
    }
    for (const task of delivered) {
      await this.notices.sendChange(tx, task, actor.id, this.notices.delivered(task, actor.id));
    }
  }

  /** The tasks linked to the post, locked by id (the order of every task lock set), by link time. */
  private async lockLinked(tx: Transaction, postId: string): Promise<LinkedTask[]> {
    await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.postId, postId))
      .orderBy(asc(tasks.id))
      .for('update');
    return (await this.linked([postId], tx)).get(postId) ?? [];
  }

  /** Rule 6: at most `POST_LIMITS.tasks` tasks per post. */
  private async assertRoom(tx: Transaction, postId: string): Promise<void> {
    const [linked] = await tx
      .select({ value: count() })
      .from(tasks)
      .where(eq(tasks.postId, postId));
    if ((linked?.value ?? 0) >= POST_LIMITS.tasks) {
      throw new CodedException(
        409,
        'LIMIT_REACHED',
        `A post links at most ${POST_LIMITS.tasks} tasks`,
      );
    }
  }
}

/** Rule 16: a unit counts through a linked task's line or the post's own, never both. */
export const countedTwice = () =>
  new CodedException(
    409,
    'POST_COUNTED_BY_TASK',
    'The post counts through a linked task or on its own line, not both',
  );
