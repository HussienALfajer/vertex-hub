import { ForbiddenException } from '@nestjs/common';
import { hasPermission, type Permission, permissionScopes } from '@vertex-hub/contracts';
import { CodedException } from '../../core/errors/index.js';
import type { AuditActor } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import type { ClientSummary } from '../clients/index.js';

/*
 * Who may read and change a client's quotes (spec F04, "Roles and access"). A quote outside the
 * caller's read access is a 404; a reader without client scope gets 403 on changes.
 */

export const actorOf = (user: CurrentUserInfo): AuditActor => ({ id: user.id, name: user.name });

export const holdsAll = (actor: CurrentUserInfo, permission: Permission) =>
  permissionScopes(actor.access, permission).includes('all');

/** `permission` covers the client: scope `all`, or `own_clients` as its account manager (G3). */
export function covers(
  actor: CurrentUserInfo,
  permission: 'quotes.read' | 'quotes.manage',
  client: ClientSummary,
): boolean {
  const scopes = permissionScopes(actor.access, permission);
  if (scopes.includes('all')) return true;
  return scopes.includes('own_clients') && client.accountManagerId === actor.id;
}

/** Discarded drafts are visible to scope-all readers only. */
export function canRead(
  actor: CurrentUserInfo,
  client: ClientSummary,
  quote: { archivedAt: Date | null },
): boolean {
  if (quote.archivedAt) return holdsAll(actor, 'quotes.read');
  return covers(actor, 'quotes.read', client);
}

/** Client scope for changes: `quotes.manage` covering a client that is not archived (G2). */
export function canManage(actor: CurrentUserInfo, client: ClientSummary): boolean {
  return !client.archived && covers(actor, 'quotes.manage', client);
}

export function assertCanManage(actor: CurrentUserInfo, client: ClientSummary): void {
  if (!covers(actor, 'quotes.manage', client)) throw new ForbiddenException();
  if (client.archived) {
    throw new CodedException(409, 'CLIENT_ARCHIVED', 'The client is archived');
  }
}

/**
 * A1: recording an acceptance also needs `projects.manage` over the client (scope `all`, or
 * `own_clients` as its account manager), since it creates the engagements.
 */
export function coversEngagements(actor: CurrentUserInfo, client: ClientSummary): boolean {
  const scopes = permissionScopes(actor.access, 'projects.manage');
  if (scopes.includes('all')) return true;
  return scopes.includes('own_clients') && client.accountManagerId === actor.id;
}

export const approvesDiscounts = (actor: CurrentUserInfo) =>
  hasPermission(actor.access, 'quotes.approve_discount');

/** Rule 1: quotes are made, sent and accepted only for an active or paused client. */
export function assertClientTakesQuotes(client: ClientSummary): void {
  if (client.archived) {
    throw new CodedException(409, 'CLIENT_ARCHIVED', 'The client is archived');
  }
  if (client.status === 'ended') {
    throw new CodedException(409, 'CLIENT_ENDED', 'Quotes are not made for an ended client');
  }
}
