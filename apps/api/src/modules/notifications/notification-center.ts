import { Injectable } from '@nestjs/common';
import {
  type ChannelOverrides,
  type ChannelPolicies,
  channelModeOf,
  effectiveChannel,
  firstMatchPerRecipient,
  NOTIFICATION_CATALOG,
  NOTIFICATION_DATA_SCHEMAS,
  NOTIFICATION_EMAIL,
  type NotificationContent,
  type NotificationEmailState,
  type NotificationPriority,
  type NotificationResolution,
  type NotificationSubjectType,
  type NotificationType,
  notificationBox,
  notificationPriority,
  resolutionTypeOf,
} from '@vertex-hub/contracts';
import { newId, notificationSettings, notifications, type Transaction } from '@vertex-hub/db';
import { and, eq, inArray, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm';
import { UserDirectory } from '../auth/index.js';
import { NOTIFICATIONS_CHANNEL, pushPayloads } from './notification-channel.js';
import { NotificationPolicies } from './notification-policies.service.js';
import { PushQueue } from './push-queue.js';

/** F16 rule B5: what a module's event closes. */
export interface Resolution {
  /** The record the notifications are about. */
  subject: { type: NotificationSubjectType; id: string };
  /** The types it closes (`resolution_type`; escalation steps close with their original). */
  types: readonly NotificationType[];
  outcome: NotificationResolution;
  /** Null for automatic resolution (the daily job). */
  actorId: string | null;
  /** Only these recipients' rows; all when left out. */
  recipients?: readonly string[];
}

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
  push: ChannelOverrides;
  email: ChannelOverrides;
  digestEnabled: boolean;
}

/**
 * Stores notifications inside the transaction of the change that causes them (spec F14 rule 1).
 * Modules that emit import this; it never reads their tables.
 */
@Injectable()
export class NotificationCenter {
  constructor(
    private readonly users: UserDirectory,
    private readonly push: PushQueue,
    private readonly policies: NotificationPolicies,
  ) {}

  /**
   * Rule 2: drops the actor, archived users, duplicates and recipients who muted the type; when
   * the notices give one recipient several types for one subject, keeps only the first by the
   * catalog order (other subjects and several notices of that type all stay). Rule
   * 5: merges a comment (or an added file, F10) into the recipient's unread notification of the
   * same type on the same task; F16 rule B9 merges the catalog's `merges` types into unread,
   * unresolved rows that are not snoozed. The
   * `pg_notify` runs in the transaction, so PostgreSQL delivers it only on commit (rule 4). F16
   * rule A8: queues a push of each notification whose push is on for its recipient (rule B3, with
   * the channel policy of rule B1), in the same transaction; a merged one is pushed again and
   * replaces the older notice by its tag. Each row snapshots its priority, box and resolution
   * type (rules B5–B6).
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
    const policies = await this.policies.current(tx);
    // Filters first, in rule 2's order: a muted type leaves room for the next type of the change.
    const deliverable = firstMatchPerRecipient(
      candidates.filter(
        ({ recipientId, type }) =>
          people.get(recipientId)?.archived === false &&
          !settings.get(recipientId)?.muted.has(type),
      ),
    );

    const pushed: { recipientId: string; notificationId: string }[] = [];
    const toDevices: string[] = [];
    for (const { recipientId, notice } of deliverable) {
      const data = NOTIFICATION_DATA_SCHEMAS[notice.type].parse(notice.data);
      const priority = notificationPriority(notice);
      const email = emailMarking(
        notice,
        priority,
        policies,
        active.has(recipientId),
        settings.get(recipientId),
      );
      const merged = NOTIFICATION_CATALOG[notice.type].merges
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
          priority,
          box: notificationBox(notice),
          resolutionType: resolutionTypeOf(notice),
          ...email,
        });
      }
      pushed.push({ recipientId, notificationId });
      const pushOverride = settings.get(recipientId)?.push[notice.type];
      if (effectiveChannel(channelModeOf(notice, 'push', policies), pushOverride)) {
        toDevices.push(notificationId);
      }
    }
    await this.push.notifications(tx, toDevices);
    for (const payload of pushPayloads(pushed)) {
      await tx.execute(sql`select pg_notify(${NOTIFICATIONS_CHANNEL}, ${payload})`);
    }
    return pushed.length;
  }

  /**
   * F16 rule B5: closes the unresolved `action` rows on the subject whose resolution type is in
   * `types` (rows from before F16 by their own type), for the given recipients or all. With
   * `done`, the actor's own row is read and goes to "Done"; the others stay as read or unread
   * as they were and show "Handled by" in "For your information". With `void`, every row is read
   * and goes to "Done". A resolved row is never touched again (edge case 8), and a snoozed one
   * does not wake. Returns the number of rows closed.
   */
  async resolve(tx: Transaction, resolution: Resolution): Promise<number> {
    const { subject, types, outcome, actorId, recipients } = resolution;
    if (types.length === 0 || recipients?.length === 0) return 0;
    const now = new Date();
    const filters: SQL[] = [
      eq(notifications.subjectType, subject.type),
      eq(notifications.subjectId, subject.id),
      eq(notifications.box, 'action'),
      isNull(notifications.resolvedAt),
      or(
        inArray(notifications.resolutionType, [...types]),
        and(isNull(notifications.resolutionType), inArray(notifications.type, [...types])),
      ) as SQL,
    ];
    if (recipients) filters.push(inArray(notifications.recipientId, [...recipients]));
    const readAt =
      outcome === 'void'
        ? sql`coalesce(${notifications.readAt}, ${now.toISOString()}::timestamptz)`
        : actorId === null
          ? sql`${notifications.readAt}`
          : sql`case when ${notifications.recipientId} = ${actorId} then coalesce(${notifications.readAt}, ${now.toISOString()}::timestamptz) else ${notifications.readAt} end`;
    const closed = await tx
      .update(notifications)
      .set({
        resolvedAt: now,
        resolvedById: actorId,
        resolution: outcome,
        snoozedUntil: null,
        readAt,
      })
      .where(and(...filters))
      .returning({ id: notifications.id });
    return closed.length;
  }

  /**
   * F16 rule B8: wakes the snoozed rows the filter selects that are still unresolved: unread,
   * `updated_at` now, a toast, and a push where push is on for the type. Returns their ids.
   */
  async wake(tx: Transaction, filter: SQL): Promise<string[]> {
    const woken = await tx
      .update(notifications)
      .set({ readAt: null, snoozedUntil: null, updatedAt: new Date() })
      .where(and(filter, isNotNull(notifications.snoozedUntil), isNull(notifications.resolvedAt)))
      .returning({
        id: notifications.id,
        recipientId: notifications.recipientId,
        type: notifications.type,
        data: notifications.data,
      });
    if (woken.length === 0) return [];
    const settings = await this.settingsOf(tx, [...new Set(woken.map((row) => row.recipientId))]);
    const policies = await this.policies.current(tx);
    await this.push.notifications(
      tx,
      woken
        .filter((row) =>
          effectiveChannel(
            channelModeOf(
              { type: row.type, data: row.data } as NotificationContent,
              'push',
              policies,
            ),
            settings.get(row.recipientId)?.push[row.type],
          ),
        )
        .map((row) => row.id),
    );
    const pairs = woken.map((row) => ({ recipientId: row.recipientId, notificationId: row.id }));
    for (const payload of pushPayloads(pairs)) {
      await tx.execute(sql`select pg_notify(${NOTIFICATIONS_CHANNEL}, ${payload})`);
    }
    return woken.map((row) => row.id);
  }

  private async settingsOf(tx: Transaction, userIds: string[]) {
    const rows = await tx
      .select({
        userId: notificationSettings.userId,
        mutedTypes: notificationSettings.mutedTypes,
        pushOverrides: notificationSettings.pushOverrides,
        emailOverrides: notificationSettings.emailOverrides,
        digestEnabled: notificationSettings.digestEnabled,
      })
      .from(notificationSettings)
      .where(inArray(notificationSettings.userId, userIds));
    return new Map<string, RecipientSettings>(
      rows.map((row) => [
        row.userId,
        {
          muted: new Set(row.mutedTypes),
          push: row.pushOverrides,
          email: row.emailOverrides,
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
          isNull(notifications.resolvedAt),
          isNull(notifications.snoozedUntil),
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
 * F14 email rules 3–4: `pending` for 10 minutes when email is on for the active recipient
 * (F16 rule B3), at once for a critical one (F16 rule B4), `skipped` when the morning digest
 * covers it, null otherwise.
 */
function emailMarking(
  notice: Notice,
  priority: NotificationPriority,
  policies: ChannelPolicies,
  active: boolean,
  settings: RecipientSettings | undefined,
): EmailMarking {
  const emailed = effectiveChannel(
    channelModeOf(notice, 'email', policies),
    settings?.email[notice.type],
  );
  if (!active || !emailed) return { emailState: null, emailAfter: null };
  if (notice.digestCovered && (settings?.digestEnabled ?? true)) {
    return { emailState: 'skipped', emailAfter: null };
  }
  const delay = priority === 'critical' ? 0 : NOTIFICATION_EMAIL.delayMinutes * 60 * 1000;
  return { emailState: 'pending', emailAfter: new Date(Date.now() + delay) };
}
