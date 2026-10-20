import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type ChannelPolicies,
  channelOverrides,
  effectiveChannel,
  isMutableNotificationType,
  NOTIFICATION_CATALOG,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  type Notification,
  type NotificationChannel,
  type NotificationInbox,
  type NotificationListQuery,
  type NotificationPage,
  type NotificationSettings,
  type NotificationType,
  notificationTypesOf,
  type ReadAllResult,
  type SnoozeOption,
  snoozeUntil,
  typeChannelMode,
  type UnreadCount,
  type UpdateNotificationSettings,
} from '@vertex-hub/contracts';
import { type Database, notificationSettings, notifications } from '@vertex-hub/db';
import { and, count, desc, eq, inArray, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { UserDirectory } from '../auth/index.js';
import { NotificationCenter } from './notification-center.js';
import { NotificationPolicies } from './notification-policies.service.js';
import { notificationResponses } from './notification-responses.js';

const open = isNull(notifications.resolvedAt);
const notSnoozed = isNull(notifications.snoozedUntil);
const resolvedByOther = sql`${notifications.resolvedById} is distinct from ${notifications.recipientId}`;

/** F16 rule B6: the rows of each inbox, as `notificationInbox` derives it. */
const INBOX_FILTERS: Record<NotificationInbox, SQL> = {
  needs_you: and(eq(notifications.box, 'action'), open, notSnoozed) as SQL,
  fyi: and(
    notSnoozed,
    or(eq(notifications.box, 'info'), and(eq(notifications.resolution, 'done'), resolvedByOther)),
  ) as SQL,
  done: and(
    notSnoozed,
    or(
      eq(notifications.resolution, 'void'),
      and(
        eq(notifications.resolution, 'done'),
        eq(notifications.resolvedById, notifications.recipientId),
      ),
    ),
  ) as SQL,
  snoozed: isNotNull(notifications.snoozedUntil),
};

/**
 * Each user's own notifications, inboxes, snoozes and settings (spec F14, F16 part B); another
 * user's id answers 404.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly center: NotificationCenter,
    private readonly policies: NotificationPolicies,
  ) {}

  /** Rule B6: one inbox, or everything not snoozed; critical rows first, then newest. */
  async list(userId: string, query: NotificationListQuery): Promise<NotificationPage> {
    const filters: SQL[] = [
      eq(notifications.recipientId, userId),
      query.inbox ? INBOX_FILTERS[query.inbox] : notSnoozed,
    ];
    if (query.unread !== undefined) {
      filters.push(query.unread ? isNull(notifications.readAt) : isNotNull(notifications.readAt));
    }
    if (query.category) {
      filters.push(inArray(notifications.type, notificationTypesOf(query.category)));
    }
    const where = and(...filters);
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(notifications)
        .where(where)
        .orderBy(
          desc(sql`${notifications.priority} = 'critical'`),
          desc(notifications.updatedAt),
          desc(notifications.id),
        )
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ value: count() }).from(notifications).where(where),
    ]);
    return {
      items: await notificationResponses(rows, this.users, this.db),
      total: total?.value ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * Rule B6: unread rows that are not snoozed, and the open "Needs you" rows. Resolved rows of
   * "Done" are read, so they never count.
   */
  async unreadCount(userId: string): Promise<UnreadCount> {
    const [row] = await this.db
      .select({
        count:
          sql<number>`count(*) filter (where ${notifications.readAt} is null and ${notifications.snoozedUntil} is null)`.mapWith(
            Number,
          ),
        needsYou: sql<number>`count(*) filter (where ${INBOX_FILTERS.needs_you})`.mapWith(Number),
      })
      .from(notifications)
      .where(eq(notifications.recipientId, userId));
    return { count: row?.count ?? 0, needsYou: row?.needsYou ?? 0 };
  }

  /**
   * Idempotent: a notification already read keeps its first read time (edge case 10). F16 rule
   * B5: opening an open "opened" type resolves it as done by its recipient.
   */
  async markRead(userId: string, id: string): Promise<void> {
    const [row] = await this.db
      .select({
        type: notifications.type,
        box: notifications.box,
        readAt: notifications.readAt,
        resolvedAt: notifications.resolvedAt,
      })
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.recipientId, userId)));
    if (!row) throw new NotFoundException('Notification not found');
    const resolves =
      NOTIFICATION_CATALOG[row.type].opened && row.box === 'action' && !row.resolvedAt;
    if (row.readAt && !resolves) return;
    const now = new Date();
    await this.db
      .update(notifications)
      .set({
        readAt: row.readAt ?? now,
        ...(resolves && {
          resolvedAt: now,
          resolvedById: userId,
          resolution: 'done' as const,
          snoozedUntil: null,
        }),
      })
      .where(and(eq(notifications.id, id), resolves ? open : isNull(notifications.readAt)));
  }

  /**
   * Rule B8: takes the row out of the lists and the count until its time. A resolved row cannot
   * be snoozed.
   */
  async snooze(userId: string, id: string, option: SnoozeOption): Promise<Notification> {
    const [row] = await this.db
      .select({ resolvedAt: notifications.resolvedAt })
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.recipientId, userId)));
    if (!row) throw new NotFoundException('Notification not found');
    if (row.resolvedAt) {
      throw new CodedException(409, 'ALREADY_RESOLVED', 'This notification is already closed');
    }
    await this.db
      .update(notifications)
      .set({ snoozedUntil: snoozeUntil(option, new Date()) })
      .where(and(eq(notifications.id, id), open));
    return this.one(userId, id);
  }

  /** Rule B8: wakes the row at once, as its time would. */
  async unsnooze(userId: string, id: string): Promise<Notification> {
    await this.db.transaction((tx) =>
      this.center.wake(
        tx,
        and(eq(notifications.id, id), eq(notifications.recipientId, userId)) as SQL,
      ),
    );
    return this.one(userId, id);
  }

  private async one(userId: string, id: string): Promise<Notification> {
    const [item] = await this.byIds(userId, [id]);
    if (!item) throw new NotFoundException('Notification not found');
    return item;
  }

  async markUnread(userId: string, id: string): Promise<void> {
    const updated = await this.db
      .update(notifications)
      .set({ readAt: null })
      .where(and(eq(notifications.id, id), eq(notifications.recipientId, userId)))
      .returning({ id: notifications.id });
    if (updated.length === 0) throw new NotFoundException('Notification not found');
  }

  async markAllRead(userId: string): Promise<ReadAllResult> {
    const updated = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.recipientId, userId), isNull(notifications.readAt), notSnoozed))
      .returning({ id: notifications.id });
    return { updated: updated.length };
  }

  /** The given notifications of one recipient, for the stream. */
  async byIds(userId: string, ids: string[]): Promise<Notification[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.recipientId, userId), inArray(notifications.id, ids)))
      .orderBy(desc(notifications.updatedAt), desc(notifications.id));
    return notificationResponses(rows, this.users, this.db);
  }

  async settings(userId: string): Promise<NotificationSettings> {
    const policies = await this.policies.current();
    const [row] = await this.db
      .select({
        mutedTypes: notificationSettings.mutedTypes,
        pushOverrides: notificationSettings.pushOverrides,
        emailOverrides: notificationSettings.emailOverrides,
        digestEnabled: notificationSettings.digestEnabled,
        morningPush: notificationSettings.morningPush,
      })
      .from(notificationSettings)
      .where(eq(notificationSettings.userId, userId));
    const muted = new Set(row?.mutedTypes ?? []);
    return {
      types: NOTIFICATION_TYPES.map((type) => {
        const { category, mutable, priority } = NOTIFICATION_CATALOG[type];
        const push = typeChannelMode(type, 'push', policies);
        const email = typeChannelMode(type, 'email', policies);
        return {
          type,
          category,
          mutable,
          muted: muted.has(type),
          priority,
          // F16 rule B3. The choices are kept while the type is muted in the app (which creates
          // nothing to push or email), so saving the switches never drops them.
          push: effectiveChannel(push, row?.pushOverrides[type]),
          pushMode: push,
          email: effectiveChannel(email, row?.emailOverrides[type]),
          emailMode: email,
          emailLocked: muted.has(type),
        };
      }),
      digestEnabled: row?.digestEnabled ?? true,
      morningPush: row?.morningPush ?? true,
    };
  }

  /**
   * Rule 3: only mutable types may be muted; unmuting affects later events only. F14 email
   * rules 2 and 11 and F16 rules A7 and B14: email and push choices, the digest and the morning
   * push switches, kept when left out, stored as overrides of the current modes (F16 rules
   * B1–B3).
   */
  async updateSettings(
    userId: string,
    input: UpdateNotificationSettings,
  ): Promise<NotificationSettings> {
    const locked = input.mutedTypes.filter((type) => !isMutableNotificationType(type));
    if (locked.length > 0) {
      throw new CodedException(400, 'NOT_MUTABLE', 'These types require action', {
        types: [...new Set(locked)],
      });
    }
    const policies = await this.policies.current();
    for (const channel of NOTIFICATION_CHANNELS) {
      const chosen = channel === 'push' ? input.pushTypes : input.emailTypes;
      if (chosen) refuseLockedChannel(channel, new Set(chosen), policies);
    }
    const mutedTypes: NotificationType[] = NOTIFICATION_TYPES.filter((type) =>
      input.mutedTypes.includes(type),
    );
    await this.db.transaction(async (tx) => {
      const [saved] = await tx
        .select({
          pushOverrides: notificationSettings.pushOverrides,
          emailOverrides: notificationSettings.emailOverrides,
        })
        .from(notificationSettings)
        .where(eq(notificationSettings.userId, userId))
        .for('update');
      const changes = {
        mutedTypes,
        ...(input.emailTypes && {
          emailOverrides: channelOverrides(
            'email',
            new Set(input.emailTypes),
            saved?.emailOverrides ?? {},
            policies,
          ),
        }),
        ...(input.pushTypes && {
          pushOverrides: channelOverrides(
            'push',
            new Set(input.pushTypes),
            saved?.pushOverrides ?? {},
            policies,
          ),
        }),
        ...(input.digestEnabled !== undefined && { digestEnabled: input.digestEnabled }),
        ...(input.morningPush !== undefined && { morningPush: input.morningPush }),
      };
      await tx
        .insert(notificationSettings)
        .values({ userId, ...changes })
        .onConflictDoUpdate({
          target: notificationSettings.userId,
          set: { ...changes, updatedAt: new Date() },
        });
    });
    return this.settings(userId);
  }
}

/** F16 rule B1: a `required` channel cannot be turned off, nor an `unavailable` one on. */
function refuseLockedChannel(
  channel: NotificationChannel,
  chosen: ReadonlySet<NotificationType>,
  policies: ChannelPolicies,
) {
  const modeOf = (type: NotificationType) => typeChannelMode(type, channel, policies);
  const required = NOTIFICATION_TYPES.filter(
    (type) => modeOf(type) === 'required' && !chosen.has(type),
  );
  if (required.length > 0) {
    throw new CodedException(400, 'CHANNEL_REQUIRED', `These types always use ${channel}`, {
      channel,
      types: required,
    });
  }
  const unavailable = NOTIFICATION_TYPES.filter(
    (type) => modeOf(type) === 'unavailable' && chosen.has(type),
  );
  if (unavailable.length > 0) {
    throw new CodedException(400, 'CHANNEL_UNAVAILABLE', `These types never use ${channel}`, {
      channel,
      types: unavailable,
    });
  }
}
