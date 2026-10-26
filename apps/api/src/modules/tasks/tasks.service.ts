import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type AssigneeLeave,
  type AuditAction,
  briefColumns,
  businessDate,
  type CalendarDate,
  type CreateTask,
  departmentBriefFields,
  type Following,
  isTaskFinished,
  isTaskOverdue,
  keepsBriefFields,
  permissionScopes,
  richTextFromPlain,
  SUBTASK_LIMITS,
  type Subtask,
  TASK_LIMITS,
  type Task,
  type TaskBriefFields,
  type TaskDetail,
  type TaskListQuery,
  type TaskPage,
  taskLinkProblem,
  type UpdateTask,
} from '@vertex-hub/contracts';
import {
  type Database,
  type Transaction,
  taskChecklistItems,
  taskComments,
  taskDependencies,
  taskLinks,
  taskRevisions,
  tasks,
} from '@vertex-hub/db';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { changedFields, recordAudit } from '../audit/index.js';
import {
  type CurrentUserInfo,
  lockAccessChanges,
  personRef,
  UserDirectory,
} from '../auth/index.js';
import { ClientDirectory, type ClientSummary } from '../clients/index.js';
import { FileVersions } from '../files/index.js';
import { LeaveDirectory } from '../hr/index.js';
import { type Notice, RecordFollowers } from '../notifications/index.js';
import { EngagementDirectory } from '../projects/index.js';
import { ClientReviewHooks } from './client-review-hooks.js';
import { PostTaskHooks, unlinkRemovedTask } from './post-task-hooks.js';
import { SubtaskRuns } from './subtask-runs.js';
import {
  accessColumns,
  actorOf,
  assertTaskWritable,
  belongsTo,
  dueAfter,
  hasAssignScope,
  hasClientScope,
  holdsAll,
  inClosedProject,
  lockParentOf,
  ownsOpenRequest,
  type ParentRef,
  parentsOf,
  readableTask,
  type TaskAccess,
  type TaskRow,
  taskPermissions,
  taskRights,
} from './task-access.js';
import {
  assertSameClientLinks,
  assertValidDependencies,
  blockedIds,
  blockedSql,
  dependenciesOf,
  dependentsOf,
  lockDependencyGraph,
} from './task-dependencies.js';
import { TaskGuards } from './task-guards.js';
import { blocksDependents, type NoticeTask, TaskNotices, toTimeOfDay } from './task-notices.js';
import { restartQuestionClocks } from './task-questions.js';
import { TaskReviews } from './task-reviews.js';
import {
  clearedByMedicalSql,
  openQuestionsSql,
  overdueSql,
  overLimitPendingSql,
} from './task-sql.js';

type Executor = Database | Transaction;

type Change = { before: Record<string, unknown>; after: Record<string, unknown> };

/** The link fields of a task (rule 7). */
type Links = Pick<
  TaskRow,
  'clientId' | 'projectId' | 'milestoneId' | 'retainerCycleId' | 'cycleLineId'
>;

const LINK_FIELDS = [
  'clientId',
  'projectId',
  'milestoneId',
  'retainerCycleId',
  'cycleLineId',
] as const;

/**
 * What `createIn` writes: a create without the parts F06B creates around the task (stages,
 * subtasks, files, questions, the template run), which `TaskCreation` handles.
 */
export type TaskInsert = Omit<
  CreateTask,
  | 'stages'
  | 'subtasks'
  | 'files'
  | 'questions'
  | 'templateId'
  | 'runMode'
  | 'criteria'
  | 'briefFields'
  | 'estimateMinutes'
> &
  Partial<Pick<CreateTask, 'runMode' | 'criteria' | 'briefFields' | 'estimateMinutes'>>;

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** Tasks of every department (spec F06): list, detail, create, edit, archive and restore. */
@Injectable()
export class TasksService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
    private readonly engagements: EngagementDirectory,
    private readonly notices: TaskNotices,
    private readonly files: FileVersions,
    private readonly reviews: TaskReviews,
    private readonly reviewHooks: ClientReviewHooks,
    private readonly postHooks: PostTaskHooks,
    private readonly guards: TaskGuards,
    private readonly followers: RecordFollowers,
    private readonly leave: LeaveDirectory,
    private readonly runs: SubtaskRuns,
  ) {}

  /** F16 rule B12: whether the actor follows a task they may read. */
  async following(actor: CurrentUserInfo, id: string): Promise<Following> {
    await readableTask(this.db, this.directories, actor, id);
    return this.followers.following({ type: 'task', id }, actor.id);
  }

  /** F16 rule B12: anyone who may read the task follows or unfollows it by hand. */
  async setFollowing(actor: CurrentUserInfo, id: string, following: boolean): Promise<Following> {
    await readableTask(this.db, this.directories, actor, id);
    return this.followers.setFollowing({ type: 'task', id }, actor.id, following);
  }

  private get directories() {
    return { clients: this.clients, engagements: this.engagements };
  }

  async list(actor: CurrentUserInfo, query: TaskListQuery): Promise<TaskPage> {
    if (query.archived && !holdsAll(actor, 'tasks.manage')) throw new ForbiddenException();
    const now = new Date();
    const filters: (SQL | undefined)[] = [
      holdsAll(actor, 'tasks.read') ? undefined : sql`false`,
      query.archived ? isNotNull(tasks.archivedAt) : this.visibleSql(),
      inArray(tasks.status, query.status),
    ];
    if (query.search) filters.push(ilike(tasks.title, `%${escapeLike(query.search)}%`));
    if (query.department) filters.push(inArray(tasks.department, query.department));
    if (query.assigneeId) {
      filters.push(eq(tasks.assigneeId, query.assigneeId === 'me' ? actor.id : query.assigneeId));
    }
    if (query.unassigned !== undefined) {
      filters.push(query.unassigned ? isNull(tasks.assigneeId) : isNotNull(tasks.assigneeId));
    }
    if (query.clientId) filters.push(eq(tasks.clientId, query.clientId));
    if (query.internal !== undefined) {
      filters.push(query.internal ? isNull(tasks.clientId) : isNotNull(tasks.clientId));
    }
    if (query.projectId) filters.push(eq(tasks.projectId, query.projectId));
    if (query.milestoneId) filters.push(eq(tasks.milestoneId, query.milestoneId));
    if (query.retainerId) {
      filters.push(this.engagements.cycleOf(tasks.retainerCycleId, query.retainerId));
    }
    if (query.cycleLineId) filters.push(eq(tasks.cycleLineId, query.cycleLineId));
    if (query.type) filters.push(eq(tasks.type, query.type));
    if (query.priority) filters.push(inArray(tasks.priority, query.priority));
    if (query.overdue !== undefined) {
      filters.push(query.overdue ? overdueSql(now) : sql`not ${overdueSql(now)}`);
    }
    if (query.blocked !== undefined) {
      filters.push(query.blocked ? blockedSql : sql`not ${blockedSql}`);
    }
    if (query.overLimit !== undefined) {
      filters.push(query.overLimit ? overLimitPendingSql : sql`not ${overLimitPendingSql}`);
    }
    if (query.linkedToPost !== undefined) {
      filters.push(query.linkedToPost ? isNotNull(tasks.postId) : isNull(tasks.postId));
    }
    if (query.dueFrom) filters.push(gte(tasks.dueDate, query.dueFrom));
    if (query.dueTo) filters.push(lte(tasks.dueDate, query.dueTo));
    if (query.createdBy === 'me') filters.push(eq(tasks.createdById, actor.id));
    if (query.reviewer === 'me') filters.push(this.reviewScopeSql(actor));
    if (query.reviewStage) filters.push(eq(tasks.reviewStage, query.reviewStage));
    if (query.parentId) filters.push(eq(tasks.parentId, query.parentId));
    if (query.topLevel !== undefined) {
      filters.push(query.topLevel ? isNull(tasks.parentId) : isNotNull(tasks.parentId));
    }
    if (query.hasOpenQuestions !== undefined) {
      filters.push(query.hasOpenQuestions ? openQuestionsSql : sql`not ${openQuestionsSql}`);
    }
    const where = and(...filters);

    const sortColumn = {
      dueDate: tasks.dueDate,
      priority: tasks.priority,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
    }[query.sort];
    const order = query.order === 'desc' ? desc : asc;
    const [rows, [total]] = await Promise.all([
      this.db
        .select(accessColumns)
        .from(tasks)
        .where(where)
        .orderBy(order(sortColumn), asc(tasks.dueTime), asc(tasks.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ value: count() }).from(tasks).where(where),
    ]);
    return {
      items: await this.present(rows, this.db, now),
      total: total?.value ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async detail(actor: CurrentUserInfo, id: string): Promise<TaskDetail> {
    const task = await readableTask(this.db, this.directories, actor, id);
    const now = new Date();
    const [
      [item],
      dependencies,
      dependents,
      checklist,
      links,
      revisions,
      extras,
      fileCounts,
      review,
      pending,
      stages,
      subtasks,
    ] = await Promise.all([
      this.present([task], this.db, now),
      dependenciesOf(id, this.db),
      dependentsOf(id, this.db),
      this.db
        .select()
        .from(taskChecklistItems)
        .where(and(eq(taskChecklistItems.taskId, id), isNull(taskChecklistItems.archivedAt)))
        .orderBy(asc(taskChecklistItems.kind), asc(taskChecklistItems.position)),
      this.db
        .select()
        .from(taskLinks)
        .where(and(eq(taskLinks.taskId, id), isNull(taskLinks.archivedAt)))
        .orderBy(asc(taskLinks.createdAt), asc(taskLinks.id)),
      this.db
        .select()
        .from(taskRevisions)
        .where(eq(taskRevisions.taskId, id))
        .orderBy(asc(taskRevisions.createdAt), asc(taskRevisions.id)),
      this.db
        .select({
          briefDoc: tasks.briefDoc,
          briefFields: tasks.briefFields,
          createdAt: tasks.createdAt,
          updatedAt: tasks.updatedAt,
          deliveredAt: tasks.deliveredAt,
          cancelledAt: tasks.cancelledAt,
          cancelReason: tasks.cancelReason,
        })
        .from(tasks)
        .where(eq(tasks.id, id)),
      this.files.taskFileCounts(id, this.db),
      this.reviews.detail(task),
      this.reviewHooks.pending([id], this.db),
      task.parentId ? [] : this.runs.stages(this.db, id),
      task.parentId ? [] : this.subtaskItems(this.db, id, now),
    ]);
    const pendingApproval = pending.get(id) ?? null;
    const row = extras[0];
    if (!item || !row) throw new NotFoundException();
    const [people, contacts, extraWork] = await Promise.all([
      this.users.summaries([
        ...(task.createdById ? [task.createdById] : []),
        ...checklist.flatMap((i) => (i.doneById ? [i.doneById] : [])),
        ...links.map((l) => l.addedById),
        ...revisions.flatMap((r) => [
          ...(r.authorId ? [r.authorId] : []),
          ...(r.decidedById ? [r.decidedById] : []),
        ]),
      ]),
      this.clients.contactSummaries([
        ...(task.requestedByContactId ? [task.requestedByContactId] : []),
        ...revisions.flatMap((r) => (r.contactId ? [r.contactId] : [])),
      ]),
      this.engagements.extraWork([
        ...(task.extraWorkItemId ? [task.extraWorkItemId] : []),
        ...revisions.flatMap((r) => (r.extraWorkItemId ? [r.extraWorkItemId] : [])),
      ]),
    ]);
    const person = (userId: string) => personRef(people, userId);
    const requestExtra = task.extraWorkItemId ? extraWork.get(task.extraWorkItemId) : undefined;
    const checklistItem = (i: (typeof checklist)[number]) => ({
      id: i.id,
      text: i.text,
      position: i.position,
      done: !!i.doneAt,
      doneAt: i.doneAt?.toISOString() ?? null,
      doneBy: i.doneById ? person(i.doneById) : null,
    });
    return {
      ...item,
      brief: task.brief,
      // A brief written by the previous release has no document yet (expand only).
      briefDoc:
        (row.briefDoc as TaskDetail['briefDoc']) ??
        (task.brief ? richTextFromPlain(task.brief) : null),
      briefFields: (row.briefFields as TaskBriefFields | null) ?? null,
      needsClientApproval: task.needsClientApproval,
      clientRequest:
        task.type === 'client_request' && task.requestedOn && task.requestScope
          ? {
              contact: task.requestedByContactId
                ? (contacts.get(task.requestedByContactId) ?? null)
                : null,
              requestedOn: task.requestedOn,
              scope: task.requestScope,
              extraWork: requestExtra
                ? {
                    id: requestExtra.id,
                    title: requestExtra.title,
                    billingStatus: requestExtra.billingStatus,
                  }
                : null,
            }
          : null,
      dependencies,
      dependents,
      checklistItems: checklist.filter((i) => i.kind === 'checklist').map(checklistItem),
      criteria: checklist.filter((i) => i.kind === 'criterion').map(checklistItem),
      links: links.map((l) => ({
        id: l.id,
        url: l.url,
        label: l.label,
        addedBy: person(l.addedById),
        createdAt: l.createdAt.toISOString(),
      })),
      fileCounts,
      ...review,
      pendingApproval: pendingApproval && {
        requestId: pendingApproval.requestId,
        state: pendingApproval.state,
        issuedAt: pendingApproval.issuedAt.toISOString(),
        expiresAt: pendingApproval.expiresAt.toISOString(),
      },
      revisionHistory: revisions.map((r) => {
        const extra = r.extraWorkItemId ? extraWork.get(r.extraWorkItemId) : undefined;
        return {
          id: r.id,
          source: r.source,
          number: r.number,
          note: r.note,
          contact: r.contactId ? (contacts.get(r.contactId) ?? null) : null,
          overLimit: r.overLimit,
          decision: r.decision,
          decisionNote: r.decisionNote,
          extraWork: extra ? { id: extra.id, title: extra.title } : null,
          decidedBy: r.decidedById ? person(r.decidedById) : null,
          decidedAt: r.decidedAt?.toISOString() ?? null,
          author: r.authorId ? person(r.authorId) : null,
          createdAt: r.createdAt.toISOString(),
        };
      }),
      parent: task.parent
        ? { id: task.parent.id, title: task.parent.title, status: task.parent.status }
        : null,
      runMode: task.runMode,
      stages,
      subtasks,
      handoverNote: task.handoverNote,
      createdBy: task.createdById ? person(task.createdById) : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      startedAt: task.startedAt?.toISOString() ?? null,
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      cancelReason: row.cancelReason,
      archivedAt: task.archivedAt?.toISOString() ?? null,
      readOnly: item.readOnly,
      ...taskPermissions(actor, task, item.blocked, {
        // An expired link does not hold the task back (F09 rule 8).
        waiting: pendingApproval?.state === 'open',
        clearedStage: review.clearedReview?.stage ?? null,
      }),
    };
  }

  /**
   * Creates the task in the caller's transaction and returns its id. `postId` links it from the
   * start to the post it was requested from (F08 rule 9, through `PostTasks`). `onBehalf` creates
   * it for the system without checking the caller's assign scope: the caller checked who may be
   * the assignee (F11 rules 3 and 12, through `ShootTasks`). `inheritsLinks` takes the links as
   * copied from an existing task, so a closed cycle or a done milestone is kept (F11 edge case 6).
   * `checkLeave` warns of the assignee's leave on the due date (F17 rule B17); template runs and
   * automatic assignments leave it out. `parent` creates a subtask (F06B), followed by the
   * parent's assignee (F16 rule B12).
   */
  async createIn(
    tx: Transaction,
    actor: CurrentUserInfo,
    input: TaskInsert,
    options: {
      postId?: string;
      onBehalf?: boolean;
      inheritsLinks?: boolean;
      checkLeave?: boolean;
      /** F06B rule A2: a subtask of this parent, at this place; the caller checked the parent. */
      parent?: {
        id: string;
        position: number;
        stageId: string | null;
        assigneeId: string | null;
      };
    } = {},
  ): Promise<string> {
    const postId = options.postId ?? null;
    // Serialized with archiving users: an assignee must stay active (F01 change).
    if (input.assigneeId) await lockAccessChanges(tx);
    const client = input.clientId
      ? await this.clients.summary(input.clientId, tx, { forUpdate: true })
      : null;
    if (input.clientId && !client) throw new NotFoundException();

    // Who may create what (actions table).
    const selfAssigned = input.assigneeId === actor.id && belongsTo(actor, input.department);
    if (
      input.assigneeId &&
      !selfAssigned &&
      !options.onBehalf &&
      !hasAssignScope(actor, { ...input, client })
    ) {
      throw new ForbiddenException();
    }
    if (input.type === 'client_request' && !hasClientScope(actor, client)) {
      throw new ForbiddenException();
    }

    await this.assertLinks(tx, input, client, options.inheritsLinks ? pickLinks(input) : {});
    if (input.assigneeId) await this.assertAssignee(tx, input.assigneeId, input.department);
    const acceptedLeave =
      options.checkLeave && input.assigneeId
        ? await this.checkLeave(tx, input.assigneeId, input.dueDate, input.acceptLeave)
        : [];
    if (input.dueDate < businessDate()) {
      throw new CodedException(400, 'INVALID_DATES', 'The due date is in the past');
    }
    const criteria = input.criteria ?? [];
    if (
      input.checklist.length > TASK_LIMITS.checklist ||
      input.links.length > TASK_LIMITS.links ||
      criteria.length > TASK_LIMITS.criteria
    ) {
      throw new CodedException(409, 'LIMIT_REACHED', 'Too many checklist items, criteria or links');
    }
    const briefFields = departmentBriefFields(input.department, input.briefFields);
    if ('problem' in briefFields) {
      throw new BadRequestException('The brief fields do not belong to the department');
    }
    const dependsOn = await assertValidDependencies(
      tx,
      { id: null, clientId: input.clientId },
      input.dependsOn,
    );
    const request =
      input.type === 'client_request'
        ? {
            requestedByContactId: input.requestedByContactId ?? null,
            requestedOn: input.requestedOn ?? businessDate(),
            requestScope: input.requestScope ?? ('in_scope' as const),
          }
        : { requestedByContactId: null, requestedOn: null, requestScope: null };
    if (request.requestedOn && request.requestedOn > businessDate()) {
      throw new CodedException(400, 'INVALID_DATES', 'The request date is in the future');
    }
    if (client && request.requestedByContactId) {
      await this.assertContact(tx, client.id, request.requestedByContactId);
    }

    const brief = briefColumns(input) ?? { brief: null, briefDoc: null };
    const values = {
      title: input.title,
      brief: brief.brief,
      type: input.type,
      department: input.department,
      assigneeId: input.assigneeId,
      priority: input.priority,
      dueDate: input.dueDate,
      dueTime: input.dueTime ?? null,
      clientId: input.clientId,
      projectId: input.projectId,
      milestoneId: input.milestoneId,
      retainerCycleId: input.retainerCycleId,
      cycleLineId: input.cycleLineId,
      needsClientApproval: input.needsClientApproval,
      revisionLimit: input.revisionLimit,
      ...request,
      ...(briefFields.value && { briefFields: briefFields.value }),
      ...(input.estimateMinutes && { estimateMinutes: input.estimateMinutes }),
      ...(input.runMode && { runMode: input.runMode }),
    };
    const subtask = options.parent
      ? {
          parentId: options.parent.id,
          position: options.parent.position,
          stageId: options.parent.stageId,
        }
      : null;
    const [created] = await tx
      .insert(tasks)
      .values({
        ...values,
        briefDoc: brief.briefDoc,
        ...subtask,
        createdById: actor.id,
        ...(postId && { postId, postLinkedAt: new Date() }),
      })
      .returning({ id: tasks.id });
    if (!created) throw new Error('Task insert returned no row');

    let extraWorkItemId: string | null = null;
    if (request.requestScope === 'out_of_scope') {
      extraWorkItemId = await this.createRequestExtraWork(tx, actor, { ...values, ...request });
      await tx.update(tasks).set({ extraWorkItemId }).where(eq(tasks.id, created.id));
    }
    if (input.checklist.length > 0) {
      await tx.insert(taskChecklistItems).values(
        input.checklist.map((text, index) => ({
          taskId: created.id,
          text,
          position: index + 1,
        })),
      );
    }
    if (criteria.length > 0) {
      await tx.insert(taskChecklistItems).values(
        criteria.map((text, index) => ({
          taskId: created.id,
          kind: 'criterion' as const,
          text,
          position: index + 1,
        })),
      );
    }
    if (input.links.length > 0) {
      await tx.insert(taskLinks).values(
        input.links.map((link) => ({
          taskId: created.id,
          url: link.url,
          label: link.label ?? null,
          addedById: actor.id,
        })),
      );
    }
    if (dependsOn.length > 0) {
      await tx.insert(taskDependencies).values(
        dependsOn.map((dependency) => ({
          taskId: created.id,
          dependsOnId: dependency.id,
          createdById: actor.id,
        })),
      );
    }
    await recordAudit(tx, {
      actor: actorOf(actor),
      action: 'task.created',
      entityType: 'task',
      entityId: created.id,
      after: {
        ...values,
        ...subtask,
        ...(postId && { postId }),
        ...(extraWorkItemId && { extraWorkItemId }),
        ...(dependsOn.length > 0 && { dependsOn }),
        ...(input.checklist.length > 0 && { checklist: input.checklist }),
        ...(criteria.length > 0 && { criteria }),
        // Links may carry share tokens: the audit keeps the label and the site only.
        ...(input.links.length > 0 && {
          links: input.links.map((link) => ({
            label: link.label ?? null,
            site: new URL(link.url).host,
          })),
        }),
      },
    });
    if (input.assigneeId && acceptedLeave.length > 0) {
      await this.auditAcceptedLeave(
        tx,
        actor,
        created.id,
        input.assigneeId,
        input.dueDate,
        acceptedLeave,
      );
    }
    const task = await this.notices.load(tx, created.id);
    await this.notices.send(tx, [
      input.assigneeId
        ? this.notices.notice(task, 'task_assigned', [input.assigneeId], actor.id)
        : this.notices.notice(
            task,
            'task_requested',
            await this.notices.managers(tx, input.department),
            actor.id,
          ),
    ]);
    // F16 rule B12: the creator and the assignee follow the task, and the parent's assignee each
    // of its subtasks (F06B).
    await this.notices.follow(tx, created.id, [
      actor.id,
      input.assigneeId ?? null,
      options.parent?.assigneeId ?? null,
    ]);
    return created.id;
  }

  async update(actor: CurrentUserInfo, id: string, input: UpdateTask): Promise<TaskDetail> {
    await this.db.transaction(async (tx) => {
      const movesPeople = input.assigneeId !== undefined || input.department !== undefined;
      if (movesPeople) await lockAccessChanges(tx);
      // A new client for a linked task changes the dependency graph's rule (same client only).
      if (input.clientId !== undefined) await lockDependencyGraph(tx);
      // F06B rule A5: a subtask's dates are checked against its parent's, under its lock.
      await lockParentOf(tx, id);
      const task = await readableTask(tx, this.directories, actor, id, { forUpdate: true });
      const rights = taskRights(actor, task);
      if (!rights.manage && !ownsOpenRequest(rights, task)) throw new ForbiddenException();
      assertTaskWritable(task);

      const department = input.department ?? task.department;
      const assigneeGiven = input.assigneeId !== undefined && input.assigneeId !== task.assigneeId;
      const departmentGiven = department !== task.department;
      if ((assigneeGiven || departmentGiven) && !rights.assign) throw new ForbiddenException();
      // F11 rule 9: a scheduled shoot keeps its task in Photography.
      if (departmentGiven) await this.guards.assertFree(tx, [id]);
      const scopeGiven =
        input.requestScope !== undefined && input.requestScope !== task.requestScope;
      if (scopeGiven && !rights.client) throw new ForbiddenException();
      const requestFields =
        input.requestScope !== undefined ||
        input.requestedOn !== undefined ||
        input.requestedByContactId !== undefined;
      if (requestFields && task.type !== 'client_request') {
        throw new BadRequestException('Request fields belong to client requests only');
      }

      // F06B rule A1: a subtask takes its links from its parent and never goes to the client.
      if (
        task.parentId &&
        (LINK_FIELDS.some((field) => input[field] !== undefined && input[field] !== task[field]) ||
          input.needsClientApproval)
      ) {
        throw new CodedException(
          400,
          'INVALID_LINK',
          'A subtask takes its client and engagement from its parent, without client approval',
        );
      }
      // Rule A5: a subtask is due no later than its parent.
      const due = {
        dueDate: input.dueDate ?? task.dueDate,
        dueTime: input.dueTime !== undefined ? input.dueTime : task.dueTime,
      };
      if (task.parent && dueAfter(due, task.parent)) {
        throw new CodedException(400, 'INVALID_DATES', 'A subtask is due no later than its parent');
      }
      const lateSubtasks =
        !task.parentId && (input.dueDate !== undefined || input.dueTime !== undefined)
          ? (await this.runs.subtasksOf(tx, id)).filter(
              (subtask) =>
                !subtask.archivedAt &&
                subtask.status !== 'delivered' &&
                subtask.status !== 'cancelled' &&
                dueAfter(subtask, due),
            )
          : [];
      if (lateSubtasks.length > 0 && !input.moveSubtasks) {
        throw new CodedException(
          409,
          'SUBTASK_DUE_AFTER_PARENT',
          'Subtasks are due after the new date: move them with the parent or re-date them first',
          lateSubtasks.map((subtask) => ({
            id: subtask.id,
            title: subtask.title,
            dueDate: subtask.dueDate,
          })),
        );
      }

      // Links: the stored ones merged with the update (rule 7).
      const links: Links = {
        clientId: input.clientId !== undefined ? input.clientId : task.clientId,
        projectId: input.projectId !== undefined ? input.projectId : task.projectId,
        milestoneId: input.milestoneId !== undefined ? input.milestoneId : task.milestoneId,
        retainerCycleId:
          input.retainerCycleId !== undefined ? input.retainerCycleId : task.retainerCycleId,
        cycleLineId: input.cycleLineId !== undefined ? input.cycleLineId : task.cycleLineId,
      };
      const linksChange = changedFields(pickLinks(task), links);
      // F08 rule 7 and edge case 7: a linked task stays with its post's client, and the client
      // approves the post, never the task.
      // F08 rule 16: a new cycle line could count the unit beside the post's own line, which
      // only linking checks.
      const countsAnew = !!links.cycleLineId && links.cycleLineId !== task.cycleLineId;
      if (
        task.postId &&
        (links.clientId !== task.clientId || input.needsClientApproval || countsAnew)
      ) {
        throw new CodedException(
          409,
          'LINKED_TO_POST',
          'The task is linked to a post: unlink it to change its client, its client approval or its cycle line',
        );
      }
      let client = task.client;
      if (linksChange) {
        if (taskLinkProblem(links) || (task.type === 'client_request' && !links.clientId)) {
          throw new CodedException(400, 'INVALID_LINK', 'The task links do not match');
        }
        if (links.clientId !== task.clientId) {
          client = links.clientId
            ? await this.clients.summary(links.clientId, tx, { forUpdate: true })
            : null;
          if (links.clientId && !client) throw new NotFoundException();
        }
        await this.assertLinks(tx, links, client, pickLinks(task));
        if (links.clientId !== task.clientId) {
          // F06B rule A1: the subtasks move with their parent.
          const subtaskIds = (await this.runs.subtasksOf(tx, id)).map((subtask) => subtask.id);
          await assertSameClientLinks(tx, [id, ...subtaskIds], links.clientId);
        }
      }
      // Assigning needs assign scope over the task as it will be, not only as it is.
      if (assigneeGiven && input.assigneeId && !hasAssignScope(actor, { department, client })) {
        throw new ForbiddenException();
      }

      // Rule 8: forced false without a client; set on when a client is added.
      const needsClientApproval = !links.clientId
        ? false
        : (input.needsClientApproval ?? (task.clientId ? task.needsClientApproval : true));
      if (task.status === 'awaiting_client' && !needsClientApproval) {
        throw new CodedException(
          409,
          'INVALID_TRANSITION',
          'Record the client response before turning client approval off',
        );
      }
      // F09 rule 4: the medical stage exists for the client's approval.
      if (task.reviewStage === 'medical' && !needsClientApproval) {
        throw new CodedException(
          409,
          'INVALID_TRANSITION',
          'Client approval stays on during the medical review',
        );
      }
      // F09 rule 17: a task with a pending approval item stays with its client.
      if (links.clientId !== task.clientId && (await this.reviewHooks.pending([id], tx)).has(id)) {
        throw new CodedException(
          409,
          'SENT_TO_CLIENT',
          'The task is in an approval link: withdraw it or revoke the link first',
        );
      }

      // Rule 6: the assignee belongs to the department; moving keeps them only if they do.
      let assigneeId = input.assigneeId !== undefined ? input.assigneeId : task.assigneeId;
      if (assigneeId && (assigneeGiven || departmentGiven)) {
        const member = await this.users.activeMember(assigneeId, department, tx);
        if (!member) {
          if (assigneeGiven) {
            throw new CodedException(
              400,
              'INVALID_ASSIGNEE',
              'The assignee must be an active member of the department',
            );
          }
          assigneeId = null;
        }
      }

      // Request fields reach here for client requests only (checked above).
      if (input.requestedOn && input.requestedOn > businessDate()) {
        throw new CodedException(400, 'INVALID_DATES', 'The request date is in the future');
      }
      const contactId =
        input.requestedByContactId !== undefined
          ? input.requestedByContactId
          : task.requestedByContactId;
      if (contactId && links.clientId && (input.requestedByContactId || linksChange)) {
        await this.assertContact(tx, links.clientId, contactId);
      }

      const brief = briefColumns(input);
      // Rule C7: the fields follow the department's kind; another kind clears them.
      const storedFields = await this.storedBriefFields(tx, id);
      const briefFields =
        input.briefFields !== undefined
          ? departmentBriefFields(department, input.briefFields)
          : departmentGiven && !keepsBriefFields(task.department, department)
            ? { value: null }
            : { value: storedFields };
      if ('problem' in briefFields) {
        throw new BadRequestException('The brief fields do not belong to the department');
      }
      const basics = changedFields(
        {
          title: task.title,
          brief: task.brief,
          // Rule C1: a new document with the same plain text (a bold word) is an edit too.
          briefDoc: brief ? await this.storedBriefDoc(tx, id) : undefined,
          priority: task.priority,
          dueDate: task.dueDate,
          dueTime: toTimeOfDay(task.dueTime),
          needsClientApproval: task.needsClientApproval,
          revisionLimit: task.revisionLimit,
          requestedOn: task.requestedOn,
          requestedByContactId: task.requestedByContactId,
          briefFields: storedFields,
          estimateMinutes: task.estimateMinutes,
          ...pickLinks(task),
        },
        {
          title: input.title,
          brief: brief?.brief,
          briefDoc: brief?.briefDoc,
          priority: input.priority,
          dueDate: input.dueDate,
          dueTime: input.dueTime,
          needsClientApproval,
          revisionLimit: input.revisionLimit,
          requestedOn: input.requestedOn,
          requestedByContactId: input.requestedByContactId,
          briefFields: briefFields.value,
          estimateMinutes: input.estimateMinutes,
          ...links,
        },
      );
      const assigneeChange = assigneeId !== task.assigneeId;
      const departmentChange = department !== task.department;
      // F17 rule B17: a new assignee or due date on the assignee's approved leave.
      const dueDate = input.dueDate ?? task.dueDate;
      const acceptedLeave =
        assigneeId && (assigneeChange || dueDate !== task.dueDate)
          ? await this.checkLeave(tx, assigneeId, dueDate, input.acceptLeave)
          : [];
      if (!basics && !assigneeChange && !departmentChange && !scopeGiven) return;

      let extraWorkItemId = task.extraWorkItemId;
      if (scopeGiven && input.requestScope === 'out_of_scope') {
        extraWorkItemId = await this.createRequestExtraWork(tx, actor, {
          ...task,
          ...basics?.after,
          ...links,
        });
      }
      if (scopeGiven && input.requestScope === 'in_scope' && task.extraWorkItemId) {
        await this.engagements.archiveExtraWork(tx, task.extraWorkItemId, actorOf(actor));
        extraWorkItemId = null;
      }
      // Rule 11: an out-of-scope request keeps an engagement, and its extra work follows it to
      // another project or retainer while unbilled (`EXTRA_WORK_BILLED` once billed or waived).
      let extraWorkMoved = false;
      if (!scopeGiven && task.requestScope === 'out_of_scope' && linksChange) {
        const owner = await this.engagementOf(tx, links);
        const previous = await this.engagementOf(tx, pickLinks(task));
        if (owner.kind !== previous.kind || owner.id !== previous.id) {
          if (task.extraWorkItemId) {
            await this.engagements.archiveExtraWork(tx, task.extraWorkItemId, actorOf(actor));
          }
          extraWorkItemId = await this.createRequestExtraWork(tx, actor, {
            ...task,
            ...basics?.after,
            ...links,
          });
          extraWorkMoved = true;
        }
      }

      await tx
        .update(tasks)
        .set({
          ...basics?.after,
          department,
          assigneeId,
          ...(scopeGiven && { requestScope: input.requestScope }),
          ...((scopeGiven || extraWorkMoved) && { extraWorkItemId }),
        })
        .where(eq(tasks.id, id));
      // F10 rule 4: the task's files follow its client.
      if (links.clientId !== task.clientId) {
        await this.files.moveTaskClient(tx, id, links.clientId);
      }

      const audit = async (action: AuditAction, change: Change | null) => {
        if (!change) return;
        await recordAudit(tx, {
          actor: actorOf(actor),
          action,
          entityType: 'task',
          entityId: id,
          ...change,
        });
      };
      await audit('task.updated', basics);
      if (departmentChange) {
        await audit('task.department_changed', {
          before: { department: task.department },
          after: { department },
        });
      }
      if (assigneeChange) {
        const people = await this.users.summaries(
          [task.assigneeId, assigneeId].filter((userId): userId is string => !!userId),
          tx,
        );
        // The audit names the people; their photos are not part of the change.
        const who = (userId: string | null) =>
          userId ? { id: userId, name: people.get(userId)?.name ?? '' } : null;
        await audit('task.assigned', {
          before: { assignee: who(task.assigneeId) },
          after: { assignee: who(assigneeId) },
        });
      }
      if (scopeGiven) {
        await audit('task.request_scope_changed', {
          before: { requestScope: task.requestScope, extraWorkItemId: task.extraWorkItemId },
          after: { requestScope: input.requestScope, extraWorkItemId },
        });
      }
      if (extraWorkMoved) {
        await audit('task.extra_work_moved', {
          before: { extraWorkItemId: task.extraWorkItemId },
          after: { extraWorkItemId },
        });
      }
      if (assigneeId && acceptedLeave.length > 0) {
        await this.auditAcceptedLeave(tx, actor, id, assigneeId, dueDate, acceptedLeave);
      }
      await this.notifyUpdate(tx, actor, task, basics);
      if (linksChange) await this.moveSubtaskLinks(tx, actor, id, links);
      for (const subtask of lateSubtasks) {
        await this.moveSubtaskDue(tx, actor, subtask.id, due);
      }
    });
    return this.detail(actor, id);
  }

  /** F06B rule A1: the parent's client and engagement, and their files' client, follow it. */
  private async moveSubtaskLinks(
    tx: Transaction,
    actor: CurrentUserInfo,
    parentId: string,
    links: Links,
  ): Promise<void> {
    const subtasks = await tx
      .select(accessColumns)
      .from(tasks)
      .where(eq(tasks.parentId, parentId))
      .orderBy(asc(tasks.id))
      .for('update');
    const moved = { ...links, milestoneId: null, cycleLineId: null };
    for (const subtask of subtasks) {
      const change = changedFields(pickLinks(subtask), moved);
      if (!change) continue;
      await tx.update(tasks).set(moved).where(eq(tasks.id, subtask.id));
      if (subtask.clientId !== moved.clientId) {
        await this.files.moveTaskClient(tx, subtask.id, moved.clientId);
      }
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'task.updated',
        entityType: 'task',
        entityId: subtask.id,
        before: change.before,
        after: { ...change.after, parentId },
      });
    }
  }

  /** F06B rule A5: a subtask brought to its parent's new due date (`moveSubtasks`). */
  private async moveSubtaskDue(
    tx: Transaction,
    actor: CurrentUserInfo,
    subtaskId: string,
    due: { dueDate: CalendarDate; dueTime: string | null },
  ): Promise<void> {
    const [before] = await tx
      .select(accessColumns)
      .from(tasks)
      .where(eq(tasks.id, subtaskId))
      .for('update');
    if (!before) return;
    const dueTime = toTimeOfDay(due.dueTime);
    await tx.update(tasks).set({ dueDate: due.dueDate, dueTime }).where(eq(tasks.id, subtaskId));
    const change = changedFields(
      { dueDate: before.dueDate, dueTime: toTimeOfDay(before.dueTime) },
      { dueDate: due.dueDate, dueTime },
    );
    if (change) {
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'task.updated',
        entityType: 'task',
        entityId: subtaskId,
        before: change.before,
        after: { ...change.after, parentId: before.parentId },
      });
    }
    const after = await this.notices.load(tx, subtaskId);
    await this.notices.sendChange(tx, before, actor.id, [
      this.notices.notice(after, 'task_changed', [after.assigneeId], actor.id, {
        change: 'due',
        from: { dueDate: before.dueDate, dueTime: toTimeOfDay(before.dueTime) },
        to: { dueDate: after.dueDate, dueTime },
      }),
    ]);
  }

  async archive(actor: CurrentUserInfo, id: string): Promise<TaskDetail> {
    if (!holdsAll(actor, 'tasks.manage')) throw new ForbiddenException();
    await this.db.transaction(async (tx) => {
      // Archiving a subtask rewrites its parent's run (F06B rule A3).
      await lockDependencyGraph(tx);
      await lockParentOf(tx, id);
      const task = await readableTask(tx, this.directories, actor, id, { forUpdate: true });
      if (task.archivedAt) {
        throw new CodedException(409, 'TASK_ARCHIVED', 'The task is already archived');
      }
      // Edge case 3: the subtask it held opens; compare with the run before it left.
      const blockedBefore = task.parentId
        ? await this.runs.blockedNow(tx, task.parentId)
        : undefined;
      // F06B rule A11: a parent's subtasks are archived with it, at the same instant, so restore
      // knows which to bring back.
      const subtasks = task.parentId
        ? []
        : await tx
            .select(accessColumns)
            .from(tasks)
            .where(and(eq(tasks.parentId, id), isNull(tasks.archivedAt)))
            .orderBy(asc(tasks.id))
            .for('update');
      const ids = [id, ...subtasks.map((subtask) => subtask.id)];
      // F11 rule 9: a scheduled shoot holds its task.
      await this.guards.assertFree(tx, ids);
      await tx.update(tasks).set({ archivedAt: new Date() }).where(inArray(tasks.id, ids));
      for (const archivedId of ids) {
        await this.auditArchive(tx, actor, 'task.archived', archivedId, true);
      }
      // F09 rule 17: an archived task is no longer with the client.
      if (task.status === 'awaiting_client') {
        await this.reviewHooks.left(tx, { taskId: id, actor: actorOf(actor), response: null });
      }
      // F08 rule 8: an archived task leaves its post.
      await unlinkRemovedTask(tx, this.postHooks, task, 'archived', actorOf(actor));
      if (task.parentId) {
        await this.runs.compact(tx, task.parentId);
        await this.runs.sync(tx, task.parentId, actor.id, blockedBefore);
      }
      const archivedNotice = (archived: NoticeTask) =>
        this.notices.notice(archived, 'task_changed', [archived.assigneeId], actor.id, {
          change: 'archived',
          from: null,
          to: null,
        });
      for (const subtask of subtasks) {
        await this.notices.sendChange(tx, subtask, actor.id, [
          archivedNotice(await this.notices.load(tx, subtask.id)),
        ]);
      }
      const blocking = [task, ...subtasks].filter(blocksDependents).map((t) => t.id);
      await this.notices.sendChange(tx, task, actor.id, [
        archivedNotice(task),
        ...(blocking.length > 0 ? await this.notices.openedDependents(tx, blocking, actor.id) : []),
      ]);
    });
    return this.detail(actor, id);
  }

  async restore(actor: CurrentUserInfo, id: string): Promise<TaskDetail> {
    if (!holdsAll(actor, 'tasks.manage')) throw new ForbiddenException();
    await this.db.transaction(async (tx) => {
      // Taken before the row lock: restoring open work waits for user archiving (rule 6).
      await lockAccessChanges(tx);
      await lockDependencyGraph(tx);
      await lockParentOf(tx, id);
      const task = await readableTask(tx, this.directories, actor, id, { forUpdate: true });
      if (!task.archivedAt) {
        throw new CodedException(409, 'TASK_NOT_ARCHIVED', 'The task is not archived');
      }
      if (task.parent?.archivedAt) {
        throw new CodedException(409, 'TASK_ARCHIVED', 'Restore the parent task first');
      }
      const open = task.status !== 'delivered' && task.status !== 'cancelled';
      if (open && inClosedProject(task)) {
        throw new CodedException(409, 'PROJECT_CLOSED', 'Reopen the project first');
      }
      // F06B rule A11: the subtasks archived with the parent come back with it.
      const subtasks = task.parentId
        ? []
        : await tx
            .select(accessColumns)
            .from(tasks)
            .where(and(eq(tasks.parentId, id), eq(tasks.archivedAt, task.archivedAt)))
            .orderBy(asc(tasks.id))
            .for('update');
      if (task.parent) await this.placeRestoredSubtask(tx, task, task.parent);
      for (const restored of [task, ...subtasks]) {
        await this.restoreOne(tx, actor, restored);
      }
      if (task.parentId) {
        await this.runs.sync(tx, task.parentId, actor.id);
        await this.runs.rearm(tx, task.parentId, actor.id);
      }
    });
    return this.detail(actor, id);
  }

  /**
   * F06B: a subtask restored on its own joins an open parent last, in the stage its run mode
   * asks for (its own while live, else the first), within the limit of 30.
   */
  private async placeRestoredSubtask(
    tx: Transaction,
    task: TaskAccess,
    parent: ParentRef,
  ): Promise<void> {
    if (parent.status === 'delivered' || parent.status === 'cancelled') {
      throw new CodedException(409, 'TASK_CLOSED', 'Reopen the parent task first');
    }
    const kept = (await this.runs.subtasksOf(tx, parent.id)).filter((s) => !s.archivedAt);
    if (
      task.status !== 'cancelled' &&
      kept.filter((s) => s.status !== 'cancelled').length >= SUBTASK_LIMITS.subtasks
    ) {
      throw new CodedException(409, 'LIMIT_REACHED', 'A task holds at most 30 subtasks');
    }
    const stages = await this.runs.stagesOf(tx, parent.id);
    const stageId =
      parent.runMode === 'stages'
        ? ((stages.find((stage) => stage.id === task.stageId) ?? stages[0])?.id ?? null)
        : null;
    await tx
      .update(tasks)
      .set({ position: kept.length + 1, stageId })
      .where(eq(tasks.id, task.id));
  }

  /** Restores one locked task; an archived assignee cannot take open work back (rule 6). */
  private async restoreOne(tx: Transaction, actor: CurrentUserInfo, task: TaskRow): Promise<void> {
    const open = task.status !== 'delivered' && task.status !== 'cancelled';
    // An archived assignee cannot take the work back: it returns to the department queue.
    const unassign =
      open && !!task.assigneeId && !(await this.users.activeUser(task.assigneeId, tx));
    await tx
      .update(tasks)
      .set({ archivedAt: null, ...(unassign && { assigneeId: null }) })
      .where(eq(tasks.id, task.id));
    await this.auditArchive(tx, actor, 'task.restored', task.id, false);
    // F06B rule B10: open work back from the archive restarts its open questions' clocks.
    if (open) await restartQuestionClocks(tx, [task.id], new Date());
    if (unassign && task.assigneeId) {
      const people = await this.users.summaries([task.assigneeId], tx);
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'task.assigned',
        entityType: 'task',
        entityId: task.id,
        before: {
          assignee: { id: task.assigneeId, name: people.get(task.assigneeId)?.name ?? '' },
        },
        after: { assignee: null },
      });
    }
  }

  /**
   * F14: the new assignee gets `task_assigned`, the one it was taken from `task_changed`; a task
   * moved to a department without an assignee goes to its managers; a new due date or time goes
   * to the assignee.
   */
  private async notifyUpdate(
    tx: Transaction,
    actor: CurrentUserInfo,
    before: TaskAccess,
    basics: Change | null,
  ): Promise<void> {
    const after = await this.notices.load(tx, before.id);
    const notice = this.notices.notice.bind(this.notices);
    const list: Notice[] = [];
    if (after.assigneeId !== before.assigneeId) {
      list.push(notice(after, 'task_assigned', [after.assigneeId], actor.id));
      list.push(
        notice(after, 'task_changed', [before.assigneeId], actor.id, {
          change: 'taken_away',
          from: null,
          to: null,
        }),
      );
    }
    if (after.department !== before.department && !after.assigneeId) {
      const managers = await this.notices.managers(tx, after.department);
      list.push(notice(after, 'task_requested', managers, actor.id));
    }
    if (basics && ('dueDate' in basics.after || 'dueTime' in basics.after)) {
      const due = (task: NoticeTask) => ({
        dueDate: task.dueDate,
        dueTime: toTimeOfDay(task.dueTime),
      });
      list.push(
        notice(after, 'task_changed', [after.assigneeId], actor.id, {
          change: 'due',
          from: due(before),
          to: due(after),
        }),
      );
    }
    if (after.assigneeId !== before.assigneeId) {
      await this.notices.follow(tx, after.id, [after.assigneeId]);
    }
    await this.notices.sendChange(tx, before, actor.id, list);
  }

  /**
   * SQL over a row of `tasks`: shown in views and counts, so neither archived nor read-only
   * through an archived client, project or retainer (rule 17).
   */
  visibleSql(): SQL {
    return and(
      isNull(tasks.archivedAt),
      or(isNull(tasks.clientId), this.clients.isLive(tasks.clientId)),
      this.engagements.isLive(tasks.projectId, tasks.retainerCycleId),
    ) as SQL;
  }

  /**
   * SQL over a row of `tasks`: under the actor's client scope (`tasks.manage` under `all`, or
   * `own_clients` on the task's client); null when the actor has no client scope at all.
   */
  clientScopeSql(actor: CurrentUserInfo): SQL | null {
    const scopes = permissionScopes(actor.access, 'tasks.manage');
    if (scopes.includes('all')) return sql`true`;
    if (scopes.includes('own_clients')) return this.clients.managedBy(tasks.clientId, actor.id);
    return null;
  }

  /**
   * SQL over a row of `tasks`: ready to send to the client (F09 rule 8): awaiting the client,
   * without a pending item in an open request, and for a healthcare client cleared by a medical
   * pass.
   */
  readyToSendSql(): SQL {
    return and(
      eq(tasks.status, 'awaiting_client'),
      sql`not ${this.reviewHooks.waitingSql(tasks.id)}`,
      or(sql`not ${this.clients.isHealthcare(tasks.clientId)}`, clearedByMedicalSql),
    ) as SQL;
  }

  /**
   * SQL over a row of `tasks`: the actor may review it: under their manage scope, or a subtask of
   * a parent they are assigned, not their own (F06B rule A7).
   */
  reviewScopeSql(actor: CurrentUserInfo): SQL {
    return or(
      this.manageScopeSql(actor),
      sql`(${tasks.parentId} is not null and ${tasks.assigneeId} is distinct from ${actor.id}
        and exists (select 1 from ${tasks} as parent
          where parent.id = "tasks"."parent_id" and parent.assignee_id = ${actor.id}))`,
    ) as SQL;
  }

  /**
   * SQL over a row of `tasks`: under the actor's manage scope (`tasks.manage` under any scope), so
   * they may review it.
   */
  manageScopeSql(actor: CurrentUserInfo): SQL {
    const scopes = permissionScopes(actor.access, 'tasks.manage');
    if (scopes.includes('all')) return sql`true`;
    const managed = actor.access.departments.filter((d) => d.isManager).map((d) => d.code);
    const parts: SQL[] = [];
    if (scopes.includes('department') && managed.length > 0) {
      parts.push(inArray(tasks.department, managed));
    }
    if (scopes.includes('own_clients')) {
      parts.push(this.clients.managedBy(tasks.clientId, actor.id));
    }
    if (scopes.includes('assigned')) {
      parts.push(this.engagements.projectManagedBy(tasks.projectId, actor.id));
    }
    return parts.length > 0 ? (or(...parts) as SQL) : sql`false`;
  }

  /** List items for task rows, with their people, links and computed flags. */
  async present(
    rows: TaskRow[],
    executor: Executor,
    now: Date,
  ): Promise<(Task & { readOnly: boolean })[]> {
    const ids = rows.map((row) => row.id);
    const all = <K extends keyof TaskRow>(key: K) =>
      rows.flatMap((row) => (row[key] ? [row[key] as NonNullable<TaskRow[K]>] : []));
    const assignees = all('assigneeId');
    const [
      people,
      memberships,
      clients,
      projects,
      milestones,
      cycles,
      lines,
      blocked,
      checklist,
      revisions,
      parents,
      progress,
      questions,
    ] = await Promise.all([
      this.users.summaries(assignees, executor),
      this.users.memberships(assignees, executor),
      this.clients.summaries(all('clientId'), executor),
      this.engagements.projects(all('projectId'), executor),
      this.engagements.milestones(all('milestoneId'), executor),
      this.engagements.cycles(all('retainerCycleId'), executor),
      this.engagements.cycleLines(all('cycleLineId'), executor),
      blockedIds(ids, executor),
      this.checklistCounts(ids, executor),
      this.revisionCounts(ids, executor),
      parentsOf(executor, rows),
      this.subtaskCounts(
        rows.filter((row) => !row.parentId).map((row) => row.id),
        executor,
      ),
      this.openQuestionCounts(ids, executor),
    ]);
    return rows.map((row) => {
      const assignee = row.assigneeId ? people.get(row.assigneeId) : undefined;
      const client = row.clientId ? clients.get(row.clientId) : undefined;
      const project = row.projectId ? projects.get(row.projectId) : undefined;
      const milestone = row.milestoneId ? milestones.get(row.milestoneId) : undefined;
      const cycle = row.retainerCycleId ? cycles.get(row.retainerCycleId) : undefined;
      const line = row.cycleLineId ? lines.get(row.cycleLineId) : undefined;
      const dueTime = toTimeOfDay(row.dueTime);
      const revision = revisions.get(row.id);
      return {
        id: row.id,
        title: row.title,
        type: row.type,
        department: row.department,
        assignee:
          row.assigneeId && assignee
            ? {
                id: assignee.id,
                name: assignee.name,
                imageId: assignee.imageId,
                archived: assignee.archived,
                inDepartment: !!memberships.get(assignee.id)?.has(row.department),
              }
            : null,
        status: row.status,
        reviewStage: row.reviewStage,
        priority: row.priority,
        dueDate: row.dueDate,
        dueTime,
        overdue: isTaskOverdue({ status: row.status, dueDate: row.dueDate, dueTime }, now),
        blocked: blocked.has(row.id),
        client: client ? { id: client.id, name: client.name, imageId: client.imageId } : null,
        project: project ? { id: project.id, name: project.name, imageId: project.imageId } : null,
        milestone: milestone ? { id: milestone.id, name: milestone.name } : null,
        retainer: cycle
          ? { id: cycle.retainerId, name: cycle.retainerName, imageId: cycle.imageId }
          : null,
        cycle: cycle
          ? { id: cycle.id, periodStart: cycle.periodStart, periodEnd: cycle.periodEnd }
          : null,
        cycleLine: line ? { id: line.id, kind: line.kind, label: line.label } : null,
        checklist: checklist.get(row.id) ?? { done: 0, total: 0 },
        revisions: { clientCount: revision?.clientCount ?? 0, limit: row.revisionLimit },
        overLimitPending: revision?.overLimitPending ?? false,
        postId: row.postId,
        parent: (() => {
          const parent = row.parentId ? parents.get(row.parentId) : undefined;
          return parent ? { id: parent.id, title: parent.title } : null;
        })(),
        progress: progress.get(row.id) ?? null,
        openQuestions: questions.get(row.id) ?? { total: 0, inSubtasks: 0 },
        estimateMinutes: row.estimateMinutes,
        readOnly:
          !!row.archivedAt ||
          !!client?.archived ||
          !!project?.archived ||
          !!cycle?.retainerArchived,
      };
    });
  }

  /** Rule A9: each parent's delivered subtasks against its live ones; parents without any are left out. */
  private async subtaskCounts(ids: string[], executor: Executor) {
    if (ids.length === 0) return new Map<string, { delivered: number; total: number }>();
    const rows = await executor
      .select({
        parentId: tasks.parentId,
        total: count(),
        delivered: sql<number>`count(*) filter (where ${tasks.status} = 'delivered')`.mapWith(
          Number,
        ),
      })
      .from(tasks)
      .where(
        and(
          inArray(tasks.parentId, ids),
          isNull(tasks.archivedAt),
          sql`${tasks.status} <> 'cancelled'`,
        ),
      )
      .groupBy(tasks.parentId);
    return new Map(
      rows.flatMap((row) =>
        row.parentId
          ? [[row.parentId, { delivered: row.delivered, total: row.total }] as const]
          : [],
      ),
    );
  }

  /**
   * F06B: a parent's non-archived subtasks by position, with their stage, handover note and the
   * unfinished tasks each waits on now.
   */
  async subtaskItems(executor: Executor, parentId: string, now: Date): Promise<Subtask[]> {
    const rows = await executor
      .select(accessColumns)
      .from(tasks)
      .where(and(eq(tasks.parentId, parentId), isNull(tasks.archivedAt)))
      .orderBy(asc(tasks.position), asc(tasks.id));
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const [items, waits] = await Promise.all([
      this.present(rows, executor, now),
      executor
        .select({
          taskId: taskDependencies.taskId,
          id: tasks.id,
          title: tasks.title,
          status: tasks.status,
        })
        .from(taskDependencies)
        .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnId))
        .where(and(inArray(taskDependencies.taskId, ids), isNull(tasks.archivedAt)))
        .orderBy(asc(tasks.position), asc(tasks.title)),
    ]);
    return items.map(({ readOnly: _, ...item }, index) => {
      const row = rows[index] as TaskRow;
      return {
        ...item,
        position: row.position ?? index + 1,
        stageId: row.stageId,
        waitingOn: waits
          .filter(
            (wait) =>
              wait.taskId === row.id && wait.status !== 'cancelled' && !isTaskFinished(wait.status),
          )
          .map((wait) => ({ id: wait.id, title: wait.title })),
        handoverNote: row.handoverNote,
      };
    });
  }

  /** F06B rule B7, edge case 13: open questions of each task and of its live subtasks. */
  private async openQuestionCounts(ids: string[], executor: Executor) {
    const counts = new Map<string, { total: number; inSubtasks: number }>();
    if (ids.length === 0) return counts;
    const open = and(
      eq(taskComments.kind, 'question'),
      eq(taskComments.questionStatus, 'open'),
      isNull(taskComments.archivedAt),
    );
    const [own, inSubtasks] = await Promise.all([
      executor
        .select({ taskId: taskComments.taskId, value: count() })
        .from(taskComments)
        .where(and(inArray(taskComments.taskId, ids), open))
        .groupBy(taskComments.taskId),
      executor
        .select({ taskId: tasks.parentId, value: count() })
        .from(taskComments)
        .innerJoin(tasks, eq(tasks.id, taskComments.taskId))
        .where(and(inArray(tasks.parentId, ids), isNull(tasks.archivedAt), open))
        .groupBy(tasks.parentId),
    ]);
    const entry = (taskId: string) => {
      const found = counts.get(taskId) ?? { total: 0, inSubtasks: 0 };
      counts.set(taskId, found);
      return found;
    };
    for (const row of own) entry(row.taskId).total += row.value;
    for (const row of inSubtasks) {
      if (!row.taskId) continue;
      entry(row.taskId).total += row.value;
      entry(row.taskId).inSubtasks += row.value;
    }
    return counts;
  }

  private async storedBriefFields(tx: Transaction, id: string): Promise<TaskBriefFields | null> {
    const [row] = await tx
      .select({ briefFields: tasks.briefFields })
      .from(tasks)
      .where(eq(tasks.id, id));
    return (row?.briefFields as TaskBriefFields | null) ?? null;
  }

  private async storedBriefDoc(tx: Transaction, id: string): Promise<unknown> {
    const [row] = await tx.select({ briefDoc: tasks.briefDoc }).from(tasks).where(eq(tasks.id, id));
    return row?.briefDoc ?? null;
  }

  private async checklistCounts(ids: string[], executor: Executor) {
    if (ids.length === 0) return new Map<string, { done: number; total: number }>();
    const rows = await executor
      .select({
        taskId: taskChecklistItems.taskId,
        total: count(),
        done: count(taskChecklistItems.doneAt),
      })
      .from(taskChecklistItems)
      .where(
        and(
          inArray(taskChecklistItems.taskId, ids),
          eq(taskChecklistItems.kind, 'checklist'),
          isNull(taskChecklistItems.archivedAt),
        ),
      )
      .groupBy(taskChecklistItems.taskId);
    return new Map(rows.map((row) => [row.taskId, { done: row.done, total: row.total }]));
  }

  private async revisionCounts(ids: string[], executor: Executor) {
    if (ids.length === 0) {
      return new Map<string, { clientCount: number; overLimitPending: boolean }>();
    }
    const rows = await executor
      .select({
        taskId: taskRevisions.taskId,
        clientCount:
          sql<number>`count(*) filter (where ${taskRevisions.source} = 'client')`.mapWith(Number),
        overLimitPending: sql<boolean>`coalesce(bool_or(${taskRevisions.overLimit}
          and ${taskRevisions.decision} is null), false)`,
      })
      .from(taskRevisions)
      .where(inArray(taskRevisions.taskId, ids))
      .groupBy(taskRevisions.taskId);
    return new Map(rows.map((row) => [row.taskId, row]));
  }

  /**
   * Rule 7 for the links that are set: a client that takes work, a project open and of the
   * client, a pending milestone of the project, an open cycle of the client's retainer and a line
   * of the cycle. `kept` links are unchanged and pass even if their record closed since.
   */
  private async assertLinks(
    tx: Transaction,
    links: Links,
    client: ClientSummary | null,
    kept: Partial<Links> = {},
  ): Promise<void> {
    const changed = (field: (typeof LINK_FIELDS)[number]) =>
      !!links[field] && links[field] !== kept[field];
    const invalid = () => new CodedException(400, 'INVALID_LINK', 'The task links do not match');
    if (client && changed('clientId')) {
      if (client.archived)
        throw new CodedException(409, 'CLIENT_ARCHIVED', 'The client is archived');
      if (client.status === 'ended') {
        throw new CodedException(409, 'CLIENT_ENDED', 'Work is not added for an ended client');
      }
    }
    if (links.projectId && (changed('projectId') || changed('clientId'))) {
      const project = (await this.engagements.projects([links.projectId], tx, { lock: true })).get(
        links.projectId,
      );
      if (!project || project.clientId !== links.clientId) throw invalid();
      if (changed('projectId')) {
        if (project.archived) {
          throw new CodedException(409, 'PROJECT_ARCHIVED', 'The project is archived');
        }
        if (project.status === 'completed' || project.status === 'cancelled') {
          throw new CodedException(409, 'PROJECT_CLOSED', 'The project is completed or cancelled');
        }
      }
    }
    if (links.milestoneId && (changed('milestoneId') || changed('projectId'))) {
      const milestone = (await this.engagements.milestones([links.milestoneId], tx)).get(
        links.milestoneId,
      );
      if (!milestone || milestone.archived || milestone.projectId !== links.projectId) {
        throw invalid();
      }
      if (changed('milestoneId') && milestone.status === 'done') {
        throw new CodedException(409, 'MILESTONE_DONE', 'The milestone is done');
      }
    }
    if (links.retainerCycleId && (changed('retainerCycleId') || changed('clientId'))) {
      const cycle = (await this.engagements.cycles([links.retainerCycleId], tx)).get(
        links.retainerCycleId,
      );
      if (!cycle || cycle.clientId !== links.clientId) throw invalid();
      if (changed('retainerCycleId')) {
        if (cycle.retainerArchived) {
          throw new CodedException(409, 'RETAINER_ARCHIVED', 'The retainer is archived');
        }
        if (cycle.status !== 'open') {
          throw new CodedException(409, 'CYCLE_CLOSED', 'The retainer cycle is closed');
        }
      }
    }
    if (links.cycleLineId && (changed('cycleLineId') || changed('retainerCycleId'))) {
      const line = (await this.engagements.cycleLines([links.cycleLineId], tx)).get(
        links.cycleLineId,
      );
      if (!line || line.cycleId !== links.retainerCycleId) throw invalid();
    }
  }

  /** Rule 6: a non-archived member of the department. */
  private async assertAssignee(tx: Transaction, userId: string, department: TaskRow['department']) {
    if (!(await this.users.activeMember(userId, department, tx))) {
      throw new CodedException(
        400,
        'INVALID_ASSIGNEE',
        'The assignee must be an active member of the department',
      );
    }
  }

  private async assertContact(tx: Transaction, clientId: string, contactId: string) {
    if (!(await this.clients.isActiveContact(clientId, contactId, tx))) {
      throw new CodedException(
        400,
        'UNKNOWN_CONTACT',
        'The contact is not a contact of the client',
      );
    }
  }

  /** Rule 11: an out-of-scope request logs extra work on its project or retainer. */
  /**
   * F17 rule B17: `409 ASSIGNEE_ON_LEAVE` with the leaves when the due date falls on the
   * assignee's approved leave, unless the request accepts them; returns the accepted ones.
   */
  private async checkLeave(
    tx: Transaction,
    assigneeId: string,
    dueDate: CalendarDate,
    accept: boolean | undefined,
  ): Promise<AssigneeLeave[]> {
    const leaves = await this.leave.covering(tx, assigneeId, dueDate);
    if (leaves.length > 0 && !accept) {
      throw new CodedException(
        409,
        'ASSIGNEE_ON_LEAVE',
        'The assignee is on leave on the due date',
        leaves,
      );
    }
    return leaves;
  }

  private async auditAcceptedLeave(
    tx: Transaction,
    actor: CurrentUserInfo,
    taskId: string,
    assigneeId: string,
    dueDate: CalendarDate,
    leaves: readonly AssigneeLeave[],
  ): Promise<void> {
    await recordAudit(tx, {
      actor: actorOf(actor),
      action: 'task.leave_accepted',
      entityType: 'task',
      entityId: taskId,
      after: { assigneeId, dueDate, leaves },
    });
  }

  private async createRequestExtraWork(
    tx: Transaction,
    actor: CurrentUserInfo,
    task: {
      title: string;
      brief: string | null;
      projectId: string | null;
      retainerCycleId: string | null;
      requestedOn: string | null;
      requestedByContactId: string | null;
    },
  ): Promise<string> {
    const owner = await this.engagementOf(tx, task);
    const item = await this.engagements.createExtraWork(
      tx,
      {
        owner,
        title: task.title,
        description: task.brief,
        requestedOn: task.requestedOn ?? businessDate(),
        requestedByContactId: task.requestedByContactId,
      },
      actorOf(actor),
    );
    return item.id;
  }

  /** The project or retainer a task works for; `NO_ENGAGEMENT` without one. */
  async engagementOf(
    executor: Executor,
    task: { projectId: string | null; retainerCycleId: string | null },
  ): Promise<{ kind: 'project' | 'retainer'; id: string }> {
    if (task.projectId) return { kind: 'project', id: task.projectId };
    if (task.retainerCycleId) {
      const cycle = (await this.engagements.cycles([task.retainerCycleId], executor)).get(
        task.retainerCycleId,
      );
      if (cycle) return { kind: 'retainer', id: cycle.retainerId };
    }
    throw new CodedException(
      409,
      'NO_ENGAGEMENT',
      'Extra work needs the task linked to a project or a retainer',
    );
  }

  private auditArchive(
    tx: Transaction,
    actor: CurrentUserInfo,
    action: AuditAction,
    id: string,
    archived: boolean,
  ) {
    return recordAudit(tx, {
      actor: actorOf(actor),
      action,
      entityType: 'task',
      entityId: id,
      before: { archived: !archived },
      after: { archived },
    });
  }
}

const pickLinks = (task: Links): Links => ({
  clientId: task.clientId,
  projectId: task.projectId,
  milestoneId: task.milestoneId,
  retainerCycleId: task.retainerCycleId,
  cycleLineId: task.cycleLineId,
});
