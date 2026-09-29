import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type AuditAction,
  businessDate,
  type CreateTask,
  isTaskOverdue,
  OPEN_TASK_STATUSES,
  TASK_LIMITS,
  type Task,
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
import { type CurrentUserInfo, lockAccessChanges, UserDirectory } from '../auth/index.js';
import { ClientDirectory, type ClientSummary } from '../clients/index.js';
import { EngagementDirectory } from '../projects/index.js';
import {
  accessColumns,
  actorOf,
  assertTaskWritable,
  belongsTo,
  hasAssignScope,
  hasClientScope,
  holdsAll,
  ownsOpenRequest,
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
} from './task-dependencies.js';

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

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** Syria keeps UTC+3 all year: the time of day in Asia/Damascus, as `HH:MM:SS`. */
const businessTime = (now: Date) =>
  new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(11, 19);

/** SQL over a row of `tasks`: open and past its due date and time (rule 12). */
function overdueSql(now: Date): SQL {
  const today = businessDate(now);
  return sql`(${tasks.status} in (${sql.join(
    OPEN_TASK_STATUSES.map((status) => sql`${status}`),
    sql`, `,
  )}) and (${tasks.dueDate} < ${today}
    or (${tasks.dueTime} is not null and ${tasks.dueDate} = ${today}
      and ${tasks.dueTime} < ${businessTime(now)})))`;
}

/** SQL over a row of `tasks`: a client revision over the limit waits for a decision. */
const overLimitPendingSql = sql<boolean>`exists (
  select 1 from ${taskRevisions} as r
  where r.task_id = "tasks"."id" and r.over_limit and r.decision is null)`;

/** `HH:MM:SS` from the database to `HH:MM`. */
const toTimeOfDay = (time: string | null) => time?.slice(0, 5) ?? null;

/** Tasks of every department (spec F06): list, detail, create, edit, archive and restore. */
@Injectable()
export class TasksService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
    private readonly engagements: EngagementDirectory,
  ) {}

  private get directories() {
    return { clients: this.clients, engagements: this.engagements };
  }

  async list(actor: CurrentUserInfo, query: TaskListQuery): Promise<TaskPage> {
    if (query.archived && !holdsAll(actor, 'tasks.manage')) throw new ForbiddenException();
    const now = new Date();
    const filters: (SQL | undefined)[] = [
      holdsAll(actor, 'tasks.read') ? undefined : sql`false`,
      query.archived
        ? isNotNull(tasks.archivedAt)
        : and(
            isNull(tasks.archivedAt),
            or(isNull(tasks.clientId), this.clients.isLive(tasks.clientId)),
            this.engagements.isLive(tasks.projectId, tasks.retainerCycleId),
          ),
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
    if (query.dueFrom) filters.push(gte(tasks.dueDate, query.dueFrom));
    if (query.dueTo) filters.push(lte(tasks.dueDate, query.dueTo));
    if (query.createdBy === 'me') filters.push(eq(tasks.createdById, actor.id));
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
    const [[item], dependencies, dependents, checklist, links, revisions, extras] =
      await Promise.all([
        this.present([task], this.db, now),
        dependenciesOf(id, this.db),
        dependentsOf(id, this.db),
        this.db
          .select()
          .from(taskChecklistItems)
          .where(and(eq(taskChecklistItems.taskId, id), isNull(taskChecklistItems.archivedAt)))
          .orderBy(asc(taskChecklistItems.position)),
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
            createdAt: tasks.createdAt,
            updatedAt: tasks.updatedAt,
            deliveredAt: tasks.deliveredAt,
            cancelledAt: tasks.cancelledAt,
            cancelReason: tasks.cancelReason,
          })
          .from(tasks)
          .where(eq(tasks.id, id)),
      ]);
    const row = extras[0];
    if (!item || !row) throw new NotFoundException();
    const [people, contacts, extraWork] = await Promise.all([
      this.users.summaries([
        task.createdById,
        ...checklist.flatMap((i) => (i.doneById ? [i.doneById] : [])),
        ...links.map((l) => l.addedById),
        ...revisions.flatMap((r) => [r.authorId, ...(r.decidedById ? [r.decidedById] : [])]),
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
    const person = (userId: string) => ({ id: userId, name: people.get(userId)?.name ?? '' });
    const requestExtra = task.extraWorkItemId ? extraWork.get(task.extraWorkItemId) : undefined;
    return {
      ...item,
      brief: task.brief,
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
      checklistItems: checklist.map((i) => ({
        id: i.id,
        text: i.text,
        position: i.position,
        done: !!i.doneAt,
        doneAt: i.doneAt?.toISOString() ?? null,
        doneBy: i.doneById ? person(i.doneById) : null,
      })),
      links: links.map((l) => ({
        id: l.id,
        url: l.url,
        label: l.label,
        addedBy: person(l.addedById),
        createdAt: l.createdAt.toISOString(),
      })),
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
          author: person(r.authorId),
          createdAt: r.createdAt.toISOString(),
        };
      }),
      createdBy: person(task.createdById),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      startedAt: task.startedAt?.toISOString() ?? null,
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      cancelReason: row.cancelReason,
      archivedAt: task.archivedAt?.toISOString() ?? null,
      readOnly: item.readOnly,
      ...taskPermissions(actor, task, item.blocked),
    };
  }

  async create(actor: CurrentUserInfo, input: CreateTask): Promise<TaskDetail> {
    const id = await this.db.transaction(async (tx) => {
      // Serialized with archiving users: an assignee must stay active (F01 change).
      if (input.assigneeId) await lockAccessChanges(tx);
      const client = input.clientId
        ? await this.clients.summary(input.clientId, tx, { forUpdate: true })
        : null;
      if (input.clientId && !client) throw new NotFoundException();

      // Who may create what (actions table).
      const selfAssigned = input.assigneeId === actor.id && belongsTo(actor, input.department);
      if (input.assigneeId && !selfAssigned && !hasAssignScope(actor, { ...input, client })) {
        throw new ForbiddenException();
      }
      if (input.type === 'client_request' && !hasClientScope(actor, client)) {
        throw new ForbiddenException();
      }

      await this.assertLinks(tx, input, client);
      if (input.assigneeId) await this.assertAssignee(tx, input.assigneeId, input.department);
      if (input.dueDate < businessDate()) {
        throw new CodedException(400, 'INVALID_DATES', 'The due date is in the past');
      }
      if (
        input.checklist.length > TASK_LIMITS.checklist ||
        input.links.length > TASK_LIMITS.links
      ) {
        throw new CodedException(409, 'LIMIT_REACHED', 'Too many checklist items or links');
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

      const values = {
        title: input.title,
        brief: input.brief ?? null,
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
      };
      const [created] = await tx
        .insert(tasks)
        .values({ ...values, createdById: actor.id })
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
          ...(extraWorkItemId && { extraWorkItemId }),
          ...(dependsOn.length > 0 && { dependsOn }),
          ...(input.checklist.length > 0 && { checklist: input.checklist }),
          ...(input.links.length > 0 && { links: input.links }),
        },
      });
      return created.id;
    });
    return this.detail(actor, id);
  }

  async update(actor: CurrentUserInfo, id: string, input: UpdateTask): Promise<TaskDetail> {
    await this.db.transaction(async (tx) => {
      const movesPeople = input.assigneeId !== undefined || input.department !== undefined;
      if (movesPeople) await lockAccessChanges(tx);
      const task = await readableTask(tx, this.directories, actor, id, { forUpdate: true });
      const rights = taskRights(actor, task);
      if (!rights.manage && !ownsOpenRequest(rights, task)) throw new ForbiddenException();
      assertTaskWritable(task);

      const department = input.department ?? task.department;
      const assigneeGiven = input.assigneeId !== undefined && input.assigneeId !== task.assigneeId;
      const departmentGiven = department !== task.department;
      if ((assigneeGiven || departmentGiven) && !rights.assign) throw new ForbiddenException();
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
        if (links.clientId !== task.clientId) await assertSameClientLinks(tx, id, links.clientId);
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

      const basics = changedFields(
        {
          title: task.title,
          brief: task.brief,
          priority: task.priority,
          dueDate: task.dueDate,
          dueTime: toTimeOfDay(task.dueTime),
          needsClientApproval: task.needsClientApproval,
          revisionLimit: task.revisionLimit,
          requestedOn: task.requestedOn,
          requestedByContactId: task.requestedByContactId,
          ...pickLinks(task),
        },
        {
          title: input.title,
          brief: input.brief,
          priority: input.priority,
          dueDate: input.dueDate,
          dueTime: input.dueTime,
          needsClientApproval,
          revisionLimit: input.revisionLimit,
          requestedOn: input.requestedOn,
          requestedByContactId: input.requestedByContactId,
          ...links,
        },
      );
      const assigneeChange = assigneeId !== task.assigneeId;
      const departmentChange = department !== task.department;
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

      await tx
        .update(tasks)
        .set({
          ...basics?.after,
          department,
          assigneeId,
          ...(scopeGiven && { requestScope: input.requestScope, extraWorkItemId }),
        })
        .where(eq(tasks.id, id));

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
    });
    return this.detail(actor, id);
  }

  async archive(actor: CurrentUserInfo, id: string): Promise<TaskDetail> {
    if (!holdsAll(actor, 'tasks.manage')) throw new ForbiddenException();
    await this.db.transaction(async (tx) => {
      const task = await readableTask(tx, this.directories, actor, id, { forUpdate: true });
      if (task.archivedAt) {
        throw new CodedException(409, 'TASK_ARCHIVED', 'The task is already archived');
      }
      await tx.update(tasks).set({ archivedAt: new Date() }).where(eq(tasks.id, id));
      await this.auditArchive(tx, actor, 'task.archived', id, true);
    });
    return this.detail(actor, id);
  }

  async restore(actor: CurrentUserInfo, id: string): Promise<TaskDetail> {
    if (!holdsAll(actor, 'tasks.manage')) throw new ForbiddenException();
    await this.db.transaction(async (tx) => {
      const task = await readableTask(tx, this.directories, actor, id, { forUpdate: true });
      if (!task.archivedAt) {
        throw new CodedException(409, 'TASK_NOT_ARCHIVED', 'The task is not archived');
      }
      await tx.update(tasks).set({ archivedAt: null }).where(eq(tasks.id, id));
      await this.auditArchive(tx, actor, 'task.restored', id, false);
    });
    return this.detail(actor, id);
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
                archived: assignee.archived,
                inDepartment: !!memberships.get(assignee.id)?.has(row.department),
              }
            : null,
        status: row.status,
        priority: row.priority,
        dueDate: row.dueDate,
        dueTime,
        overdue: isTaskOverdue({ status: row.status, dueDate: row.dueDate, dueTime }, now),
        blocked: blocked.has(row.id),
        client: client ? { id: client.id, name: client.name } : null,
        project: project ? { id: project.id, name: project.name } : null,
        milestone: milestone ? { id: milestone.id, name: milestone.name } : null,
        retainer: cycle ? { id: cycle.retainerId, name: cycle.retainerName } : null,
        cycle: cycle
          ? { id: cycle.id, periodStart: cycle.periodStart, periodEnd: cycle.periodEnd }
          : null,
        cycleLine: line ? { id: line.id, kind: line.kind, label: line.label } : null,
        checklist: checklist.get(row.id) ?? { done: 0, total: 0 },
        revisions: { clientCount: revision?.clientCount ?? 0, limit: row.revisionLimit },
        overLimitPending: revision?.overLimitPending ?? false,
        readOnly:
          !!row.archivedAt ||
          !!client?.archived ||
          !!project?.archived ||
          !!cycle?.retainerArchived,
      };
    });
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
      .where(and(inArray(taskChecklistItems.taskId, ids), isNull(taskChecklistItems.archivedAt)))
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

const pickLinks = (task: TaskAccess): Links => ({
  clientId: task.clientId,
  projectId: task.projectId,
  milestoneId: task.milestoneId,
  retainerCycleId: task.retainerCycleId,
  cycleLineId: task.cycleLineId,
});
