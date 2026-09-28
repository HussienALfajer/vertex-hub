import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { type Permission, permissionScopes } from '@vertex-hub/contracts';
import { clients, type Database, type Transaction } from '@vertex-hub/db';
import { eq, type SQL, sql } from 'drizzle-orm';
import { CodedException } from '../../core/errors/index.js';
import type { AuditActor } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';

/** The client fields that decide who may read or change it. */
export interface ClientAccessRow {
  id: string;
  accountManagerId: string;
  archivedAt: Date | null;
}

export const actorOf = (user: CurrentUserInfo): AuditActor => ({ id: user.id, name: user.name });

/** Holds `permission` over every client: scope-all actions (F02 rule 5). */
export const holdsAll = (actor: CurrentUserInfo, permission: Permission) =>
  permissionScopes(actor.access, permission).includes('all');

/**
 * Whether `permission` covers the client: scope `all`, or `own_clients` on a non-archived client
 * the actor is primary account manager of (rule 4). Archived clients are for scope all only.
 */
export function covers(
  actor: CurrentUserInfo,
  permission: Permission,
  client: ClientAccessRow,
): boolean {
  const scopes = permissionScopes(actor.access, permission);
  if (scopes.includes('all')) return true;
  return (
    scopes.includes('own_clients') && !client.archivedAt && client.accountManagerId === actor.id
  );
}

/** SQL filter on `clients` for the clients the actor may read, archived ones excluded. */
export function readableClients(actor: CurrentUserInfo): SQL | undefined {
  const scopes = permissionScopes(actor.access, 'clients.read');
  if (scopes.includes('all')) return undefined;
  if (scopes.includes('own_clients')) return eq(clients.accountManagerId, actor.id);
  return sql`false`;
}

const accessColumns = {
  id: clients.id,
  accountManagerId: clients.accountManagerId,
  archivedAt: clients.archivedAt,
};

/**
 * Loads a client the actor may read, else 404 (an archived client is readable by
 * `clients.manage` scope-all holders only). `forUpdate` locks the row.
 */
export async function readableClient(
  executor: Database | Transaction,
  actor: CurrentUserInfo,
  id: string,
  options: { forUpdate?: boolean } = {},
): Promise<ClientAccessRow> {
  const query = executor.select(accessColumns).from(clients).where(eq(clients.id, id));
  const [client] = options.forUpdate ? await query.for('update') : await query;
  if (!client) throw new NotFoundException();
  const visible = client.archivedAt
    ? holdsAll(actor, 'clients.manage')
    : covers(actor, 'clients.read', client);
  if (!visible) throw new NotFoundException();
  return client;
}

/** Refuses any change to an archived client (rule 7). */
export function assertNotArchived(client: ClientAccessRow): void {
  if (client.archivedAt) {
    throw new CodedException(409, 'CLIENT_ARCHIVED', 'Restore the client before changing it');
  }
}

/**
 * Locks a client the actor may edit (basics, contacts, brand kit, platform accounts): readable,
 * not archived, and covered by `clients.manage`.
 */
export async function manageableClient(
  tx: Transaction,
  actor: CurrentUserInfo,
  id: string,
): Promise<ClientAccessRow> {
  const client = await readableClient(tx, actor, id, { forUpdate: true });
  assertNotArchived(client);
  if (!covers(actor, 'clients.manage', client)) throw new ForbiddenException();
  return client;
}
