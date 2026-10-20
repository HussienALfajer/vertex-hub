import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  type ErrorResponse,
  NOTIFICATION_CATALOG,
  NOTIFICATION_TYPES,
  pushConfigSchema,
  pushDeliveryPageSchema,
  signedInDeviceListSchema,
} from '@vertex-hub/contracts';
import {
  createDatabase,
  notificationSettings,
  notifications,
  pushDeliveries,
  pushSubscriptions,
  sessions,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ENV, type Env, parseEnv } from '../src/core/config/env.js';
import {
  DailyReminders,
  type Notice,
  NotificationCenter,
} from '../src/modules/notifications/index.js';
import { PushService } from '../src/modules/notifications/push.service.js';
import { api, removeUsers, seedUser } from './helpers.js';
import { startApp } from './start-app.js';

describe('push (F16 part A)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  const seeded: string[] = [];
  let app: INestApplication;
  let env: Env;
  let client: ReturnType<typeof api>;
  let center: NotificationCenter;
  let push: PushService;
  let me: { id: string; cookie: string };
  let other: { id: string; cookie: string };
  let actor: { id: string };
  let admin: { id: string; cookie: string };

  const task = {
    title: 'تصميم منشور',
    department: 'design',
    client: 'عميل',
    project: null,
  } as const;
  const subscription = (endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`) => ({
    endpoint,
    keys: { p256dh: 'BPublicKey', auth: 'authSecret' },
  });

  const notice = (type: 'task_assigned' | 'task_overdue', recipients: string[]): Notice =>
    type === 'task_assigned'
      ? { type, recipients, actorId: actor.id, subjectId: randomUUID(), data: { task } }
      : {
          type,
          recipients,
          actorId: null,
          subjectId: randomUUID(),
          data: { task, dueDate: '2026-10-01', dueTime: null },
        };

  const notify = (notices: Notice | Notice[]) => db.transaction((tx) => center.notify(tx, notices));

  const deliveriesOf = (userId: string) =>
    db.select().from(pushDeliveries).where(eq(pushDeliveries.userId, userId));

  const subscriptionsOf = (userId: string) =>
    db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));

  const subscribe = (cookie: string, body: unknown = subscription()) =>
    client.request('PUT', '/api/me/push/subscription', { cookie, body });

  async function expectError(response: Response, status: number, code: string) {
    expect(response.status).toBe(status);
    expect(((await response.json()) as ErrorResponse).code).toBe(code);
  }

  beforeAll(async () => {
    let url: string;
    env = { ...parseEnv(), VAPID_PUBLIC_KEY: 'BTestPublicKey' };
    ({ app, url } = await startApp({
      override: (builder) => builder.overrideProvider(ENV).useValue(env),
    }));
    client = api(url);
    center = app.get(NotificationCenter);
    push = app.get(PushService);
    const mine = await seedUser(db);
    const theirs = await seedUser(db);
    const acting = await seedUser(db);
    seeded.push(mine.id, theirs.id, acting.id);
    me = { id: mine.id, cookie: await client.signIn(mine.email) };
    other = { id: theirs.id, cookie: await client.signIn(theirs.email) };
    actor = { id: acting.id };
    const manager = await client.signInWithTwoFactor(db, {
      departments: [{ code: 'internal_operations', manager: true }],
    });
    seeded.push(manager.id);
    admin = { id: manager.id, cookie: manager.cookie };
  });

  beforeEach(async () => {
    await db.delete(pushDeliveries).where(inArray(pushDeliveries.userId, seeded));
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.userId, seeded));
    await db.delete(notifications).where(inArray(notifications.recipientId, seeded));
    await db.delete(notificationSettings).where(inArray(notificationSettings.userId, seeded));
  });

  afterAll(async () => {
    await app?.close();
    await removeUsers(db, seeded);
    await connection.close();
  });

  it('answers 401 without a session', async () => {
    for (const [method, path] of [
      ['GET', '/api/me/push/config'],
      ['PUT', '/api/me/push/subscription'],
      ['DELETE', '/api/me/push/subscription'],
      ['POST', '/api/me/push/test'],
      ['POST', `/api/me/push/deliveries/${randomUUID()}/click`],
      ['GET', '/api/push-deliveries'],
    ] as const) {
      const response = await client.request(method, path, {
        body: method === 'PUT' ? subscription() : undefined,
      });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });

  it('gives the VAPID public key, or reports push unavailable without it (rule A16)', async () => {
    const response = await client.get('/api/me/push/config', me.cookie);
    expect(pushConfigSchema.parse(await response.json())).toEqual({
      available: true,
      vapidPublicKey: 'BTestPublicKey',
    });
    env.VAPID_PUBLIC_KEY = undefined;
    try {
      const off = await client.get('/api/me/push/config', me.cookie);
      expect(await off.json()).toEqual({ available: false, vapidPublicKey: null });
      await expectError(await subscribe(me.cookie), 409, 'PUSH_UNAVAILABLE');
    } finally {
      env.VAPID_PUBLIC_KEY = 'BTestPublicKey';
    }
  });

  it('stores one subscription on the current session, and shows it on the device (rules A7, A12)', async () => {
    expect((await subscribe(me.cookie)).status).toBe(204);
    const second = subscription();
    expect((await subscribe(me.cookie, second)).status).toBe(204);
    const rows = await subscriptionsOf(me.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.endpoint).toBe(second.endpoint);
    const [session] = await db.select().from(sessions).where(eq(sessions.userId, me.id));
    expect(rows[0]?.sessionId).toBe(session?.id);

    const devices = signedInDeviceListSchema.parse(
      await (await client.get('/api/me/sessions', me.cookie)).json(),
    );
    expect(devices.items[0]?.push).toEqual({ state: 'on', lastDeliveredAt: null });

    expect(
      (await client.request('DELETE', '/api/me/push/subscription', { cookie: me.cookie })).status,
    ).toBe(204);
    expect(await subscriptionsOf(me.id)).toHaveLength(0);
    const after = signedInDeviceListSchema.parse(
      await (await client.get('/api/me/sessions', me.cookie)).json(),
    );
    expect(after.items[0]?.push.state).toBe('off');
  });

  it('gives a rotated endpoint a new subscription, so outcomes of the old one cannot drop it', async () => {
    await subscribe(me.cookie);
    await notify(notice('task_assigned', [me.id]));
    const [old] = await deliveriesOf(me.id);
    await subscribe(me.cookie);
    const [renewed] = await subscriptionsOf(me.id);
    await push.recordResult({
      deliveryId: old?.id as string,
      status: 'gone',
      attempts: 1,
      error: '410 Gone',
    });
    expect(await subscriptionsOf(me.id)).toEqual([renewed]);
    const lost = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.recipientId, me.id), eq(notifications.type, 'push_device_lost')));
    expect(lost).toHaveLength(0);
  });

  it('refuses an endpoint that is not https or not a push service', async () => {
    for (const endpoint of ['http://fcm.googleapis.com/fcm/send/abc', 'https://127.0.0.1/abc']) {
      expect((await subscribe(me.cookie, subscription(endpoint))).status, endpoint).toBe(400);
    }
  });

  it('moves a browser endpoint to the session that subscribed last (edge case 4)', async () => {
    const shared = subscription();
    await subscribe(me.cookie, shared);
    await subscribe(other.cookie, shared);
    expect(await subscriptionsOf(me.id)).toHaveLength(0);
    expect(await subscriptionsOf(other.id)).toHaveLength(1);
  });

  it('deletes the subscription with its session (rule A3)', async () => {
    await subscribe(other.cookie);
    const [row] = await subscriptionsOf(other.id);
    const [session] = await db
      .select({ id: sessions.id, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(eq(sessions.id, row?.sessionId as string));
    // A session past its expiry gets no push (edge case 3)...
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, session?.id as string));
    await notify(notice('task_assigned', [other.id]));
    expect(await deliveriesOf(other.id)).toHaveLength(0);
    await db
      .update(sessions)
      .set({ expiresAt: session?.expiresAt as Date })
      .where(eq(sessions.id, session?.id as string));
    // ...and removing it removes the subscription. The cascade is checked inside a rolled-back
    // transaction, so the signed-in cookie stays valid for the next tests.
    await db
      .transaction(async (tx) => {
        await tx.delete(sessions).where(eq(sessions.id, session?.id as string));
        const left = await tx
          .select()
          .from(pushSubscriptions)
          .where(eq(pushSubscriptions.userId, other.id));
        expect(left).toHaveLength(0);
        throw new Error('rollback');
      })
      .catch((error: Error) => expect(error.message).toBe('rollback'));
  });

  it('queues a push per device when push is on for the type (rules A8, B3)', async () => {
    await subscribe(me.cookie);
    await notify(notice('task_assigned', [me.id, other.id]));
    const [delivery] = await deliveriesOf(me.id);
    const [stored] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientId, me.id));
    expect(delivery).toMatchObject({
      kind: 'notification',
      status: 'queued',
      notificationId: stored?.id,
    });
    expect(stored?.priority).toBe('important');
    // The other recipient has no device: nothing is pushed (edge case 22).
    expect(await deliveriesOf(other.id)).toHaveLength(0);
  });

  it('follows the user switch, but always pushes required types', async () => {
    await subscribe(me.cookie);
    // A required type cannot be turned off (rule B1).
    await expectError(
      await client.request('PUT', '/api/me/notification-settings', {
        cookie: me.cookie,
        body: { mutedTypes: [], pushTypes: [] },
      }),
      400,
      'CHANNEL_REQUIRED',
    );
    const required = NOTIFICATION_TYPES.filter(
      (type) => NOTIFICATION_CATALOG[type].push === 'required',
    );
    const response = await client.request('PUT', '/api/me/notification-settings', {
      cookie: me.cookie,
      body: { mutedTypes: [], pushTypes: required },
    });
    expect(response.status).toBe(200);
    const settings = (await response.json()) as {
      types: { type: string; push: boolean; pushMode: string; priority: string }[];
    };
    expect(settings.types.find((item) => item.type === 'task_assigned')).toMatchObject({
      push: false,
      pushMode: 'on',
      priority: 'important',
    });
    expect(settings.types.find((item) => item.type === 'task_overdue')).toMatchObject({
      push: true,
      pushMode: 'required',
    });
    await notify(notice('task_assigned', [me.id]));
    expect(await deliveriesOf(me.id)).toHaveLength(0);
    await notify(notice('task_overdue', [me.id]));
    expect(await deliveriesOf(me.id)).toHaveLength(1);
  });

  it('sends a test push at most once a minute, only with a subscription (rule A12)', async () => {
    await expectError(await client.post('/api/me/push/test', me.cookie), 409, 'NO_SUBSCRIPTION');
    await subscribe(me.cookie);
    expect((await client.post('/api/me/push/test', me.cookie)).status).toBe(202);
    expect((await client.post('/api/me/push/test', me.cookie)).status).toBe(429);
    const rows = await deliveriesOf(me.id);
    expect(rows.map((row) => row.kind)).toEqual(['test']);
  });

  it('records a click on own pushes only, and marks the notification read (rule A10)', async () => {
    await subscribe(me.cookie);
    await notify(notice('task_assigned', [me.id]));
    const [delivery] = await deliveriesOf(me.id);
    const path = `/api/me/push/deliveries/${delivery?.id}/click`;
    expect((await client.post(path, other.cookie)).status).toBe(404);
    expect((await client.post(path, me.cookie)).status).toBe(204);
    expect((await client.post(path, me.cookie)).status).toBe(204);
    const [clicked] = await deliveriesOf(me.id);
    expect(clicked?.clickedAt).not.toBeNull();
    const [read] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientId, me.id));
    expect(read?.readAt).not.toBeNull();
  });

  it('records outcomes, and drops a gone device with a notice (rule A13)', async () => {
    await subscribe(me.cookie);
    await notify([notice('task_assigned', [me.id]), notice('task_overdue', [me.id])]);
    const [first, second] = await deliveriesOf(me.id);
    const sentAt = new Date().toISOString();
    await push.recordResult({
      deliveryId: first?.id as string,
      status: 'sent',
      attempts: 1,
      sentAt,
    });
    // A repeated outcome changes nothing.
    await push.recordResult({
      deliveryId: first?.id as string,
      status: 'failed',
      attempts: 4,
      error: 'x',
    });
    const [device] = await subscriptionsOf(me.id);
    expect(device?.lastSuccessAt?.toISOString()).toBe(sentAt);
    expect((await deliveriesOf(me.id)).find((row) => row.id === first?.id)?.status).toBe('sent');

    await push.recordResult({
      deliveryId: second?.id as string,
      status: 'gone',
      attempts: 1,
      error: '410 Gone',
    });
    expect(await subscriptionsOf(me.id)).toHaveLength(0);
    const lost = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.recipientId, me.id), eq(notifications.type, 'push_device_lost')));
    expect(lost).toHaveLength(1);
    expect(lost[0]).toMatchObject({
      subjectType: 'user',
      subjectId: me.id,
      priority: 'informational',
    });
  });

  it('drops a device after 10 failed messages in a row (rule A13)', async () => {
    await subscribe(me.cookie);
    await notify(Array.from({ length: 10 }, () => notice('task_assigned', [me.id])));
    const rows = await deliveriesOf(me.id);
    expect(rows).toHaveLength(10);
    for (const [index, row] of rows.entries()) {
      expect(await subscriptionsOf(me.id), `after ${index} failures`).toHaveLength(1);
      await push.recordResult({ deliveryId: row.id, status: 'failed', attempts: 4, error: '500' });
    }
    expect(await subscriptionsOf(me.id)).toHaveLength(0);
  });

  it('lists the delivery log for notifications.policy only (rule A15)', async () => {
    await subscribe(me.cookie);
    await notify(notice('task_assigned', [me.id]));
    expect((await client.get('/api/push-deliveries', me.cookie)).status).toBe(403);
    const response = await client.get(`/api/push-deliveries?userId=${me.id}`, admin.cookie);
    expect(response.status).toBe(200);
    const page = pushDeliveryPageSchema.parse(await response.json());
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      user: { id: me.id },
      kind: 'notification',
      status: 'queued',
      notification: { type: 'task_assigned' },
    });
    const none = await client.get(`/api/push-deliveries?userId=${me.id}&status=sent`, admin.cookie);
    expect(pushDeliveryPageSchema.parse(await none.json()).total).toBe(0);
  });

  it('purges deliveries 30 days after creation with the daily job', async () => {
    await subscribe(me.cookie);
    await notify(notice('task_assigned', [me.id]));
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await db.update(pushDeliveries).set({ createdAt: old }).where(eq(pushDeliveries.userId, me.id));
    await app.get(DailyReminders).runDaily();
    expect(await deliveriesOf(me.id)).toHaveLength(0);
  });
});
