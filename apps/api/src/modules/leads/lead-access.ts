import { permissionScopes } from '@vertex-hub/contracts';
import type { AuditActor } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';

/*
 * Who may read and change a lead (spec F03, "Roles and access"): scope `all`, or `assigned` as
 * the lead's owner. A lead outside the caller's read access is a 404; a reader without
 * `leads.manage` over it gets 403. Archived leads are seen by `leads.manage` scope all only.
 */

export const actorOf = (user: CurrentUserInfo): AuditActor => ({ id: user.id, name: user.name });

export function coversLead(
  actor: CurrentUserInfo,
  permission: 'leads.read' | 'leads.manage',
  lead: { ownerId: string },
): boolean {
  const scopes = permissionScopes(actor.access, permission);
  return scopes.includes('all') || (scopes.includes('assigned') && lead.ownerId === actor.id);
}

export const holdsAll = (actor: CurrentUserInfo, permission: 'leads.read' | 'leads.manage') =>
  permissionScopes(actor.access, permission).includes('all');

/** Rule 12: archived leads are for lead managers with scope all. */
export function readsLead(
  actor: CurrentUserInfo,
  lead: { ownerId: string; archivedAt: Date | null },
): boolean {
  if (lead.archivedAt) return holdsAll(actor, 'leads.manage');
  return coversLead(actor, 'leads.read', lead);
}

/**
 * Quote scope on a lead quote (ADR 0026): scope `all`, or `own_clients` as the lead's owner.
 */
export function coversLeadQuotes(
  actor: CurrentUserInfo,
  permission: 'quotes.read' | 'quotes.manage',
  lead: { ownerId: string },
): boolean {
  const scopes = permissionScopes(actor.access, permission);
  return scopes.includes('all') || (scopes.includes('own_clients') && lead.ownerId === actor.id);
}
