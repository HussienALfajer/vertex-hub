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
  type TaskPermissions,
  type TaskRights,
  type TaskStatus,
  type TaskType,
} from '@vertex-hub/contracts';
import { type Database, type Transaction, tasks } from '@vertex-hub/db';
import { eq } from 'drizzle-orm';
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
  createdById: tasks.createdById,
  startedAt: tasks.startedAt,
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
  createdById: string | null;
  startedAt: Date | null;
  archivedAt: Date | null;
}

/** A task with the records that decide access: its client, project and retainer cycle. */
export interface TaskAccess extends TaskRow {
  client: ClientSummary | null;
  project: ProjectLink | null;
  cycle: CycleLink | null;
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
  const [client, projects, cycles] = await Promise.all([
    row.clientId ? directories.clients.summary(row.clientId, executor) : null,
    directories.engagements.projects(row.projectId ? [row.projectId] : [], executor),
    directories.engagements.cycles(row.retainerCycleId ? [row.retainerCycleId] : [], executor),
  ]);
  const task: TaskAccess = {
    ...row,
    client,
    project: (row.projectId && projects.get(row.projectId)) || null,
    cycle: (row.retainerCycleId && cycles.get(row.retainerCycleId)) || null,
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
  };
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
      : allowedTaskTransitions(taskState(task, blocked), rights);
  return {
    permissions: {
      canEdit: !readOnly && (rights.manage || ownsOpenRequest(rights, task)),
      canAssign: !readOnly && rights.assign,
      canWork: !readOnly && rights.work,
      canReview: !readOnly && rights.manage,
      canRecordClientResponse: !readOnly && rights.client && !!task.clientId,
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
    },
    allowedTransitions,
  };
}
