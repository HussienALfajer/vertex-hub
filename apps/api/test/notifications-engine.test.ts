import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  businessDate,
  businessInstant,
  type Notification,
  type NotificationPolicy,
  type NotificationType,
  notificationPageSchema,
  notificationPolicyListSchema,
  notificationPolicySchema,
  notificationSchema,
  notificationSettingsSchema,
  weekday,
} from '@vertex-hub/contracts';
import {
  auditEntries,
  createDatabase,
  notificationPolicies,
  notificationReminders,
  notifications,
  pushDeliveries,
  pushSubscriptions,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ENV, type Env, parseEnv } from '../src/core/config/env.js';
import { Escalations, escalationKey } from '../src/modules/notifications/escalations.js';
import {
  DailyReminders,
  type Notice,
  NotificationCenter,
  NotificationEmails,
} from '../src/modules/notifications/index.js';
import { NOTIFICATION_POLICY_ENTITY_ID } from '../src/modules/notifications/notification-policies.service.js';
import { TimedNotifications } from '../src/modules/notifications/timed-notifications.js';
import { expectError } from './client-cast.js';
import { api } from './helpers.js';
import { seedPostCast } from './post-cast.js';
import { startApp } from './start-app.js';

/** Spec F16 part B: the notification engine. */
describe('notification engine (F16 part B)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  const subjects: string[] = [];
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let center: NotificationCenter;
  let cast: Awaited<ReturnType<typeof seedPostCast>>;

  const task = {
    title: 'تصميم منشور',
    department: 'design',
    client: 'عميل',
    project: null,
  } as const;

  const subject = () => {
    const id = randomUUID();
    subjects.push(id);
    return id;
  };

  const notice = (
    type: 'task_assigned' | 'task_review_requested' | 'task_requested' | 'task_changed',
    recipients: string[],
    subjectId = subject(),
    actorId: string | null = cast.am.id,
  ): Notice =>
    type === 'task_changed'
      ? {
          type,
          recipients,
          actorId,
          subjectId,
          data: { task, change: 'cancelled', from: null, to: null },
        }
      : { type, recipients, actorId, subjectId, data: { task } };

  const overdue = (recipients: string[], subjectId = subject()): Notice => ({
    type: 'task_overdue',
    recipients,
    actorId: null,
    subjectId,
    data: { task, dueDate: '2026-10-01', dueTime: null },
  });

  const notify = (notices: Notice | Notice[]) => db.transaction((tx) => center.notify(tx, notices));

  const rowsOf = (recipientId: string, type?: NotificationType) =>
    db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, recipientId),
          type ? eq(notifications.type, type) : undefined,
        ),
      );

  const list = async (cookie: string, query = '') => {
    const response = await client.request('GET', `/api/me/notifications${query}`, { cookie });
    expect(response.status).toBe(200);
    return notificationPageSchema.parse(await response.json()).items as Notification[];
  };

  const unread = async (cookie: string) => {
    const response = await client.get('/api/me/notifications/unread-count', cookie);
    expect(response.status).toBe(200);
    return (await response.json()) as { count: number; needsYou: number };
  };

  const everyone = () =>
    [
      cast.gm,
      cast.operations,
      cast.am,
      cast.otherAm,
      cast.employee,
      cast.designer,
      cast.designManager,
      cast.writer,
      cast.contentManager,
      cast.medicalReviewer,
    ].map((user) => user.id);

  const clearAll = () =>
    db.delete(notifications).where(inArray(notifications.recipientId, everyone()));

  beforeAll(async () => {
    let url: string;
    const env: Env = { ...parseEnv(), VAPID_PUBLIC_KEY: 'BTestPublicKey' };
    ({ app, url } = await startApp({
      override: (builder) => builder.overrideProvider(ENV).useValue(env),
    }));
    client = api(url);
    center = app.get(NotificationCenter);
    cast = await seedPostCast(db, client);
  });

  afterAll(async () => {
    await app?.close();
    if (cast) {
      await db.delete(pushDeliveries).where(inArray(pushDeliveries.userId, everyone()));
      await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.userId, everyone()));
      await db.delete(notificationPolicies);
      await db.delete(auditEntries).where(eq(auditEntries.entityId, NOTIFICATION_POLICY_ENTITY_ID));
    }
    if (subjects.length > 0) {
      await db
        .delete(notificationReminders)
        .where(inArray(notificationReminders.subjectId, subjects));
    }
    await cast?.cleanup();
    await connection.close();
  });

  beforeEach(async () => {
    await clearAll();
  });

  describe('routes', () => {
    it('answers 401 without a session', async () => {
      const id = randomUUID();
      for (const [method, path] of [
        ['POST', `/api/me/notifications/${id}/snooze`],
        ['POST', `/api/me/notifications/${id}/unsnooze`],
        ['GET', '/api/notification-policies'],
        ['PUT', '/api/notification-policies/task_commented'],
        ['GET', `/api/tasks/${id}/following`],
        ['PUT', `/api/tasks/${id}/following`],
        ['GET', `/api/content/posts/${id}/following`],
        ['PUT', `/api/content/posts/${id}/following`],
      ] as const) {
        const response = await client.request(method, path, method === 'GET' ? {} : { body: {} });
        expect(response.status, path).toBe(401);
      }
    });
  });

  describe('inboxes and resolution (rules B5–B7)', () => {
    it('stores the box and the resolution type of each row', async () => {
      await notify([
        notice('task_review_requested', [cast.employee.id]),
        notice('task_changed', [cast.employee.id]),
      ]);
      const rows = await rowsOf(cast.employee.id);
      const review = rows.find((row) => row.type === 'task_review_requested');
      const changed = rows.find((row) => row.type === 'task_changed');
      expect(review).toMatchObject({ box: 'action', resolutionType: 'task_review_requested' });
      expect(changed).toMatchObject({ box: 'info', resolutionType: null });
    });

    it('closes for the actor in Done and for the others in For your information', async () => {
      const id = subject();
      await notify(notice('task_review_requested', [cast.employee.id, cast.designer.id], id));
      const closed = await db.transaction((tx) =>
        center.resolve(tx, {
          subject: { type: 'task', id },
          types: ['task_review_requested'],
          outcome: 'done',
          actorId: cast.employee.id,
        }),
      );
      expect(closed).toBe(2);
      const [mine] = await list(cast.employee.cookie, '?inbox=done');
      expect(mine).toMatchObject({
        read: true,
        inbox: 'done',
        resolution: { outcome: 'done', by: { id: cast.employee.id } },
      });
      const [theirs] = await list(cast.designer.cookie, '?inbox=fyi');
      expect(theirs).toMatchObject({
        read: false,
        inbox: 'fyi',
        resolution: { outcome: 'done', by: { id: cast.employee.id, name: cast.employee.name } },
      });
      expect(await list(cast.designer.cookie, '?inbox=needs_you')).toEqual([]);
      // Edge case 8: resolving again touches nothing.
      const again = await db.transaction((tx) =>
        center.resolve(tx, {
          subject: { type: 'task', id },
          types: ['task_review_requested'],
          outcome: 'void',
          actorId: null,
        }),
      );
      expect(again).toBe(0);
    });

    it('moves every row to Done, read, when the work no longer applies', async () => {
      const id = subject();
      await notify(notice('task_assigned', [cast.designer.id], id));
      await db.transaction((tx) =>
        center.resolve(tx, {
          subject: { type: 'task', id },
          types: ['task_assigned'],
          outcome: 'void',
          actorId: cast.am.id,
        }),
      );
      const [row] = await list(cast.designer.cookie, '?inbox=done');
      expect(row).toMatchObject({ read: true, resolution: { outcome: 'void' } });
    });

    it('closes only the given recipients and types, and rows from before F16 by their type', async () => {
      const id = subject();
      await notify(notice('task_review_requested', [cast.employee.id, cast.designer.id], id));
      await db.insert(notifications).values({
        recipientId: cast.writer.id,
        type: 'task_requested',
        subjectType: 'task',
        subjectId: id,
        data: { task },
        priority: 'important',
        box: 'action',
      });
      await db.transaction((tx) =>
        center.resolve(tx, {
          subject: { type: 'task', id },
          types: ['task_review_requested', 'task_requested'],
          outcome: 'done',
          actorId: null,
          recipients: [cast.designer.id, cast.writer.id],
        }),
      );
      expect((await rowsOf(cast.employee.id))[0]?.resolvedAt).toBeNull();
      expect((await rowsOf(cast.designer.id))[0]?.resolution).toBe('done');
      const [legacy] = await rowsOf(cast.writer.id);
      // Automatic resolution: no resolver, and the read state is kept.
      expect(legacy).toMatchObject({ resolution: 'done', resolvedById: null, readAt: null });
    });

    it('lists critical rows first and counts unread rows and open "Needs you" rows', async () => {
      await notify(overdue([cast.employee.id]));
      await notify(notice('task_changed', [cast.employee.id]));
      await notify(notice('task_assigned', [cast.employee.id]));
      const items = await list(cast.employee.cookie);
      expect(items.map((item) => item.type)).toEqual([
        'task_overdue',
        'task_assigned',
        'task_changed',
      ]);
      expect(items[0]).toMatchObject({ priority: 'critical', box: 'action', inbox: 'needs_you' });
      expect(await unread(cast.employee.cookie)).toEqual({ count: 3, needsYou: 2 });
      const needsYou = await list(cast.employee.cookie, '?inbox=needs_you');
      expect(needsYou.map((item) => item.type)).toEqual(['task_overdue', 'task_assigned']);
    });

    it('resolves an "opened" type when its recipient opens it (rule B5)', async () => {
      const id = subject();
      await notify({
        type: 'client_account_manager_assigned',
        recipients: [cast.employee.id],
        actorId: cast.gm.id,
        subjectId: id,
        data: { client: 'عميل' },
      });
      const [row] = await rowsOf(cast.employee.id);
      if (!row) throw new Error('no row');
      const response = await client.post(
        `/api/me/notifications/${row.id}/read`,
        cast.employee.cookie,
        {},
      );
      expect(response.status).toBe(204);
      const [opened] = await list(cast.employee.cookie, '?inbox=done');
      expect(opened).toMatchObject({
        read: true,
        resolution: { outcome: 'done', by: { id: cast.employee.id } },
      });
    });
  });

  describe('grouping (rule B9)', () => {
    it('merges task changes into the unread row, but never into a snoozed one', async () => {
      const id = subject();
      await notify(notice('task_changed', [cast.employee.id], id));
      await notify(notice('task_changed', [cast.employee.id], id));
      const merged = await rowsOf(cast.employee.id);
      expect(merged).toHaveLength(1);
      expect(merged[0]?.count).toBe(2);
      await db
        .update(notifications)
        .set({ snoozedUntil: new Date(Date.now() + 60 * 60 * 1000) })
        .where(eq(notifications.recipientId, cast.employee.id));
      await notify(notice('task_changed', [cast.employee.id], id));
      expect(await rowsOf(cast.employee.id)).toHaveLength(2);
    });
  });

  describe('snooze (rule B8)', () => {
    const snooze = (cookie: string, id: string, option: string) =>
      client.post(`/api/me/notifications/${id}/snooze`, cookie, { for: option });

    it('takes the row out of the lists and the count until the minute job wakes it', async () => {
      await notify(notice('task_assigned', [cast.employee.id]));
      const [row] = await rowsOf(cast.employee.id);
      if (!row) throw new Error('no row');
      const response = await snooze(cast.employee.cookie, row.id, '1h');
      expect(response.status).toBe(200);
      const snoozed = notificationSchema.parse(await response.json());
      expect(snoozed.inbox).toBe('snoozed');
      expect(new Date(snoozed.snoozedUntil ?? 0).getTime()).toBeGreaterThan(Date.now());
      expect(await list(cast.employee.cookie)).toEqual([]);
      expect(await unread(cast.employee.cookie)).toEqual({ count: 0, needsYou: 0 });
      expect(await list(cast.employee.cookie, '?inbox=snoozed')).toHaveLength(1);

      const timed = app.get(TimedNotifications);
      expect((await timed.runTimed(new Date())).woken).toBe(0);
      expect((await timed.runTimed(new Date(Date.now() + 2 * 60 * 60 * 1000))).woken).toBe(1);
      const [woken] = await list(cast.employee.cookie);
      expect(woken).toMatchObject({ read: false, snoozedUntil: null, inbox: 'needs_you' });
    });

    it('wakes at once on unsnooze, and answers 404 for another user’s row', async () => {
      await notify(notice('task_assigned', [cast.employee.id]));
      const [row] = await rowsOf(cast.employee.id);
      if (!row) throw new Error('no row');
      expect((await snooze(cast.designer.cookie, row.id, '3h')).status).toBe(404);
      expect((await snooze(cast.employee.cookie, row.id, 'next_work_day')).status).toBe(200);
      const response = await client.post(
        `/api/me/notifications/${row.id}/unsnooze`,
        cast.employee.cookie,
        {},
      );
      expect(response.status).toBe(200);
      expect(notificationSchema.parse(await response.json())).toMatchObject({
        inbox: 'needs_you',
        snoozedUntil: null,
      });
      const other = await client.post(
        `/api/me/notifications/${row.id}/unsnooze`,
        cast.designer.cookie,
        {},
      );
      expect(other.status).toBe(404);
    });

    it('refuses a resolved row, and does not wake one resolved while snoozed', async () => {
      const id = subject();
      await notify(notice('task_assigned', [cast.employee.id], id));
      const [row] = await rowsOf(cast.employee.id);
      if (!row) throw new Error('no row');
      await snooze(cast.employee.cookie, row.id, '1h');
      await db.transaction((tx) =>
        center.resolve(tx, {
          subject: { type: 'task', id },
          types: ['task_assigned'],
          outcome: 'void',
          actorId: null,
        }),
      );
      expect(
        (await app.get(TimedNotifications).runTimed(new Date(Date.now() + 2 * 60 * 60 * 1000)))
          .woken,
      ).toBe(0);
      await expectError(await snooze(cast.employee.cookie, row.id, '1h'), 409, 'ALREADY_RESOLVED');
      expect((await snooze(cast.employee.cookie, row.id, 'later')).status).toBe(400);
    });
  });

  describe('channel policy (rules B1–B3)', () => {
    const put = (cookie: string, type: string, body: unknown) =>
      client.request('PUT', `/api/notification-policies/${type}`, { cookie, body });

    const settingOf = async (cookie: string, type: NotificationType) => {
      const response = await client.get('/api/me/notification-settings', cookie);
      expect(response.status).toBe(200);
      return notificationSettingsSchema
        .parse(await response.json())
        .types.find((one) => one.type === type);
    };

    it('lists every type with its defaults for management only', async () => {
      const response = await client.get('/api/notification-policies', cast.operations.cookie);
      expect(response.status).toBe(200);
      const policies = notificationPolicyListSchema.parse(await response.json()).items;
      expect(policies.find((policy) => policy.type === 'task_overdue')).toMatchObject({
        defaults: { push: 'required', email: 'on' },
        push: 'required',
        updatedAt: null,
      });
      expect((await client.get('/api/notification-policies', cast.employee.cookie)).status).toBe(
        403,
      );
      expect((await put(cast.employee.cookie, 'task_commented', { reset: true })).status).toBe(403);
    });

    it('locks a required channel for everyone, audits the change and resets it', async () => {
      const response = await put(cast.gm.cookie, 'task_commented', {
        push: 'required',
        email: 'unavailable',
      });
      expect(response.status).toBe(200);
      const policy = notificationPolicySchema.parse(await response.json()) as NotificationPolicy;
      expect(policy).toMatchObject({
        push: 'required',
        email: 'unavailable',
        defaults: { push: 'on', email: 'off' },
        updatedBy: { id: cast.gm.id },
      });
      expect(await settingOf(cast.employee.cookie, 'task_commented')).toMatchObject({
        push: true,
        pushMode: 'required',
        emailMode: 'unavailable',
      });
      const settings = notificationSettingsSchema.parse(
        await (await client.get('/api/me/notification-settings', cast.employee.cookie)).json(),
      );
      const pushTypes = settings.types
        .filter((one) => one.push && one.type !== 'task_commented')
        .map((one) => one.type);
      await expectError(
        await client.request('PUT', '/api/me/notification-settings', {
          cookie: cast.employee.cookie,
          body: { mutedTypes: [], pushTypes },
        }),
        400,
        'CHANNEL_REQUIRED',
      );
      const [entry] = await db
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.entityId, NOTIFICATION_POLICY_ENTITY_ID));
      expect(entry).toMatchObject({
        action: 'notification_policy.updated',
        before: { type: 'task_commented', push: 'on', email: 'off' },
        after: { type: 'task_commented', push: 'required', email: 'unavailable' },
      });

      const reset = await put(cast.gm.cookie, 'task_commented', { reset: true });
      expect(notificationPolicySchema.parse(await reset.json())).toMatchObject({
        push: 'on',
        email: 'off',
        updatedAt: null,
      });
      expect(await settingOf(cast.employee.cookie, 'task_commented')).toMatchObject({
        pushMode: 'on',
      });
    });

    it('stops email for new notifications when management makes it unavailable', async () => {
      await put(cast.operations.cookie, 'task_assigned', { push: 'on', email: 'unavailable' });
      await notify(notice('task_assigned', [cast.employee.id]));
      const [row] = await rowsOf(cast.employee.id);
      expect(row?.emailState).toBeNull();
      await put(cast.operations.cookie, 'task_assigned', { reset: true });
    });

    it('answers 404 for an unknown type and 400 for half a policy', async () => {
      expect((await put(cast.gm.cookie, 'no_such_type', { reset: true })).status).toBe(404);
      expect((await put(cast.gm.cookie, 'task_commented', { push: 'on' })).status).toBe(400);
    });
  });

  describe('followers (rule B12)', () => {
    it('follows and unfollows a task or a post the caller may read', async () => {
      const { id: clientId } = await cast.createClient();
      const created = await cast.createTask(cast.designManager.cookie, { clientId });
      const path = `/api/tasks/${created.id}/following`;
      const initial = await client.get(path, cast.employee.cookie);
      expect(initial.status).toBe(200);
      // The creator follows the task from the start.
      expect(await initial.json()).toEqual({ following: false, followers: 1 });
      const followed = await client.request('PUT', path, {
        cookie: cast.employee.cookie,
        body: { following: true },
      });
      expect(await followed.json()).toEqual({ following: true, followers: 2 });
      const unfollowed = await client.request('PUT', path, {
        cookie: cast.employee.cookie,
        body: { following: false },
      });
      expect(await unfollowed.json()).toEqual({ following: false, followers: 1 });

      const post = await cast.createPost(cast.writer.cookie, { clientId });
      const postPath = `/api/content/posts/${post.id}/following`;
      const onPost = await client.request('PUT', postPath, {
        cookie: cast.writer.cookie,
        body: { following: true },
      });
      expect(onPost.status).toBe(200);
      expect(await onPost.json()).toEqual({ following: true, followers: 1 });
    });

    it('answers 404 for a record the caller cannot read', async () => {
      const id = randomUUID();
      expect((await client.get(`/api/tasks/${id}/following`, cast.employee.cookie)).status).toBe(
        404,
      );
      expect(
        (await client.get(`/api/content/posts/${id}/following`, cast.employee.cookie)).status,
      ).toBe(404);
    });
  });

  describe('escalation (rule B11)', () => {
    /** Wednesday 2026-10-21, 10:00 in Damascus. */
    const created = new Date('2026-10-21T07:00:00Z');

    const stepsOf = async (recipientId: string) =>
      (await rowsOf(recipientId)).filter((row) => row.type.startsWith('action_'));

    it('reminds, escalates to managers, then to the top, once each, and resolves together', async () => {
      const escalations = app.get(Escalations);
      const id = subject();
      await notify(
        notice('task_review_requested', [cast.designManager.id, cast.writer.id], id, cast.am.id),
      );
      await db
        .update(notifications)
        .set({ createdAt: created })
        .where(eq(notifications.subjectId, id));

      // Not due on the day itself.
      await escalations.run('2026-10-21');
      expect(await stepsOf(cast.writer.id)).toEqual([]);

      // Step 1, Thursday: the open recipients.
      await escalations.run('2026-10-22');
      const [reminder] = await stepsOf(cast.writer.id);
      expect(reminder).toMatchObject({
        type: 'action_reminder',
        box: 'action',
        resolutionType: 'task_review_requested',
        subjectId: id,
        data: expect.objectContaining({
          originalType: 'task_review_requested',
          waitingWorkDays: 1,
        }),
      });
      expect(await stepsOf(cast.designManager.id)).toHaveLength(1);
      await escalations.run('2026-10-22');
      expect(await stepsOf(cast.writer.id)).toHaveLength(1);

      // Step 2, Saturday: the writer's manager; the design manager manages their own department,
      // so the General Manager.
      await escalations.run('2026-10-24');
      const [toManager] = await stepsOf(cast.contentManager.id);
      expect(toManager).toMatchObject({ type: 'action_escalated', priority: 'important' });
      expect(toManager?.data).toMatchObject({
        waitingWorkDays: 2,
        waitingOn: expect.arrayContaining([cast.writer.name]),
      });
      const [toGm] = await stepsOf(cast.gm.id);
      expect(toGm?.type).toBe('action_escalated');

      // Step 3, Monday: the General Managers and Internal Operations, minus who received a step.
      await escalations.run('2026-10-26');
      const [top] = await stepsOf(cast.operations.id);
      expect(top).toMatchObject({ type: 'action_escalated_top', priority: 'critical' });
      expect(await stepsOf(cast.gm.id)).toHaveLength(1);

      // The steps close with the original.
      await db.transaction((tx) =>
        center.resolve(tx, {
          subject: { type: 'task', id },
          types: ['task_review_requested'],
          outcome: 'done',
          actorId: cast.designManager.id,
        }),
      );
      subjects.push(
        escalationKey({ type: 'task_review_requested', subject: { type: 'task', id } }),
      );
      for (const user of [cast.writer, cast.contentManager, cast.gm, cast.operations]) {
        const open = (await rowsOf(user.id)).filter((row) => row.resolvedAt === null);
        expect(open, user.name).toEqual([]);
      }
    });

    it('keys the steps of two originals on one record apart', async () => {
      const id = subject();
      await notify([
        notice('task_review_requested', [cast.writer.id], id),
        notice('task_requested', [cast.employee.id], id),
      ]);
      await db
        .update(notifications)
        .set({ createdAt: created })
        .where(eq(notifications.subjectId, id));
      await app.get(Escalations).run('2026-10-22');
      expect((await stepsOf(cast.writer.id)).map((row) => row.type)).toEqual(['action_reminder']);
      expect((await stepsOf(cast.employee.id)).map((row) => row.type)).toEqual(['action_reminder']);
      for (const type of ['task_review_requested', 'task_requested'] as const) {
        subjects.push(escalationKey({ type, subject: { type: 'task', id } }));
      }
    });

    it('leaves out rows from before F16 and resolved originals (edge case 21)', async () => {
      const id = subject();
      await db.insert(notifications).values({
        recipientId: cast.writer.id,
        type: 'task_requested',
        subjectType: 'task',
        subjectId: id,
        data: { task },
        priority: 'important',
        box: 'action',
        createdAt: created,
      });
      await app.get(Escalations).run('2026-10-26');
      expect(await stepsOf(cast.writer.id)).toEqual([]);
    });
  });

  describe('channels by priority (rule B4) and the morning push (rule B14)', () => {
    it('emails a critical notification at once, at any hour and on Fridays', async () => {
      await notify([overdue([cast.employee.id]), notice('task_assigned', [cast.employee.id])]);
      const rows = await rowsOf(cast.employee.id);
      const critical = rows.find((row) => row.type === 'task_overdue');
      const assigned = rows.find((row) => row.type === 'task_assigned');
      expect(critical?.emailState).toBe('pending');
      expect(critical?.emailAfter?.getTime()).toBeLessThanOrEqual(Date.now());
      // The next Friday, 23:00 in Damascus: outside the window.
      let friday = businessDate();
      while (weekday(friday) !== 5) friday = addDays(friday, 1);
      await app.get(NotificationEmails).runBatches(businessInstant(friday, '23:00'));
      const after = await rowsOf(cast.employee.id);
      expect(after.find((row) => row.id === critical?.id)?.emailState).toBe('sent');
      expect(after.find((row) => row.id === assigned?.id)?.emailState).toBe('pending');
    });

    it('sums up the morning once on each subscribed device, unless the user turned it off', async () => {
      const subscribed = await client.request('PUT', '/api/me/push/subscription', {
        cookie: cast.employee.cookie,
        body: {
          endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
          keys: { p256dh: 'BPublicKey', auth: 'authSecret' },
        },
      });
      expect(subscribed.status).toBe(204);
      await notify(notice('task_assigned', [cast.employee.id]));
      const emails = app.get(NotificationEmails);
      // A Thursday, so the run is on a work day whatever today is.
      const day = '2026-10-22';
      await emails.runMorningPush(day, new Date());
      await emails.runMorningPush(day, new Date());
      const morning = (
        await db.select().from(pushDeliveries).where(eq(pushDeliveries.userId, cast.employee.id))
      ).filter((row) => row.kind === 'morning_summary');
      expect(morning).toHaveLength(1);
      expect(morning[0]?.notificationId).toBeNull();

      await db.delete(pushDeliveries).where(eq(pushDeliveries.userId, cast.employee.id));
      await client.request('PUT', '/api/me/notification-settings', {
        cookie: cast.employee.cookie,
        body: { mutedTypes: [], morningPush: false },
      });
      await emails.runMorningPush(day, new Date());
      const none = await db
        .select()
        .from(pushDeliveries)
        .where(
          and(
            eq(pushDeliveries.userId, cast.employee.id),
            eq(pushDeliveries.kind, 'morning_summary'),
          ),
        );
      expect(none).toEqual([]);
      const settings = notificationSettingsSchema.parse(
        await (await client.get('/api/me/notification-settings', cast.employee.cookie)).json(),
      );
      expect(settings.morningPush).toBe(false);
    });
  });

  describe('purge (rule B15)', () => {
    it('deletes rows resolved more than 90 days ago, read or not', async () => {
      const id = subject();
      await notify(notice('task_assigned', [cast.employee.id], id));
      await db
        .update(notifications)
        .set({
          resolvedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
          resolution: 'void',
        })
        .where(eq(notifications.subjectId, id));
      await app.get(DailyReminders).runDaily(businessDate(), new Date());
      expect(await rowsOf(cast.employee.id)).toEqual([]);
    });
  });
});
