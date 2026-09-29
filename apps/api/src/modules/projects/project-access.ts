import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  isProjectClosed,
  type Permission,
  type ProjectPermissions,
  type ProjectStatus,
  permissionScopes,
} from '@vertex-hub/contracts';
import { type Database, projects, type Transaction } from '@vertex-hub/db';
import { eq } from 'drizzle-orm';
import { CodedException } from '../../core/errors/index.js';
import type { AuditActor } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import type { ClientDirectory, ClientSummary } from '../clients/index.js';

/*
 * Who may read, change and see the money of a client's projects (spec F05, "Roles and access").
 */

export const actorOf = (user: CurrentUserInfo): AuditActor => ({ id: user.id, name: user.name });

/** Holds `permission` over every record: `projects.manage` scope-all actions. */
export const holdsAll = (actor: CurrentUserInfo, permission: Permission) =>
  permissionScopes(actor.access, permission).includes('all');

/**
 * Client scope: `projects.manage` with scope `all`, or `own_clients` on a non-archived client the
 * actor is primary account manager of.
 */
export function coversClient(actor: CurrentUserInfo, client: ClientSummary): boolean {
  const scopes = permissionScopes(actor.access, 'projects.manage');
  if (scopes.includes('all')) return true;
  return scopes.includes('own_clients') && !client.archived && client.accountManagerId === actor.id;
}

/** Money access: `invoices.read` covering the client (M1). */
export function seesMoney(actor: CurrentUserInfo, client: ClientSummary): boolean {
  const scopes = permissionScopes(actor.access, 'invoices.read');
  if (scopes.includes('all')) return true;
  return scopes.includes('own_clients') && client.accountManagerId === actor.id;
}

/**
 * Any request that sets a money field needs money access (M1) and client scope ("Set money
 * fields" in the actions table).
 */
export function assertCanEditMoney(actor: CurrentUserInfo, client: ClientSummary): void {
  if (!seesMoney(actor, client) || !coversClient(actor, client)) throw new ForbiddenException();
}

/** A project with the fields that decide access, and its client. */
export interface ProjectAccess {
  id: string;
  name: string;
  clientId: string;
  projectManagerId: string;
  status: ProjectStatus;
  archivedAt: Date | null;
  client: ClientSummary;
}

/** The project manager of a non-archived project (rule 3, the `assigned` scope). */
function managesProject(actor: CurrentUserInfo, project: ProjectAccess): boolean {
  return (
    permissionScopes(actor.access, 'projects.manage').includes('assigned') &&
    !project.archivedAt &&
    project.projectManagerId === actor.id
  );
}

/** Client scope or project manager: edits, milestones, status except cancel and reopen. */
export const canWork = (actor: CurrentUserInfo, project: ProjectAccess) =>
  coversClient(actor, project.client) || managesProject(actor, project);

/**
 * Loads a project the actor may read, else 404. An archived project, or one of an archived
 * client (G2), is readable by scope-all holders only. `forUpdate` locks the project row.
 */
export async function readableProject(
  executor: Database | Transaction,
  clientDirectory: ClientDirectory,
  actor: CurrentUserInfo,
  id: string,
  options: { forUpdate?: boolean } = {},
): Promise<ProjectAccess> {
  const query = executor
    .select({
      id: projects.id,
      name: projects.name,
      clientId: projects.clientId,
      projectManagerId: projects.projectManagerId,
      status: projects.status,
      archivedAt: projects.archivedAt,
    })
    .from(projects)
    .where(eq(projects.id, id));
  const [row] = options.forUpdate ? await query.for('update') : await query;
  if (!row || !permissionScopes(actor.access, 'projects.read').includes('all')) {
    throw new NotFoundException();
  }
  const client = await clientDirectory.summary(row.clientId, executor);
  if (!client) throw new NotFoundException();
  if ((row.archivedAt || client.archived) && !holdsAll(actor, 'projects.manage')) {
    throw new NotFoundException();
  }
  return { ...row, client };
}

/**
 * Refuses changes to a read-only project: archived (rule 7), of an archived client (G2), or
 * completed or cancelled (rule 7).
 */
export function assertWritable(project: ProjectAccess): void {
  assertNotArchived(project);
  if (isProjectClosed(project.status)) {
    throw new CodedException(409, 'PROJECT_CLOSED', 'Reopen the project before changing it');
  }
}

export function assertNotArchived(project: ProjectAccess): void {
  if (project.archivedAt) {
    throw new CodedException(409, 'PROJECT_ARCHIVED', 'Restore the project before changing it');
  }
  if (project.client.archived) {
    throw new CodedException(409, 'CLIENT_ARCHIVED', 'Restore the client before changing its work');
  }
}

/**
 * Locks a project the actor may work on (client scope or project manager) and that is writable.
 * Access is checked before state, so a caller without access never learns the project's state.
 */
export async function workableProject(
  tx: Transaction,
  clientDirectory: ClientDirectory,
  actor: CurrentUserInfo,
  id: string,
): Promise<ProjectAccess> {
  const project = await readableProject(tx, clientDirectory, actor, id, { forUpdate: true });
  if (!canWork(actor, project)) throw new ForbiddenException();
  assertWritable(project);
  return project;
}

/** The flags the UI uses to show actions; the API checks each action again. */
export function projectPermissions(
  actor: CurrentUserInfo,
  project: ProjectAccess,
): ProjectPermissions {
  const readOnly = !!project.archivedAt || project.client.archived;
  const clientScope = coversClient(actor, project.client);
  const closed = isProjectClosed(project.status);
  const canManage = !readOnly && !closed && canWork(actor, project);
  const canSeeMoney = seesMoney(actor, project.client);
  return {
    canManage,
    canChangeManager: canManage && clientScope,
    canCancel: canManage && clientScope,
    canReopen: !readOnly && closed && holdsAll(actor, 'projects.manage'),
    canArchive: holdsAll(actor, 'projects.manage'),
    canSeeMoney,
    canEditMoney: canManage && clientScope && canSeeMoney,
  };
}
