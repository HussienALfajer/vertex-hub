import { ForbiddenException } from '@nestjs/common';
import { type Permission, permissionScopes } from '@vertex-hub/contracts';
import { CodedException } from '../../core/errors/index.js';
import type { AuditActor } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import type { ClientSummary } from '../clients/index.js';

/*
 * Who may read and change a client's invoices (spec F13, "Roles and access"). An invoice outside
 * the caller's read access is a 404 (rule 32); a reader without `invoices.manage` gets 403.
 */

export const actorOf = (user: CurrentUserInfo): AuditActor => ({ id: user.id, name: user.name });

export const holdsAll = (actor: CurrentUserInfo, permission: Permission) =>
  permissionScopes(actor.access, permission).includes('all');

/** `permission` covers the client: scope `all`, or `own_clients` as its account manager. */
export function covers(
  actor: CurrentUserInfo,
  permission: 'invoices.read' | 'invoices.manage' | 'payments.manage' | 'expenses.manage',
  client: ClientSummary,
): boolean {
  const scopes = permissionScopes(actor.access, permission);
  if (scopes.includes('all')) return true;
  return scopes.includes('own_clients') && client.accountManagerId === actor.id;
}

export const canManage = (actor: CurrentUserInfo, client: ClientSummary) =>
  covers(actor, 'invoices.manage', client);

export function assertCanManage(actor: CurrentUserInfo, client: ClientSummary): void {
  if (!canManage(actor, client)) throw new ForbiddenException();
}

/** Rule 1: new drafts and issuing need a client that is not archived. */
export function assertClientNotArchived(client: ClientSummary): void {
  if (client.archived) {
    throw new CodedException(409, 'CLIENT_ARCHIVED', 'The client is archived');
  }
}
