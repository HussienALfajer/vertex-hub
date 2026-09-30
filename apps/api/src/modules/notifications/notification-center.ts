import { Injectable } from '@nestjs/common';
import {
  firstMatchPerRecipient,
  NOTIFICATION_CATALOG,
  NOTIFICATION_DATA_SCHEMAS,
  type NotificationContent,
  type NotificationType,
} from '@vertex-hub/contracts';
import { newId, notificationSettings, notifications, type Transaction } from '@vertex-hub/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { UserDirectory } from '../auth/index.js';
import { NOTIFICATIONS_CHANNEL, pushPayloads } from './notification-channel.js';

/** One type of notification for one change, as the owning module resolved its recipients. */
export type Notice = NotificationContent & {
  recipients: readonly string[];
  /** Null for the daily job and automatic runs. */
  actorId: string | null;
  /** The record the notification opens; its type comes from the catalog. */
  subjectId: string;
};

/**
 * Stores notifications inside the transaction of the change that causes them (spec F14 rule 1).
 * Modules that emit import this; it never reads their tables.
 */
@Injectable()
export class NotificationCenter {
  constructor(private readonly users: UserDirectory) {}

  /**
   * Rule 2: drops the actor, archived users, duplicates and recipients who muted the type; when
   * the notices give one recipient several types for one subject, keeps only the first by the
   * catalog order (other subjects and several notices of that type all stay). Rule
   * 5: merges a comment into the recipient's unread comment notification on the same task. The
   * `pg_notify` runs in the transaction, so PostgreSQL delivers it only on commit (rule 4).
   * Returns the number of notifications stored or merged.
   */
  async notify(tx: Transaction, notices: Notice | readonly Notice[]): Promise<number> {
    const list = Array.isArray(notices) ? (notices as readonly Notice[]) : [notices as Notice];
    const candidates = list.flatMap((notice) =>
      [...new Set(notice.recipients)]
        .filter((recipientId) => recipientId !== notice.actorId)
        .map((recipientId) => ({
          recipientId,
          subjectId: notice.subjectId,
          type: notice.type,
          notice,
        })),
    );
    if (candidates.length === 0) return 0;

    const recipientIds = [...new Set(candidates.map((candidate) => candidate.recipientId))];
    const people = await this.users.summaries(recipientIds, tx);
    const muted = await this.mutedTypes(tx, recipientIds);
    // Filters first, in rule 2's order: a muted type leaves room for the next type of the change.
    const deliverable = firstMatchPerRecipient(
      candidates.filter(
        ({ recipientId, type }) =>
          people.get(recipientId)?.archived === false && !muted.get(recipientId)?.has(type),
      ),
    );

    const pushed: { recipientId: string; notificationId: string }[] = [];
    for (const { recipientId, notice } of deliverable) {
      const data = NOTIFICATION_DATA_SCHEMAS[notice.type].parse(notice.data);
      const merged =
        notice.type === 'task_commented'
          ? await this.mergeComment(tx, recipientId, notice, data)
          : null;
      const notificationId = merged ?? newId();
      if (!merged) {
        await tx.insert(notifications).values({
          id: notificationId,
          recipientId,
          type: notice.type,
          actorId: notice.actorId,
          subjectType: NOTIFICATION_CATALOG[notice.type].subject,
          subjectId: notice.subjectId,
          data,
        });
      }
      pushed.push({ recipientId, notificationId });
    }
    for (const payload of pushPayloads(pushed)) {
      await tx.execute(sql`select pg_notify(${NOTIFICATIONS_CHANNEL}, ${payload})`);
    }
    return pushed.length;
  }

  private async mutedTypes(tx: Transaction, userIds: string[]) {
    const rows = await tx
      .select({ userId: notificationSettings.userId, mutedTypes: notificationSettings.mutedTypes })
      .from(notificationSettings)
      .where(inArray(notificationSettings.userId, userIds));
    return new Map<string, Set<NotificationType>>(
      rows.map((row) => [row.userId, new Set(row.mutedTypes)]),
    );
  }

  /** The id of the unread comment notification it merged into, or null (rule 5). */
  private async mergeComment(
    tx: Transaction,
    recipientId: string,
    notice: Notice,
    data: unknown,
  ): Promise<string | null> {
    // Two first comments at once would each find no row to lock and insert one: a transaction
    // lock per recipient and task makes the second wait and merge.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`task_commented:${recipientId}:${notice.subjectId}`}, 0))`,
    );
    const [open] = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, recipientId),
          eq(notifications.type, 'task_commented'),
          eq(notifications.subjectId, notice.subjectId),
          isNull(notifications.readAt),
        ),
      )
      .limit(1)
      .for('update');
    if (!open) return null;
    await tx
      .update(notifications)
      .set({
        count: sql`${notifications.count} + 1`,
        actorId: notice.actorId,
        data,
        updatedAt: new Date(),
      })
      .where(eq(notifications.id, open.id));
    return open.id;
  }
}
