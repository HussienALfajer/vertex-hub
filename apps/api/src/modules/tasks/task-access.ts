import { NotFoundException } from '@nestjs/common';
import {
  allowedTaskTransitions,
  type DepartmentCode,
  hasPermission,
  isProjectClosed,
  type Permission,
  permissionScopes,
  type RequestScope,
  type ReviewStage,
  type SubtaskRunMode,
  type TaskPermissions,
  type TaskRights,
  type TaskStatus,
  type TaskType,
} from '@vertex-hub/contracts';
import { type Database, type Transaction, tasks } from '@vertex-hub/db';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { CodedException } from '../../core/errors/index.js';
import type { AuditActor } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import type { ClientDirectory, ClientSummary } from '../clients/index.js';
import type { CycleLink, EngagementDirectory, ProjectLink } from '../projects/index.js';

/*
 * Who may read and change a task (spec F06, "Roles and access" and "Scopes on tasks").
 */

export const actorOf = (user: CurrentUserInfo): AuditActor => ({ id: user.id, name: user.name });

/** Holds `permission` over every record. */
export const holdsAll = (actor: CurrentUserInfo, permission: Permission) =>
  permissionScopes(actor.access, permission).includes('all');

export const managesDepartment = (actor: CurrentUserInfo, department: DepartmentCode) =>
  actor.access.departments.some((d) => d.code === department && d.isManager);

export const belongsTo = (actor: CurrentUserInfo, department: DepartmentCode) =>
  actor.access.departments.some((d) => d.code === department);

/** The stored fields of a task that access and the workflow look at. */
export const accessColumns = {
  id: tasks.id,
  title: tasks.title,
  brief: tasks.brief,
  type: tasks.type,
  department: tasks.department,
  assigneeId: tasks.assigneeId,
  status: tasks.status,
  reviewStage: tasks.reviewStage,
  priority: tasks.priority,
  dueDate: tasks.dueDate,
  dueTime: tasks.dueTime,
  clientId: tasks.clientId,
  projectId: tasks.projectId,
  milestoneId: tasks.milestoneId,
  retainerCycleId: tasks.retainerCycleId,
  cycleLineId: tasks.cycleLineId,
  needsClientApproval: tasks.needsClientApproval,
  clientText: tasks.clientText,
  clearedReviewId: tasks.clearedReviewId,
  revisionLimit: tasks.revisionLimit,
  requestedByContactId: tasks.requestedByContactId,
  requestedOn: tasks.requestedOn,
  requestScope: tasks.requestScope,
  extraWorkItemId: tasks.extraWorkItemId,
  postId: tasks.postId,
  createdById: tasks.createdById,
  startedAt: tasks.startedAt,
  parentId: tasks.parentId,
  position: tasks.position,
  stageId: tasks.stageId,
  runMode: tasks.runMode,
  handoverNote: tasks.handoverNote,
  estimateMinutes: tasks.estimateMinutes,
  archivedAt: tasks.archivedAt,
};

export interface TaskRow {
  id: string;
  title: string;
  brief: string | null;
  type: TaskType;
  department: DepartmentCode;
  assigneeId: string | null;
  status: TaskStatus;
  reviewStage: ReviewStage | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  dueDate: string;
  dueTime: string | null;
  clientId: string | null;
  projectId: string | null;
  milestoneId: string | null;
  retainerCycleId: string | null;
  cycleLineId: string | null;
  needsClientApproval: boolean;
  clientText: string | null;
  clearedReviewId: string | null;
  revisionLimit: number;
  requestedByContactId: string | null;
  requestedOn: string | null;
  requestScope: RequestScope | null;
  extraWorkItemId: string | null;
  postId: string | null;
  createdById: string | null;
  startedAt: Date | null;
  parentId: string | null;
  position: number | null;
  stageId: string | null;
  runMode: SubtaskRunMode | null;
  handoverNote: string | null;
  estimateMinutes: number | null;
  archivedAt: Date | null;
}

/**
 * The order every set of task row locks follows, so concurrent changes cannot deadlock: by id,
 * with a parent right before its subtasks (F06B: a subtask's move locks its parent first).
 */
export const taskLockOrder = [
  sql`coalesce(${tasks.parentId}, ${tasks.id})`,
  sql`${tasks.parentId} is not null`,
  asc(tasks.id),
];

/**
 * F06B: a change of a subtask locks its parent first (the parent before its subtasks, as
 * `taskLockOrder`), so it serializes with the parent's own changes (edge case 2).
 */
export async function lockParentOf(tx: Transaction, taskId: string): Promise<void> {
  const [row] = await tx
    .select({ parentId: tasks.parentId })
    .from(tasks)
    .where(eq(tasks.id, taskId));
  if (row?.parentId) {
    await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, row.parentId)).for('update');
  }
}

/** The parent of a subtask, as access, the workflow and notices read it (F06B). */
export interface ParentRef {
  id: string;
  title: string;
  status: TaskStatus;
  department: DepartmentCode;
  assigneeId: string | null;
  runMode: SubtaskRunMode | null;
  dueDate: string;
  dueTime: string | null;
  archivedAt: Date | null;
}

const parentColumns = {
  id: tasks.id,
  title: tasks.title,
  status: tasks.status,
  department: tasks.department,
  assigneeId: tasks.assigneeId,
  runMode: tasks.runMode,
  dueDate: tasks.dueDate,
  dueTime: tasks.dueTime,
  archivedAt: tasks.archivedAt,
};

/**
 * F06B rule A5: whether a due date and time fall after another; a date without a time ends with
 * the day.
 */
export const dueAfter = (
  a: { dueDate: string; dueTime: string | null },
  b: { dueDate: string; dueTime: string | null },
): boolean =>
  a.dueDate > b.dueDate ||
  (a.dueDate === b.dueDate &&
    b.dueTime !== null &&
    (a.dueTime === null || a.dueTime.slice(0, 5) > b.dueTime.slice(0, 5)));

/** The parents of `rows`' subtasks, by id. */
export async function parentsOf(
  executor: Database | Transaction,
  rows: readonly { parentId: string | null }[],
): Promise<Map<string, ParentRef>> {
  const ids = [...new Set(rows.flatMap((row) => (row.parentId ? [row.parentId] : [])))];
  if (ids.length === 0) return new Map();
  const parents = await executor.select(parentColumns).from(tasks).where(inArray(tasks.id, ids));
  return new Map(parents.map((parent) => [parent.id, parent]));
}

/** A task with the records that decide access: its client, project, retainer cycle and parent. */
export interface TaskAccess extends TaskRow {
  client: ClientSummary | null;
  project: ProjectLink | null;
  cycle: CycleLink | null;
  parent: ParentRef | null;
}

/** Rule 17: archived, or its client, project or retainer is archived. */
export const isReadOnly = (task: TaskAccess) =>
  !!task.archivedAt ||
  !!task.client?.archived ||
  !!task.project?.archived ||
  !!task.cycle?.retainerArchived;

/**
 * Loads a task the actor may read, else 404. A read-only task (rule 17) is readable by scope-all
 * holders of `tasks.manage` only. `forUpdate` locks the task row.
 */
export async function readableTask(
  executor: Database | Transaction,
  directories: { clients: ClientDirectory; engagements: EngagementDirectory },
  actor: CurrentUserInfo,
  id: string,
  options: { forUpdate?: boolean } = {},
): Promise<TaskAccess> {
  const query = executor.select(accessColumns).from(tasks).where(eq(tasks.id, id));
  const [row] = options.forUpdate ? await query.for('update') : await query;
  if (!row || !holdsAll(actor, 'tasks.read')) throw new NotFoundException();
  const [client, projects, cycles, parents] = await Promise.all([
    row.clientId ? directories.clients.summary(row.clientId, executor) : null,
    directories.engagements.projects(row.projectId ? [row.projectId] : [], executor),
    directories.engagements.cycles(row.retainerCycleId ? [row.retainerCycleId] : [], executor),
    parentsOf(executor, [row]),
  ]);
  const task: TaskAccess = {
    ...row,
    client,
    project: (row.projectId && projects.get(row.projectId)) || null,
    cycle: (row.retainerCycleId && cycles.get(row.retainerCycleId)) || null,
    parent: (row.parentId && parents.get(row.parentId)) || null,
  };
  if (isReadOnly(task) && !holdsAll(actor, 'tasks.manage')) throw new NotFoundException();
  return task;
}

/** Refuses any change but restore on a read-only task (rule 17). */
export function assertTaskWritable(task: TaskAccess): void {
  if (isReadOnly(task)) {
    throw new CodedException(409, 'TASK_ARCHIVED', 'The task or its work is archived');
  }
}

/** The actor is primary account manager of the client (`own_clients`). */
const managesClient = (actor: CurrentUserInfo, client: ClientSummary | null) =>
  permissionScopes(actor.access, 'tasks.manage').includes('own_clients') &&
  !!client &&
  client.accountManagerId === actor.id;

/** Client scope: `tasks.manage` under `all`, or `own_clients` on the task's client. */
export const hasClientScope = (actor: CurrentUserInfo, client: ClientSummary | null) =>
  holdsAll(actor, 'tasks.manage') || managesClient(actor, client);

/**
 * Assign scope for a task of `department` and `client`: `tasks.manage` under `all`,
 * `department` (a department the actor manages) or `own_clients`; never `assigned` alone.
 */
export function hasAssignScope(
  actor: CurrentUserInfo,
  task: { department: DepartmentCode; client: ClientSummary | null },
): boolean {
  const scopes = permissionScopes(actor.access, 'tasks.manage');
  return (
    scopes.includes('all') ||
    (scopes.includes('department') && managesDepartment(actor, task.department)) ||
    managesClient(actor, task.client)
  );
}

/** The project manager of the task's non-archived project (`tasks.manage` `assigned`). */
const managesProject = (actor: CurrentUserInfo, task: TaskAccess) =>
  permissionScopes(actor.access, 'tasks.manage').includes('assigned') &&
  !!task.project &&
  !task.project.archived &&
  task.project.projectManagerId === actor.id;

/** `tasks.work`: the assignee, or the manager of the task's department. */
function works(actor: CurrentUserInfo, task: TaskAccess): boolean {
  const scopes = permissionScopes(actor.access, 'tasks.work');
  return (
    scopes.includes('all') ||
    (scopes.includes('assigned') && !!task.assigneeId && task.assigneeId === actor.id) ||
    (scopes.includes('department') && managesDepartment(actor, task.department))
  );
}

export function taskRights(actor: CurrentUserInfo, task: TaskAccess): TaskRights {
  const assign = hasAssignScope(actor, task);
  return {
    work: works(actor, task),
    manage: assign || managesProject(actor, task),
    assign,
    client: hasClientScope(actor, task.client),
    creator: hasPermission(actor.access, 'tasks.request') && task.createdById === actor.id,
    // F06B rule A7: the parent's assignee reviews its subtasks, except their own.
    parentReviewer:
      !!task.parent?.assigneeId &&
      task.parent.assigneeId === actor.id &&
      task.assigneeId !== actor.id,
    // F06B, Roles: who manages the parent's subtasks cancels them. A subtask shares its parent's
    // client and engagement (rule A1), so the parent's rights are read from its own row's links.
    parentManager:
      !!task.parent &&
      managesSubtasks(actor, {
        ...task,
        id: task.parent.id,
        department: task.parent.department,
        assigneeId: task.parent.assigneeId,
        parentId: null,
        parent: null,
      }),
  };
}

/**
 * F06B, Roles: manage scope on the parent, or being its assignee, gives the subtask rights over
 * a top-level task (add, reorder, cancel, stages, run mode, convert).
 */
export const managesSubtasks = (actor: CurrentUserInfo, parent: TaskAccess): boolean =>
  !parent.parentId &&
  (taskRights(actor, parent).manage || (!!parent.assigneeId && parent.assigneeId === actor.id));

/** Rule A10: the parent's `tasks.work` holders (its assignee, its department managers) or manage scope. */
export const reopensSubtasks = (actor: CurrentUserInfo, parent: TaskAccess): boolean => {
  const rights = taskRights(actor, parent);
  return !parent.parentId && (rights.work || rights.manage);
};

/** F06B rule C6: manage scope writes the acceptance criteria. */
export const editsCriteria = (rights: TaskRights): boolean => rights.manage;

/** Rule C6: the assignee, the department managers, a reviewer of a subtask or manage scope tick them. */
export const ticksCriteria = (rights: TaskRights): boolean =>
  rights.work || rights.manage || rights.parentReviewer;

/** A parent takes no new subtasks, order or mode once delivered, cancelled or archived. */
export function assertParentOpen(parent: TaskAccess): void {
  if (parent.parentId) {
    throw new CodedException(409, 'SUBTASK_DEPTH', 'A subtask has no subtasks');
  }
  assertTaskWritable(parent);
  if (parent.status === 'delivered' || parent.status === 'cancelled') {
    throw new CodedException(409, 'TASK_CLOSED', 'The task is delivered or cancelled');
  }
}

/**
 * A task of a completed or cancelled project stays closed until the project is reopened (F05
 * rule 7, F06 edge case 7): reopening or restoring it answers `PROJECT_CLOSED`.
 */
export const inClosedProject = (task: TaskAccess) =>
  !!task.project && isProjectClosed(task.project.status);

/** The creator of an unassigned request may edit and withdraw it while it is new (rule 13). */
export const ownsOpenRequest = (rights: TaskRights, task: TaskAccess) =>
  rights.creator && task.status === 'new' && task.assigneeId === null;

/** The workflow's view of a task. */
export const taskState = (task: TaskAccess, blocked: boolean) => ({
  status: task.status,
  reviewStage: task.reviewStage,
  assigneeId: task.assigneeId,
  hasClient: !!task.clientId,
  needsClientApproval: task.needsClientApproval,
  blocked,
  subtask: !!task.parentId,
});

/** F09 rule 4: holders of `approvals.review_medical`, never the task's assignee. */
export const mayMedicalReview = (actor: CurrentUserInfo, task: TaskAccess) =>
  hasPermission(actor.access, 'approvals.review_medical') && task.assigneeId !== actor.id;

/**
 * F09 rule 8: `awaiting_client`, without a pending item in an open request, and for a healthcare
 * client cleared by a medical pass.
 */
export const isReadyToSend = (
  task: TaskAccess,
  sending: { waiting: boolean; clearedStage: ReviewStage | null },
) =>
  task.status === 'awaiting_client' &&
  !task.archivedAt &&
  !sending.waiting &&
  (!task.client?.isHealthcare || sending.clearedStage === 'medical');

/**
 * F08 rule 7: an approved task linked to a post is neither delivered by hand nor answered by the
 * client: the client approves the post, and publishing it delivers the task (`LINKED_TO_POST`).
 */
export const isRefusedOnLinkedTask = (
  task: Pick<TaskRow, 'postId' | 'status'>,
  to: TaskStatus,
): boolean =>
  !!task.postId && task.status === 'approved' && (to === 'delivered' || to === 'revisions');

/** What the UI shows, and the moves it offers; the API checks each action again. */
export function taskPermissions(
  actor: CurrentUserInfo,
  task: TaskAccess,
  blocked: boolean,
  sending: { waiting: boolean; clearedStage: ReviewStage | null },
): { permissions: TaskPermissions; allowedTransitions: TaskStatus[] } {
  const rights = taskRights(actor, task);
  const readOnly = isReadOnly(task);
  const closed = task.status === 'delivered' || task.status === 'cancelled';
  const allowedTransitions =
    readOnly || (closed && inClosedProject(task))
      ? []
      : allowedTaskTransitions(taskState(task, blocked), rights).filter(
          (to) => !isRefusedOnLinkedTask(task, to),
        );
  const open = !readOnly && !closed;
  return {
    permissions: {
      canEdit: !readOnly && (rights.manage || ownsOpenRequest(rights, task)),
      canAssign: !readOnly && rights.assign,
      canWork: !readOnly && rights.work,
      canReview: !readOnly && (rights.manage || rights.parentReviewer),
      canRecordClientResponse: !readOnly && rights.client && !!task.clientId && !task.postId,
      canDecideRevision: !readOnly && rights.client,
      canMedicalReview:
        !readOnly && task.reviewStage === 'medical' && mayMedicalReview(actor, task),
      canWithdrawFromClient:
        task.status === 'awaiting_client' && allowedTransitions.includes('internal_review'),
      canEditClientText: !readOnly && closed === false && (rights.work || rights.manage),
      canSendForApproval: !readOnly && rights.client && isReadyToSend(task, sending),
      canCancel: allowedTransitions.includes('cancelled'),
      canReopen: !readOnly && closed && allowedTransitions.length > 0,
      canArchive: holdsAll(actor, 'tasks.manage'),
      canManageSubtasks: open && managesSubtasks(actor, task),
      canReopenSubtasks: !readOnly && task.status === 'revisions' && reopensSubtasks(actor, task),
      canWriteHandover: open && !!task.parentId && rights.work,
      canEditCriteria: !readOnly && editsCriteria(rights),
      canTickCriteria: !readOnly && ticksCriteria(rights),
      canSaveTemplate: !task.parentId && rights.assign,
    },
    allowedTransitions,
  };
}
