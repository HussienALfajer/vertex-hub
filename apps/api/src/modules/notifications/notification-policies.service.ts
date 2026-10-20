import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type ChannelPolicies,
  NOTIFICATION_CATALOG,
  NOTIFICATION_TYPES,
  type NotificationPolicy,
  type NotificationPolicyList,
  type NotificationType,
  notificationTypeSchema,
  type UpdateNotificationPolicy,
} from '@vertex-hub/contracts';
import { type Database, notificationPolicies, type Transaction } from '@vertex-hub/db';
import { eq } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';

/** The audit entity id of the channel policy, which has no id of its own; entries name the type. */
export const NOTIFICATION_POLICY_ENTITY_ID = '01a0e97d-0000-7000-8000-00000000f016';

type PolicyRow = typeof notificationPolicies.$inferSelect;

/**
 * F16 rules B1–B2: the push and email modes management sets per type. A type without a row uses
 * the catalog defaults; a reset deletes its row. A change applies to notifications created after
 * it, and each one is audited.
 */
@Injectable()
export class NotificationPolicies {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
  ) {}

  /** The modes in force, by type, for `notify` and the settings. */
  async current(executor: Database | Transaction = this.db): Promise<ChannelPolicies> {
    const rows = await executor.select().from(notificationPolicies);
    return Object.fromEntries(rows.map((row) => [row.type, { push: row.push, email: row.email }]));
  }

  async list(): Promise<NotificationPolicyList> {
    const rows = await this.db.select().from(notificationPolicies);
    return { items: await this.responses(rows, NOTIFICATION_TYPES) };
  }

  async update(
    actor: CurrentUserInfo,
    typeParam: string,
    input: UpdateNotificationPolicy,
  ): Promise<NotificationPolicy> {
    const parsed = notificationTypeSchema.safeParse(typeParam);
    if (!parsed.success) throw new NotFoundException('Notification type not found');
    const type = parsed.data;
    const { push, email } = NOTIFICATION_CATALOG[type];
    const row = await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(notificationPolicies)
        .where(eq(notificationPolicies.type, type))
        .for('update');
      const before = current ? { push: current.push, email: current.email } : { push, email };
      const after = 'reset' in input ? { push, email } : { push: input.push, email: input.email };
      let saved: PolicyRow | undefined;
      if ('reset' in input) {
        await tx.delete(notificationPolicies).where(eq(notificationPolicies.type, type));
      } else {
        [saved] = await tx
          .insert(notificationPolicies)
          .values({ type, ...after, updatedById: actor.id })
          .onConflictDoUpdate({
            target: notificationPolicies.type,
            set: { ...after, updatedById: actor.id, updatedAt: new Date() },
          })
          .returning();
      }
      if (before.push !== after.push || before.email !== after.email) {
        await recordAudit(tx, {
          actor: { id: actor.id, name: actor.name },
          action: 'notification_policy.updated',
          entityType: 'notification_policy',
          entityId: NOTIFICATION_POLICY_ENTITY_ID,
          before: { type, ...before },
          after: { type, ...after },
        });
      }
      return saved;
    });
    const [response] = await this.responses(row ? [row] : [], [type]);
    if (!response) throw new NotFoundException('Notification type not found');
    return response;
  }

  private async responses(
    rows: PolicyRow[],
    types: readonly NotificationType[],
  ): Promise<NotificationPolicy[]> {
    const byType = new Map(rows.map((row) => [row.type, row]));
    const editors = await this.users.summaries(rows.map((row) => row.updatedById));
    return types.map((type) => {
      const { category, priority, push, email } = NOTIFICATION_CATALOG[type];
      const row = byType.get(type);
      const editor = row ? editors.get(row.updatedById) : undefined;
      return {
        type,
        category,
        priority,
        defaults: { push, email },
        push: row?.push ?? push,
        email: row?.email ?? email,
        updatedBy: editor ? { id: editor.id, name: editor.name } : null,
        updatedAt: row?.updatedAt.toISOString() ?? null,
      };
    });
  }
}
