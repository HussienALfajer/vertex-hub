import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { type Permission, permissionScopes } from '@vertex-hub/contracts';
import { type Database, shootCrew, shoots, type Transaction } from '@vertex-hub/db';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { CodedException } from '../../core/errors/index.js';
import type { AuditActor } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import type { ClientSummary } from '../clients/index.js';

/*
 * Who may read and change a shoot (spec F11, "Roles and access" and "Scopes").
 */

type Executor = Database | Transaction;

export type ShootRow = typeof shoots.$inferSelect;

export type CrewRow = typeof shootCrew.$inferSelect;

export const actorOf = (user: CurrentUserInfo): AuditActor => ({ id: user.id, name: user.name });

/** Holds `permission` over every record. */
export const holdsAll = (actor: CurrentUserInfo, permission: Permission) =>
  permissionScopes(actor.access, permission).includes('all');

/**
 * `own_clients` covers a record of a client the user is primary account manager of; a record
 * without a client is covered only by `all`.
 */
export function coversClient(
  actor: CurrentUserInfo,
  permission: Permission,
  client: Pick<ClientSummary, 'accountManagerId'> | null,
): boolean {
  const scopes = permissionScopes(actor.access, permission);
  return (
    scopes.includes('all') ||
    (!!client && scopes.includes('own_clients') && client.accountManagerId === actor.id)
  );
}

/**
 * Loads a shoot, else 404. An archived shoot is visible to scope-all holders of `shoots.manage`
 * only. `forUpdate` locks the shoot row: the lock every change of the shoot, its crew and its
 * shots takes first.
 */
export async function readableShoot(
  executor: Executor,
  actor: CurrentUserInfo,
  id: string,
  options: { forUpdate?: boolean } = {},
): Promise<ShootRow> {
  const query = executor.select().from(shoots).where(eq(shoots.id, id));
  const [row] = options.forUpdate ? await query.for('update') : await query;
  if (!row || (row.archivedAt && !holdsAll(actor, 'shoots.manage'))) {
    throw new NotFoundException();
  }
  return row;
}

/** The team crew of each shoot: the lead first, then by when they were added. */
export async function crewOf(
  executor: Executor,
  shootIds: readonly string[],
): Promise<Map<string, CrewRow[]>> {
  const byShoot = new Map<string, CrewRow[]>();
  if (shootIds.length === 0) return byShoot;
  const rows = await executor
    .select()
    .from(shootCrew)
    .where(inArray(shootCrew.shootId, [...new Set(shootIds)]))
    .orderBy(desc(shootCrew.isLead), asc(shootCrew.createdAt), asc(shootCrew.userId));
  for (const row of rows) byShoot.set(row.shootId, [...(byShoot.get(row.shootId) ?? []), row]);
  return byShoot;
}

/** 403 unless `shoots.manage` covers the shoot's client (shoot scope). */
export function assertShootScope(actor: CurrentUserInfo, client: ClientSummary | null): void {
  if (!coversClient(actor, 'shoots.manage', client)) throw new ForbiddenException();
}

/** Rule 8: changes only while scheduled and not archived. */
export function assertScheduled(shoot: ShootRow): void {
  if (shoot.archivedAt) {
    throw new CodedException(409, 'SHOOT_ARCHIVED', 'The shoot is archived');
  }
  if (shoot.status !== 'scheduled') {
    throw new CodedException(409, 'SHOOT_NOT_SCHEDULED', 'The shoot is no longer scheduled');
  }
}
