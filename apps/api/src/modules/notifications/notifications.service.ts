import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  isMutableNotificationType,
  NOTIFICATION_CATALOG,
  NOTIFICATION_TYPES,
  type Notification,
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

type NotificationRow = typeof notifications.$inferSelect;

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
      items: await this.toResponses(rows),
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
    return this.toResponses(rows);
  }

  async settings(userId: string): Promise<NotificationSettings> {
    const [row] = await this.db
      .select({ mutedTypes: notificationSettings.mutedTypes })
      .from(notificationSettings)
      .where(eq(notificationSettings.userId, userId));
    const muted = new Set(row?.mutedTypes ?? []);
    return {
      types: NOTIFICATION_TYPES.map((type) => ({
        type,
        category: NOTIFICATION_CATALOG[type].category,
        mutable: NOTIFICATION_CATALOG[type].mutable,
        muted: muted.has(type),
      })),
    };
  }

  /** Rule 3: only mutable types may be muted; unmuting affects later events only. */
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
    const mutedTypes: NotificationType[] = NOTIFICATION_TYPES.filter((type) =>
      input.mutedTypes.includes(type),
    );
    await this.db
      .insert(notificationSettings)
      .values({ userId, mutedTypes })
      .onConflictDoUpdate({
        target: notificationSettings.userId,
        set: { mutedTypes, updatedAt: new Date() },
      });
    return this.settings(userId);
  }

  private async toResponses(rows: NotificationRow[]): Promise<Notification[]> {
    const actors = await this.users.summaries(
      rows.flatMap((row) => (row.actorId ? [row.actorId] : [])),
      this.db,
    );
    return rows.map((row) => {
      const actor = row.actorId ? actors.get(row.actorId) : undefined;
      return {
        id: row.id,
        type: row.type,
        actor: actor ? { id: actor.id, name: actor.name } : null,
        subject: { type: row.subjectType, id: row.subjectId },
        data: row.data,
        count: row.count,
        read: row.readAt !== null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      } as Notification;
    });
  }
}
