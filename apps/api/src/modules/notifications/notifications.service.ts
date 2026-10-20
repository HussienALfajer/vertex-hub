import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  channelOverrides,
  effectiveChannel,
  isMutableNotificationType,
  NOTIFICATION_CATALOG,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  type Notification,
  type NotificationChannel,
  type NotificationListQuery,
  type NotificationPage,
  type NotificationSettings,
  type NotificationType,
  notificationTypesOf,
  type ReadAllResult,
  type UpdateNotificationSettings,
} from '@vertex-hub/contracts';
import { type Database, notificationSettings, notifications } from '@vertex-hub/db';
import { and, count, desc, eq, inArray, isNotNull, isNull, type SQL } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { UserDirectory } from '../auth/index.js';
import { notificationResponses } from './notification-responses.js';

/** Each user's own notifications and mute settings (spec F14); another user's id answers 404. */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
  ) {}

  async list(userId: string, query: NotificationListQuery): Promise<NotificationPage> {
    const filters: SQL[] = [eq(notifications.recipientId, userId)];
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
        .orderBy(desc(notifications.updatedAt), desc(notifications.id))
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

  async unreadCount(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.recipientId, userId), isNull(notifications.readAt)));
    return row?.value ?? 0;
  }

  /** Idempotent: a notification already read keeps its first read time (edge case 10). */
  async markRead(userId: string, id: string): Promise<void> {
    const [row] = await this.db
      .select({ readAt: notifications.readAt })
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.recipientId, userId)));
    if (!row) throw new NotFoundException('Notification not found');
    if (row.readAt) return;
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), isNull(notifications.readAt)));
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
      .where(and(eq(notifications.recipientId, userId), isNull(notifications.readAt)))
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
    const [row] = await this.db
      .select({
        mutedTypes: notificationSettings.mutedTypes,
        pushOverrides: notificationSettings.pushOverrides,
        emailOverrides: notificationSettings.emailOverrides,
        digestEnabled: notificationSettings.digestEnabled,
      })
      .from(notificationSettings)
      .where(eq(notificationSettings.userId, userId));
    const muted = new Set(row?.mutedTypes ?? []);
    return {
      types: NOTIFICATION_TYPES.map((type) => {
        const { category, mutable, priority, push, email } = NOTIFICATION_CATALOG[type];
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
    };
  }

  /**
   * Rule 3: only mutable types may be muted; unmuting affects later events only. F14 email
   * rules 2 and 11 and F16 rule A7: email and push choices and the digest switch, kept when left
   * out, stored as overrides of the catalog defaults (F16 rule B3).
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
    for (const channel of NOTIFICATION_CHANNELS) {
      const chosen = channel === 'push' ? input.pushTypes : input.emailTypes;
      if (chosen) refuseLockedChannel(channel, new Set(chosen));
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
          ),
        }),
        ...(input.pushTypes && {
          pushOverrides: channelOverrides(
            'push',
            new Set(input.pushTypes),
            saved?.pushOverrides ?? {},
          ),
        }),
        ...(input.digestEnabled !== undefined && { digestEnabled: input.digestEnabled }),
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
function refuseLockedChannel(channel: NotificationChannel, chosen: ReadonlySet<NotificationType>) {
  const modeOf = (type: NotificationType) => NOTIFICATION_CATALOG[type][channel];
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
