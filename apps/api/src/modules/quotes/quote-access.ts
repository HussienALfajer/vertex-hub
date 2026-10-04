import { ForbiddenException } from '@nestjs/common';
import { hasPermission, type Permission, permissionScopes } from '@vertex-hub/contracts';
import { CodedException } from '../../core/errors/index.js';
import type { AuditActor } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import type { ClientSummary } from '../clients/index.js';
import type { LeadSummary } from '../leads/index.js';

/*
 * Who may read and change a client's quotes (spec F04, "Roles and access"). A quote outside the
 * caller's read access is a 404; a reader without client scope gets 403 on changes. A quote on a
 * lead not converted yet is covered through the lead's owner (spec F03, ADR 0026).
 */

/** Whom a quote is for: its client, or its lead until the lead is converted. */
export type Recipient =
  | (ClientSummary & { kind: 'client' })
  | {
      kind: 'lead';
      id: string;
      /** The lead's display name. */
      name: string;
      contactName: string;
      /** The lead's owner: `own_clients` covers the quote as the owner (ADR 0026). */
      accountManagerId: string;
      archived: boolean;
      /** Rule 14: quotes are made, sent and accepted only on an open lead. */
      open: boolean;
    };

export const clientRecipient = (client: ClientSummary): Recipient => ({
  ...client,
  kind: 'client',
});

export const leadRecipient = (lead: LeadSummary): Recipient => ({
  kind: 'lead',
  id: lead.id,
  name: lead.displayName,
  contactName: lead.contactName,
  accountManagerId: lead.ownerId,
  archived: lead.archived,
  open: lead.open,
});

/** The code every change answers when the recipient is archived. */
export function archivedError(recipient: Recipient): CodedException {
  return recipient.kind === 'lead'
    ? new CodedException(409, 'LEAD_ARCHIVED', 'The lead is archived')
    : new CodedException(409, 'CLIENT_ARCHIVED', 'The client is archived');
}

/** What a PDF prints as the recipient: the client and the addressee, or the lead and its contact. */
export function snapshotParty(recipient: Recipient, addressee: string | null) {
  return recipient.kind === 'lead'
    ? { client: recipient.name, addressee: recipient.contactName }
    : { client: recipient.name, addressee };
}

export const actorOf = (user: CurrentUserInfo): AuditActor => ({ id: user.id, name: user.name });

export const holdsAll = (actor: CurrentUserInfo, permission: Permission) =>
  permissionScopes(actor.access, permission).includes('all');

/**
 * `permission` covers the recipient: scope `all`, or `own_clients` as the client's account
 * manager (G3) or the lead's owner.
 */
export function covers(
  actor: CurrentUserInfo,
  permission: 'quotes.read' | 'quotes.manage',
  client: Pick<Recipient, 'accountManagerId'>,
): boolean {
  const scopes = permissionScopes(actor.access, permission);
  if (scopes.includes('all')) return true;
  return scopes.includes('own_clients') && client.accountManagerId === actor.id;
}

/** Discarded drafts are visible to scope-all readers only. */
export function canRead(
  actor: CurrentUserInfo,
  client: Recipient,
  quote: { archivedAt: Date | null },
): boolean {
  if (quote.archivedAt) return holdsAll(actor, 'quotes.read');
  return covers(actor, 'quotes.read', client);
}

/** Client scope for changes: `quotes.manage` covering a recipient that is not archived (G2). */
export function canManage(actor: CurrentUserInfo, client: Recipient): boolean {
  return !client.archived && covers(actor, 'quotes.manage', client);
}

export function assertCanManage(actor: CurrentUserInfo, client: Recipient): void {
  if (!covers(actor, 'quotes.manage', client)) throw new ForbiddenException();
  if (client.archived) throw archivedError(client);
}

/**
 * A1: recording an acceptance also needs `projects.manage` over the client (scope `all`, or
 * `own_clients` as its account manager), since it creates the engagements.
 */
export function coversEngagements(
  actor: CurrentUserInfo,
  client: Pick<Recipient, 'accountManagerId'>,
): boolean {
  const scopes = permissionScopes(actor.access, 'projects.manage');
  if (scopes.includes('all')) return true;
  return scopes.includes('own_clients') && client.accountManagerId === actor.id;
}

export const approvesDiscounts = (actor: CurrentUserInfo) =>
  hasPermission(actor.access, 'quotes.approve_discount');

/**
 * Rule 1: quotes are made, sent and accepted only for an active or paused client, or an open,
 * non-archived lead (F03 rule 14).
 */
export function assertTakesQuotes(client: Recipient): void {
  if (client.archived) throw archivedError(client);
  if (client.kind === 'lead') {
    if (!client.open) throw new CodedException(409, 'LEAD_CLOSED', 'The lead is won or lost');
    return;
  }
  if (client.status === 'ended') {
    throw new CodedException(409, 'CLIENT_ENDED', 'Quotes are not made for an ended client');
  }
}
