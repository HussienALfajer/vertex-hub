import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  CLIENT_LIMITS,
  type CreatePlatformAccount,
  type PlatformAccount,
  type UpdatePlatformAccount,
} from '@vertex-hub/contracts';
import { clientPlatformAccounts, type Database, type Transaction } from '@vertex-hub/db';
import { and, count, eq, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { changedFields, recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { actorOf, manageableClient } from './client-access.js';

const accountColumns = {
  id: clientPlatformAccounts.id,
  clientId: clientPlatformAccounts.clientId,
  platform: clientPlatformAccounts.platform,
  label: clientPlatformAccounts.label,
  url: clientPlatformAccounts.url,
  agencyAccess: clientPlatformAccounts.agencyAccess,
  adminNote: clientPlatformAccounts.adminNote,
};

/** The client's social and web accounts and the agency's access to them. No passwords. */
@Injectable()
export class ClientPlatformAccountsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(
    actor: CurrentUserInfo,
    clientId: string,
    input: CreatePlatformAccount,
  ): Promise<PlatformAccount> {
    return this.db.transaction(async (tx) => {
      await manageableClient(tx, actor, clientId);
      const [existing] = await tx
        .select({ value: count() })
        .from(clientPlatformAccounts)
        .where(
          and(
            eq(clientPlatformAccounts.clientId, clientId),
            isNull(clientPlatformAccounts.archivedAt),
          ),
        );
      if ((existing?.value ?? 0) >= CLIENT_LIMITS.platformAccounts) {
        throw new CodedException(
          409,
          'LIMIT_REACHED',
          'The client has the maximum of platform accounts',
        );
      }
      const values = {
        platform: input.platform,
        label: input.label ?? null,
        url: input.url,
        agencyAccess: input.agencyAccess ?? 'none',
        adminNote: input.adminNote ?? null,
      };
      const [account] = await tx
        .insert(clientPlatformAccounts)
        .values({ clientId, ...values })
        .returning(accountColumns);
      if (!account) throw new Error('Platform account insert returned no row');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'client_platform_account.created',
        entityType: 'client_platform_account',
        entityId: account.id,
        after: { clientId, ...values },
      });
      return account;
    });
  }

  async update(
    actor: CurrentUserInfo,
    clientId: string,
    accountId: string,
    input: UpdatePlatformAccount,
  ): Promise<PlatformAccount> {
    return this.db.transaction(async (tx) => {
      await manageableClient(tx, actor, clientId);
      const current = await this.activeAccount(tx, clientId, accountId);
      const platform = input.platform ?? current.platform;
      const label = input.label !== undefined ? input.label : current.label;
      if (platform === 'other' && !label) {
        throw new BadRequestException('An other platform needs a label');
      }
      const change = changedFields(current, input);
      if (!change) return current;
      const [account] = await tx
        .update(clientPlatformAccounts)
        .set(change.after)
        .where(eq(clientPlatformAccounts.id, accountId))
        .returning(accountColumns);
      if (!account) throw new NotFoundException();
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'client_platform_account.updated',
        entityType: 'client_platform_account',
        entityId: accountId,
        before: change.before,
        after: { clientId, ...change.after },
      });
      return account;
    });
  }

  async archive(actor: CurrentUserInfo, clientId: string, accountId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await manageableClient(tx, actor, clientId);
      const current = await this.activeAccount(tx, clientId, accountId);
      await tx
        .update(clientPlatformAccounts)
        .set({ archivedAt: new Date() })
        .where(eq(clientPlatformAccounts.id, accountId));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'client_platform_account.archived',
        entityType: 'client_platform_account',
        entityId: accountId,
        before: { platform: current.platform, url: current.url },
        after: { clientId },
      });
    });
  }

  private async activeAccount(tx: Transaction, clientId: string, accountId: string) {
    const [account] = await tx
      .select(accountColumns)
      .from(clientPlatformAccounts)
      .where(
        and(
          eq(clientPlatformAccounts.id, accountId),
          eq(clientPlatformAccounts.clientId, clientId),
          isNull(clientPlatformAccounts.archivedAt),
        ),
      )
      .for('update');
    if (!account) throw new NotFoundException();
    return account;
  }
}
