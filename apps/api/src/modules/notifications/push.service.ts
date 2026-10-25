import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import {
  addDays,
  businessInstant,
  type DevicePush,
  deviceOf,
  PUSH_LIMITS,
  PUSH_RESULT_JOB,
  type PushConfig,
  type PushDeliveryListQuery,
  type PushDeliveryPage,
  type PushResultJob,
  type PushSubscriptionInput,
  pushResultJobSchema,
} from '@vertex-hub/contracts';
import {
  type Database,
  notifications,
  pushDeliveries,
  pushSubscriptions,
  type Transaction,
} from '@vertex-hub/db';
import { testPush } from '@vertex-hub/messages';
import { and, count, desc, eq, gte, inArray, isNull, lt, ne, or, type SQL, sql } from 'drizzle-orm';
import { ENV, type Env } from '../../core/config/env.js';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { JobQueue } from '../../core/jobs/index.js';
import { type CurrentUserInfo, DevicePushStates, personRef, UserDirectory } from '../auth/index.js';
import { NotificationCenter } from './notification-center.js';
import { notificationResponses } from './notification-responses.js';
import { PushQueue } from './push-queue.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * F16 part A (ADR 0036): the push subscription of each signed-in session, the test push, clicks,
 * the outcomes the worker reports (`push.result`) and the delivery log. Subscriptions and
 * deliveries are technical rows: never audited.
 */
@Injectable()
export class PushService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly jobs: JobQueue,
    private readonly queue: PushQueue,
    private readonly center: NotificationCenter,
    private readonly users: UserDirectory,
    private readonly devicePush: DevicePushStates,
  ) {}

  onModuleInit(): void {
    this.jobs.work(PUSH_RESULT_JOB.queue, (data) =>
      this.recordResult(pushResultJobSchema.parse(data)),
    );
    this.devicePush.register((sessionIds) => this.devicePushStates(sessionIds));
  }

  /** Rule A16: without the VAPID public key, push is unavailable. */
  config(): PushConfig {
    const key = this.env.VAPID_PUBLIC_KEY ?? null;
    return { available: key !== null, vapidPublicKey: key };
  }

  /**
   * Rule A7: stores the browser's subscription on the current session, replacing any earlier one
   * of that session. A browser has one endpoint: when another session of the same browser held it
   * (a shared PC, edge case 4), that session's subscription is replaced, so one user's pushes
   * never show to the next.
   */
  async subscribe(
    actor: CurrentUserInfo,
    input: PushSubscriptionInput,
    userAgent: string | undefined,
  ): Promise<void> {
    if (!this.config().available) {
      throw new CodedException(409, 'PUSH_UNAVAILABLE', 'Push is not configured on this server');
    }
    const sessionId = currentSession(actor);
    const values = {
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      deviceLabel: deviceOf(userAgent).label,
    };
    await this.db.transaction(async (tx) => {
      // Another session's row for this browser, and this session's row for an older endpoint:
      // a rotated endpoint gets a new row, so outcomes of pushes to the old one (often `gone`)
      // find no subscription and never delete the new one.
      await tx
        .delete(pushSubscriptions)
        .where(
          or(
            and(
              eq(pushSubscriptions.endpoint, input.endpoint),
              ne(pushSubscriptions.sessionId, sessionId),
            ),
            and(
              eq(pushSubscriptions.sessionId, sessionId),
              ne(pushSubscriptions.endpoint, input.endpoint),
            ),
          ),
        );
      await tx
        .insert(pushSubscriptions)
        .values({ userId: actor.id, sessionId, ...values })
        .onConflictDoUpdate({
          target: pushSubscriptions.sessionId,
          set: { ...values, failureCount: 0, lastFailureAt: null, updatedAt: new Date() },
        });
    });
  }

  /** Rule A7: "Turn off on this device". */
  async unsubscribe(actor: CurrentUserInfo): Promise<void> {
    await this.db
      .delete(pushSubscriptions)
      .where(eq(pushSubscriptions.sessionId, currentSession(actor)));
  }

  /** Rule A12: a test push to the current device, at most one a minute. */
  async test(actor: CurrentUserInfo): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [subscription] = await tx
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.sessionId, currentSession(actor)))
        .for('update');
      if (!subscription) {
        throw new CodedException(409, 'NO_SUBSCRIPTION', 'Push is not on for this device');
      }
      const since = new Date(Date.now() - PUSH_LIMITS.testIntervalSeconds * 1000);
      const [recent] = await tx
        .select({ id: pushDeliveries.id })
        .from(pushDeliveries)
        .where(
          and(
            eq(pushDeliveries.subscriptionId, subscription.id),
            eq(pushDeliveries.kind, 'test'),
            gte(pushDeliveries.createdAt, since),
          ),
        )
        .limit(1);
      if (recent) {
        throw new HttpException('One test notification a minute', HttpStatus.TOO_MANY_REQUESTS);
      }
      await this.queue.send(tx, subscription, {
        kind: 'test',
        notificationId: null,
        priority: 'normal',
        ...testPush(),
        link: '/account',
        tag: `test:${subscription.id}`,
        unreadCount: await this.queue.unreadCount(tx, actor.id),
        close: [],
      });
    });
  }

  /** Rule A10: the push was opened; marks its notification read. Idempotent. */
  async click(actor: CurrentUserInfo, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [delivery] = await tx
        .update(pushDeliveries)
        .set({ clickedAt: sql`coalesce(${pushDeliveries.clickedAt}, now())` })
        .where(and(eq(pushDeliveries.id, id), eq(pushDeliveries.userId, actor.id)))
        .returning({ notificationId: pushDeliveries.notificationId });
      if (!delivery) throw new NotFoundException('Push not found');
      if (!delivery.notificationId) return;
      await tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.id, delivery.notificationId),
            eq(notifications.recipientId, actor.id),
            isNull(notifications.readAt),
          ),
        );
    });
  }

  /**
   * The worker's outcome (rule A13): `sent` resets the failures; `gone` deletes the subscription
   * and tells the user; `failed` counts, and the tenth failure in a row deletes it the same way.
   * Acts only on a `queued` delivery, so a repeated job changes nothing.
   */
  async recordResult(result: PushResultJob): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [delivery] = await tx
        .update(pushDeliveries)
        .set(
          result.status === 'sent'
            ? { status: 'sent', sentAt: new Date(result.sentAt) }
            : { status: result.status, error: result.error.slice(0, PUSH_LIMITS.error) },
        )
        .where(and(eq(pushDeliveries.id, result.deliveryId), eq(pushDeliveries.status, 'queued')))
        .returning({ subscriptionId: pushDeliveries.subscriptionId });
      // Signed out meanwhile: the subscription went with its session, and nobody is told.
      if (!delivery?.subscriptionId) return;
      const subscriptionId = delivery.subscriptionId;
      if (result.status === 'sent') {
        await tx
          .update(pushSubscriptions)
          .set({ lastSuccessAt: new Date(result.sentAt), failureCount: 0 })
          .where(eq(pushSubscriptions.id, subscriptionId));
        return;
      }
      if (result.status === 'failed') {
        const [failing] = await tx
          .update(pushSubscriptions)
          .set({
            lastFailureAt: new Date(),
            failureCount: sql`${pushSubscriptions.failureCount} + 1`,
          })
          .where(eq(pushSubscriptions.id, subscriptionId))
          .returning({ failureCount: pushSubscriptions.failureCount });
        if (!failing || failing.failureCount < PUSH_LIMITS.failures) return;
      }
      await this.drop(tx, subscriptionId);
    });
  }

  /** Rule A13: deletes a dead subscription and tells its user which device stopped. */
  private async drop(tx: Transaction, subscriptionId: string): Promise<void> {
    const [removed] = await tx
      .delete(pushSubscriptions)
      .where(eq(pushSubscriptions.id, subscriptionId))
      .returning({ userId: pushSubscriptions.userId, deviceLabel: pushSubscriptions.deviceLabel });
    if (!removed) return;
    await this.center.notify(tx, {
      type: 'push_device_lost',
      data: { device: removed.deviceLabel },
      recipients: [removed.userId],
      actorId: null,
      subjectId: removed.userId,
    });
  }

  /** Rule A15: the pushes of the last 30 days, newest first. */
  async list(query: PushDeliveryListQuery): Promise<PushDeliveryPage> {
    const filters: SQL[] = [
      gte(pushDeliveries.createdAt, new Date(Date.now() - PUSH_LIMITS.retentionDays * DAY_MS)),
    ];
    if (query.userId) filters.push(eq(pushDeliveries.userId, query.userId));
    if (query.status) filters.push(inArray(pushDeliveries.status, query.status));
    if (query.from) {
      filters.push(gte(pushDeliveries.createdAt, businessInstant(query.from, '00:00')));
    }
    if (query.to) {
      filters.push(lt(pushDeliveries.createdAt, businessInstant(addDays(query.to, 1), '00:00')));
    }
    const where = and(...filters);
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(pushDeliveries)
        .where(where)
        .orderBy(desc(pushDeliveries.createdAt), desc(pushDeliveries.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ value: count() }).from(pushDeliveries).where(where),
    ]);
    const notificationIds = rows.flatMap((row) => row.notificationId ?? []);
    const notificationRows = notificationIds.length
      ? await this.db.select().from(notifications).where(inArray(notifications.id, notificationIds))
      : [];
    const shown = new Map(
      (await notificationResponses(notificationRows, this.users, this.db)).map((item) => [
        item.id,
        item,
      ]),
    );
    const people = await this.users.summaries([...new Set(rows.map((row) => row.userId))]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        user: personRef(people, row.userId),
        device: row.deviceLabel,
        kind: row.kind,
        notification: (row.notificationId && shown.get(row.notificationId)) || null,
        status: row.status,
        error: row.error,
        createdAt: row.createdAt.toISOString(),
        sentAt: row.sentAt?.toISOString() ?? null,
        clickedAt: row.clickedAt?.toISOString() ?? null,
      })),
      total: total?.value ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Rule A15: deliveries are kept 30 days. */
  async purge(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - PUSH_LIMITS.retentionDays * DAY_MS);
    const deleted = await this.db
      .delete(pushDeliveries)
      .where(lt(pushDeliveries.createdAt, cutoff))
      .returning({ id: pushDeliveries.id });
    return deleted.length;
  }

  /** Rule A12: on with a subscription, and when its push service last accepted a push. */
  private async devicePushStates(sessionIds: string[]): Promise<Map<string, DevicePush>> {
    const rows = await this.db
      .select({
        sessionId: pushSubscriptions.sessionId,
        lastSuccessAt: pushSubscriptions.lastSuccessAt,
      })
      .from(pushSubscriptions)
      .where(inArray(pushSubscriptions.sessionId, sessionIds));
    return new Map(
      rows.map((row) => [
        row.sessionId,
        { state: 'on', lastDeliveredAt: row.lastSuccessAt?.toISOString() ?? null },
      ]),
    );
  }
}

/** The session of the request; every `me` route comes through the permissions guard. */
function currentSession(actor: CurrentUserInfo): string {
  if (!actor.sessionId) throw new UnauthorizedException();
  return actor.sessionId;
}
