import { permissionScopes } from '@vertex-hub/contracts';
import type { AuditActor } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import type { ClientSummary } from '../clients/index.js';

/*
 * Who may read and change a client's campaigns (spec F12, "Roles and access"). A campaign outside
 * the caller's read access is a 404; a reader without `campaigns.manage` gets 403 (rule 25).
 */

export const actorOf = (user: CurrentUserInfo): AuditActor => ({ id: user.id, name: user.name });

/** `permission` covers the client: scope `all`, or `own_clients` as its account manager. */
export function covers(
  actor: CurrentUserInfo,
  permission: 'campaigns.read' | 'campaigns.manage' | 'campaigns.fund',
  client: ClientSummary,
): boolean {
  const scopes = permissionScopes(actor.access, permission);
  if (scopes.includes('all')) return true;
  return scopes.includes('own_clients') && client.accountManagerId === actor.id;
}

export const readsAll = (actor: CurrentUserInfo) =>
  permissionScopes(actor.access, 'campaigns.read').includes('all');
