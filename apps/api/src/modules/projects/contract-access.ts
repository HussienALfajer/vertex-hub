import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  type Database,
  retainerContractAnnexes,
  retainerContracts,
  type Transaction,
} from '@vertex-hub/db';
import { and, eq } from 'drizzle-orm';
import type { CurrentUserInfo } from '../auth/index.js';
import type { ClientDirectory } from '../clients/index.js';
import { coversClient, seesMoney } from './project-access.js';
import { type RetainerAccess, readableRetainer } from './retainer-access.js';

/*
 * Who reads and changes retainer contracts and annexes (spec F05C, "Roles and access"): readers
 * of the retainer with money access; managers hold client scope too (G3).
 */

export type ContractRow = typeof retainerContracts.$inferSelect;
export type AnnexRow = typeof retainerContractAnnexes.$inferSelect;

/**
 * The retainer of a contract request: 404 outside read access, 403 without money access, or with
 * `manage` without client scope. `forUpdate` locks the retainer row (G2).
 */
export async function contractRetainer(
  executor: Database | Transaction,
  clients: ClientDirectory,
  actor: CurrentUserInfo,
  retainerId: string,
  options: { manage?: boolean; forUpdate?: boolean } = {},
): Promise<RetainerAccess> {
  const retainer = await readableRetainer(executor, clients, actor, retainerId, options);
  if (!seesMoney(actor, retainer.client)) throw new ForbiddenException();
  if (options.manage && !coversClient(actor, retainer.client)) throw new ForbiddenException();
  return retainer;
}

/** Contract managers of a live retainer: client scope with money access. */
export const canManageContracts = (actor: CurrentUserInfo, retainer: RetainerAccess) =>
  !retainer.archivedAt &&
  !retainer.client.archived &&
  coversClient(actor, retainer.client) &&
  seesMoney(actor, retainer.client);

/** A contract of the retainer, discarded drafts included; 404 otherwise. */
export async function contractOf(
  executor: Database | Transaction,
  retainerId: string,
  contractId: string,
  options: { forUpdate?: boolean } = {},
): Promise<ContractRow> {
  const query = executor
    .select()
    .from(retainerContracts)
    .where(and(eq(retainerContracts.id, contractId), eq(retainerContracts.retainerId, retainerId)));
  const [row] = options.forUpdate ? await query.for('update') : await query;
  if (!row) throw new NotFoundException();
  return row;
}

/** An annex of the contract; 404 otherwise. */
export async function annexOf(
  executor: Database | Transaction,
  contractId: string,
  annexId: string,
  options: { forUpdate?: boolean } = {},
): Promise<AnnexRow> {
  const query = executor
    .select()
    .from(retainerContractAnnexes)
    .where(
      and(
        eq(retainerContractAnnexes.id, annexId),
        eq(retainerContractAnnexes.contractId, contractId),
      ),
    );
  const [row] = options.forUpdate ? await query.for('update') : await query;
  if (!row) throw new NotFoundException();
  return row;
}
