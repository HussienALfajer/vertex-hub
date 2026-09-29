import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  type Currency,
  permissionScopes,
  type RetainerPermissions,
  type RetainerStatus,
} from '@vertex-hub/contracts';
import { type Database, retainers, type Transaction } from '@vertex-hub/db';
import { eq } from 'drizzle-orm';
import { CodedException } from '../../core/errors/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import type { ClientDirectory, ClientSummary } from '../clients/index.js';
import { coversClient, holdsAll, seesMoney } from './project-access.js';

/*
 * Who may read and change a client's retainers (spec F05, "Roles and access"). Retainers have no
 * `assigned` scope: only client scope manages them.
 */

/** A retainer with the fields that decide access, and its client. */
export interface RetainerAccess {
  id: string;
  name: string;
  clientId: string;
  status: RetainerStatus;
  startDate: string;
  currency: Currency;
  archivedAt: Date | null;
  client: ClientSummary;
}

/**
 * Loads a retainer the actor may read, else 404. An archived retainer, or one of an archived
 * client (G2), is readable by scope-all holders only. `forUpdate` locks the retainer row.
 */
export async function readableRetainer(
  executor: Database | Transaction,
  clientDirectory: ClientDirectory,
  actor: CurrentUserInfo,
  id: string,
  options: { forUpdate?: boolean } = {},
): Promise<RetainerAccess> {
  const query = executor
    .select({
      id: retainers.id,
      name: retainers.name,
      clientId: retainers.clientId,
      status: retainers.status,
      startDate: retainers.startDate,
      currency: retainers.currency,
      archivedAt: retainers.archivedAt,
    })
    .from(retainers)
    .where(eq(retainers.id, id));
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

/** R12: an archived retainer, or one of an archived client (G2), is read-only. */
export function assertRetainerNotArchived(retainer: RetainerAccess): void {
  if (retainer.archivedAt) {
    throw new CodedException(409, 'RETAINER_ARCHIVED', 'Restore the retainer before changing it');
  }
  if (retainer.client.archived) {
    throw new CodedException(409, 'CLIENT_ARCHIVED', 'Restore the client before changing its work');
  }
}

/** R12: an ended retainer is read-only except reactivation. */
export function assertRetainerWritable(retainer: RetainerAccess): void {
  assertRetainerNotArchived(retainer);
  if (retainer.status === 'ended') {
    throw new CodedException(409, 'RETAINER_ENDED', 'Reactivate the retainer before changing it');
  }
}

/**
 * Locks a retainer the actor manages (client scope) and that is writable. Access is checked
 * before state, so a caller without access never learns the retainer's state.
 */
export async function workableRetainer(
  tx: Transaction,
  clientDirectory: ClientDirectory,
  actor: CurrentUserInfo,
  id: string,
): Promise<RetainerAccess> {
  const retainer = await readableRetainer(tx, clientDirectory, actor, id, { forUpdate: true });
  if (!coversClient(actor, retainer.client)) throw new ForbiddenException();
  assertRetainerWritable(retainer);
  return retainer;
}

/** The flags the UI uses to show actions; the API checks each action again. */
export function retainerPermissions(
  actor: CurrentUserInfo,
  retainer: RetainerAccess,
): RetainerPermissions {
  const readOnly = !!retainer.archivedAt || retainer.client.archived;
  const canManage =
    !readOnly && retainer.status !== 'ended' && coversClient(actor, retainer.client);
  const canSeeMoney = seesMoney(actor, retainer.client);
  return {
    canManage,
    canReactivate: !readOnly && retainer.status === 'ended' && holdsAll(actor, 'projects.manage'),
    canArchive: holdsAll(actor, 'projects.manage'),
    canSeeMoney,
    canEditMoney: canManage && canSeeMoney,
    canBill: !readOnly && coversClient(actor, retainer.client) && canSeeMoney,
  };
}
