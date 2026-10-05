import { Injectable } from '@nestjs/common';
import {
  emailedTypes,
  firstMatchPerRecipient,
  NOTIFICATION_CATALOG,
  NOTIFICATION_DATA_SCHEMAS,
  NOTIFICATION_EMAIL,
  type NotificationContent,
  type NotificationEmailState,
  type NotificationSubjectType,
  type NotificationType,
} from '@vertex-hub/contracts';
import { newId, notificationSettings, notifications, type Transaction } from '@vertex-hub/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { UserDirectory } from '../auth/index.js';
import { NOTIFICATIONS_CHANNEL, pushPayloads } from './notification-channel.js';

/**
 * Types merged into the recipient's unread notification of the same type and subject (rule 5,
 * F10, F09).
 */
const MERGED_TYPES: readonly NotificationType[] = [
  'task_commented',
  'task_file_added',
  'approval_responded',
];

/** One type of notification for one change, as the owning module resolved its recipients. */
export type Notice = NotificationContent & {
  recipients: readonly string[];
  /** Null for the daily job and automatic runs. */
  actorId: string | null;
  /** The record the notification opens; its type comes from the catalog. */
  subjectId: string;
  /** A type whose subject varies (F14 email `email_failed`: the email's document). */
  subjectType?: NotificationSubjectType;
  /**
   * F14 email rule 4: the recipients are the task's assignee and the morning digest lists the
   * task, so it is not emailed to those whose digest is on.
   */
  digestCovered?: boolean;
};

/** A recipient's settings as `notify` reads them; no row means the defaults. */
interface RecipientSettings {
  muted: Set<NotificationType>;
  emailed: Set<NotificationType>;
  digestEnabled: boolean;
}

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
   * 5: merges a comment (or an added file, F10) into the recipient's unread notification of the
   * same type on the same task. The
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
    const active = await this.users.mailboxes(recipientIds, tx);
    const settings = await this.settingsOf(tx, recipientIds);
    // Filters first, in rule 2's order: a muted type leaves room for the next type of the change.
    const deliverable = firstMatchPerRecipient(
      candidates.filter(
        ({ recipientId, type }) =>
          people.get(recipientId)?.archived === false &&
          !settings.get(recipientId)?.muted.has(type),
      ),
    );

    const pushed: { recipientId: string; notificationId: string }[] = [];
    for (const { recipientId, notice } of deliverable) {
      const data = NOTIFICATION_DATA_SCHEMAS[notice.type].parse(notice.data);
      const email = emailMarking(notice, active.has(recipientId), settings.get(recipientId));
      const merged = MERGED_TYPES.includes(notice.type)
        ? await this.mergeUnread(tx, recipientId, notice, data, email)
        : null;
      const notificationId = merged ?? newId();
      if (!merged) {
        await tx.insert(notifications).values({
          id: notificationId,
          recipientId,
          type: notice.type,
          actorId: notice.actorId,
          subjectType: notice.subjectType ?? NOTIFICATION_CATALOG[notice.type].subject,
          subjectId: notice.subjectId,
          data,
          ...email,
        });
      }
      pushed.push({ recipientId, notificationId });
    }
    for (const payload of pushPayloads(pushed)) {
      await tx.execute(sql`select pg_notify(${NOTIFICATIONS_CHANNEL}, ${payload})`);
    }
    return pushed.length;
  }

  private async settingsOf(tx: Transaction, userIds: string[]) {
    const rows = await tx
      .select({
        userId: notificationSettings.userId,
        mutedTypes: notificationSettings.mutedTypes,
        emailTypes: notificationSettings.emailTypes,
        digestEnabled: notificationSettings.digestEnabled,
      })
      .from(notificationSettings)
      .where(inArray(notificationSettings.userId, userIds));
    return new Map<string, RecipientSettings>(
      rows.map((row) => [
        row.userId,
        {
          muted: new Set(row.mutedTypes),
          emailed: emailedTypes(row.emailTypes),
          digestEnabled: row.digestEnabled,
        },
      ]),
    );
  }

  /** The id of the unread notification of the same type it merged into, or null (rule 5). */
  private async mergeUnread(
    tx: Transaction,
    recipientId: string,
    notice: Notice,
    data: unknown,
    email: EmailMarking,
  ): Promise<string | null> {
    // Two first comments (or files) at once would each find no row to lock and insert one: a transaction
    // lock per recipient and task makes the second wait and merge.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${notice.type}:${recipientId}:${notice.subjectId}`}, 0))`,
    );
    const [open] = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, recipientId),
          eq(notifications.type, notice.type),
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
        // F14 email rule 8: a later batch carries the new items once.
        ...(email.emailState === 'pending' && email),
      })
      .where(eq(notifications.id, open.id));
    return open.id;
  }
}

type EmailMarking = { emailState: NotificationEmailState | null; emailAfter: Date | null };

/**
 * F14 email rules 3–4: `pending` for 10 minutes when the active recipient emails the type,
 * `skipped` when the morning digest covers it, null otherwise.
 */
function emailMarking(
  notice: Notice,
  active: boolean,
  settings: RecipientSettings | undefined,
): EmailMarking {
  const emailed = settings?.emailed ?? emailedTypes(null);
  if (!active || !emailed.has(notice.type)) return { emailState: null, emailAfter: null };
  if (notice.digestCovered && (settings?.digestEnabled ?? true)) {
    return { emailState: 'skipped', emailAfter: null };
  }
  const emailAfter = new Date(Date.now() + NOTIFICATION_EMAIL.delayMinutes * 60 * 1000);
  return { emailState: 'pending', emailAfter };
}
