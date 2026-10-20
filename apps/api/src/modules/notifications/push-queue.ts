import { Injectable } from '@nestjs/common';
import {
  type NotificationPriority,
  PUSH_DELIVERY_OPTIONS,
  PUSH_LIMITS,
  PUSH_SEND_JOB,
  type PushDeliveryKind,
  pushSendJobSchema,
  pushTag,
} from '@vertex-hub/contracts';
import {
  newId,
  notifications,
  pushDeliveries,
  pushSubscriptions,
  type Transaction,
} from '@vertex-hub/db';
import { linkPath, notificationLink, notificationPush } from '@vertex-hub/messages';
import { and, count, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { JobQueue } from '../../core/jobs/index.js';
import { UserDirectory } from '../auth/index.js';
import { notificationResponses } from './notification-responses.js';

type Subscription = typeof pushSubscriptions.$inferSelect;

/** One push to one device, before its delivery row and job exist. */
export interface Push {
  kind: PushDeliveryKind;
  notificationId: string | null;
  priority: NotificationPriority;
  title: string;
  body: string;
  link: string;
  tag: string;
  unreadCount: number;
  close: string[];
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Queues pushes inside the transaction of the change (F16 rule A8, ADR 0036): one delivery row
 * and one `push.send` job per device, so the push commits or rolls back with it. The job carries
 * the rendered texts, so the worker reads no table.
 */
@Injectable()
export class PushQueue {
  constructor(
    private readonly users: UserDirectory,
    private readonly jobs: JobQueue,
  ) {}

  /** Rule A8: pushes the given stored notifications to every open device of their recipients. */
  async notifications(tx: Transaction, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const rows = await tx
      .select()
      .from(notifications)
      .where(inArray(notifications.id, [...ids]));
    const recipientIds = [...new Set(rows.map((row) => row.recipientId))];
    const devices = await this.devices(tx, recipientIds);
    if (devices.size === 0) return;
    const items = await notificationResponses(rows, this.users, tx);
    const names = await this.users.departmentNames(tx);
    const unread = await this.unreadCounts(tx, [...devices.keys()]);
    const read = await this.recentlyRead(tx, [...devices.keys()]);
    for (const [index, row] of rows.entries()) {
      const item = items[index];
      const subscriptions = devices.get(row.recipientId);
      if (!item || !subscriptions) continue;
      const tag = pushTag(row);
      const { title, body } = notificationPush(item, (code) => names.get(code) ?? '');
      const push: Push = {
        kind: 'notification',
        notificationId: row.id,
        priority: row.priority,
        title,
        body,
        link: linkPath(notificationLink(item)),
        tag,
        unreadCount: unread.get(row.recipientId) ?? 0,
        // Never the push's own tag: the notice it replaces is closed by the tag itself.
        close: (read.get(row.recipientId) ?? []).filter((other) => other !== tag),
      };
      for (const subscription of subscriptions) await this.send(tx, subscription, push);
    }
  }

  /**
   * Rule B14: one push that is not a bell row (the morning summary) to every open device of the
   * user. Returns the number of devices.
   */
  async toUser(
    tx: Transaction,
    userId: string,
    push: Omit<Push, 'unreadCount' | 'close'>,
  ): Promise<number> {
    const subscriptions = (await this.devices(tx, [userId])).get(userId) ?? [];
    if (subscriptions.length === 0) return 0;
    const unreadCount = await this.unreadCount(tx, userId);
    const close = (await this.recentlyRead(tx, [userId])).get(userId) ?? [];
    for (const subscription of subscriptions) {
      await this.send(tx, subscription, { ...push, unreadCount, close });
    }
    return subscriptions.length;
  }

  /** The recipient's unread count, for the icon badge (rule A4). */
  async unreadCount(tx: Transaction, userId: string): Promise<number> {
    return (await this.unreadCounts(tx, [userId])).get(userId) ?? 0;
  }

  /** Stores the delivery and queues its job. Returns the delivery id. */
  async send(tx: Transaction, subscription: Subscription, push: Push): Promise<string> {
    const id = newId();
    await tx.insert(pushDeliveries).values({
      id,
      userId: subscription.userId,
      subscriptionId: subscription.id,
      deviceLabel: subscription.deviceLabel,
      kind: push.kind,
      notificationId: push.notificationId,
    });
    const { urgency, ttlSeconds } = PUSH_DELIVERY_OPTIONS[push.priority];
    const { queue, retryLimit, retryDelay, retryBackoff } = PUSH_SEND_JOB;
    await this.jobs.sendInTransaction(
      tx,
      queue,
      pushSendJobSchema.parse({
        subscription: {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        urgency,
        ttlSeconds,
        payload: {
          kind: push.kind,
          deliveryId: id,
          notificationId: push.notificationId,
          title: push.title,
          body: push.body,
          link: push.link,
          tag: push.tag,
          requireInteraction: push.priority === 'critical',
          unreadCount: push.unreadCount,
          close: push.close.slice(0, PUSH_LIMITS.closeTags),
        },
      }),
      { retryLimit, retryDelay, retryBackoff },
    );
    return id;
  }

  /**
   * The subscriptions of each user whose session is still open (edge case 3: a session that
   * expired gets nothing, even before its row is removed).
   */
  private async devices(tx: Transaction, userIds: string[]): Promise<Map<string, Subscription[]>> {
    if (userIds.length === 0) return new Map();
    const rows = await tx
      .select()
      .from(pushSubscriptions)
      .where(inArray(pushSubscriptions.userId, userIds));
    const open = await this.users.openSessions(
      rows.map((row) => row.sessionId),
      tx,
    );
    const devices = new Map<string, Subscription[]>();
    for (const row of rows) {
      if (!open.has(row.sessionId)) continue;
      devices.set(row.userId, [...(devices.get(row.userId) ?? []), row]);
    }
    return devices;
  }

  private async unreadCounts(tx: Transaction, userIds: string[]): Promise<Map<string, number>> {
    const rows = await tx
      .select({ userId: notifications.recipientId, value: count() })
      .from(notifications)
      .where(
        and(
          inArray(notifications.recipientId, userIds),
          isNull(notifications.readAt),
          // F16 rule B6: snoozed rows leave the count.
          isNull(notifications.snoozedUntil),
        ),
      )
      .groupBy(notifications.recipientId);
    return new Map(rows.map((row) => [row.userId, row.value]));
  }

  /** Rule A14: the tags of each user's notifications read in the last 24 hours, newest first. */
  private async recentlyRead(tx: Transaction, userIds: string[]): Promise<Map<string, string[]>> {
    const since = new Date(Date.now() - PUSH_LIMITS.closeHours * HOUR_MS);
    const read = new Map<string, string[]>();
    // One query per user keeps each list to its own 20; a transaction runs on one connection.
    for (const userId of userIds) {
      const rows = await tx
        .select({
          subjectType: notifications.subjectType,
          subjectId: notifications.subjectId,
          type: notifications.type,
        })
        .from(notifications)
        .where(and(eq(notifications.recipientId, userId), gt(notifications.readAt, since)))
        .orderBy(desc(notifications.readAt))
        .limit(PUSH_LIMITS.closeTags);
      read.set(userId, [...new Set(rows.map(pushTag))]);
    }
    return read;
  }
}
