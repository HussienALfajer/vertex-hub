import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  type ErrorResponse,
  type NotificationPage,
  type NotificationSettings,
  type NotificationStreamEvent,
  notificationPageSchema,
  notificationSettingsSchema,
} from '@vertex-hub/contracts';
import { createDatabase, notificationReminders, notifications } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DailyReminders,
  type Notice,
  NotificationCenter,
} from '../src/modules/notifications/index.js';
import { NotificationStream } from '../src/modules/notifications/notification-stream.js';
import { api, removeUsers, seedUser } from './helpers.js';
import { startApp } from './start-app.js';

describe('notifications', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  const seeded: string[] = [];
  const reminderSubjects: string[] = [];
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let center: NotificationCenter;
  let reminders: DailyReminders;
  let me: { id: string; cookie: string };
  let other: { id: string; cookie: string };
  let actor: { id: string };
  let archived: { id: string };

  const task = {
    title: 'تصميم منشور',
    department: 'design',
    client: 'عميل',
    project: null,
  } as const;

  const assigned = (recipients: string[], subjectId = randomUUID()): Notice => ({
    type: 'task_assigned',
    recipients,
    actorId: actor.id,
    subjectId,
    data: { task },
  });

  const commented = (recipients: string[], subjectId: string, excerpt: string): Notice => ({
    type: 'task_commented',
    recipients,
    actorId: actor.id,
    subjectId,
    data: { task, excerpt },
  });

  const notify = (notices: Notice | Notice[]) => db.transaction((tx) => center.notify(tx, notices));

  const rowsOf = (recipientId: string) =>
    db.select().from(notifications).where(eq(notifications.recipientId, recipientId));

  const list = async (cookie: string, query = '') => {
    const response = await client.request('GET', `/api/me/notifications${query}`, { cookie });
    expect(response.status).toBe(200);
    return notificationPageSchema.parse(await response.json()) as NotificationPage;
  };

  const clear = (...ids: string[]) =>
    db.delete(notifications).where(inArray(notifications.recipientId, ids));

  async function expectError(response: Response, status: number, code: string) {
    expect(response.status).toBe(status);
    expect(((await response.json()) as ErrorResponse).code).toBe(code);
  }

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    center = app.get(NotificationCenter);
    reminders = app.get(DailyReminders);
    const mine = await seedUser(db);
    const theirs = await seedUser(db);
    const acting = await seedUser(db);
    const gone = await seedUser(db, { archived: true });
    seeded.push(mine.id, theirs.id, acting.id, gone.id);
    me = { id: mine.id, cookie: await client.signIn(mine.email) };
    other = { id: theirs.id, cookie: await client.signIn(theirs.email) };
    actor = { id: acting.id };
    archived = { id: gone.id };
  });

  afterAll(async () => {
    await app?.close();
    if (reminderSubjects.length > 0) {
      await db
        .delete(notificationReminders)
        .where(inArray(notificationReminders.subjectId, reminderSubjects));
    }
    await removeUsers(db, seeded);
    await connection.close();
  });

  describe('routes', () => {
    it('answers 401 without a session', async () => {
      const id = randomUUID();
      for (const [method, path] of [
        ['GET', '/api/me/notifications'],
        ['GET', '/api/me/notifications/unread-count'],
        ['GET', '/api/me/notifications/stream'],
        ['POST', `/api/me/notifications/${id}/read`],
        ['POST', `/api/me/notifications/${id}/unread`],
        ['POST', '/api/me/notifications/read-all'],
        ['GET', '/api/me/notification-settings'],
        ['PUT', '/api/me/notification-settings'],
      ] as const) {
        const response = await client.request(method, path, {
          body: method === 'PUT' ? { mutedTypes: [] } : undefined,
        });
        expect(response.status, `${method} ${path}`).toBe(401);
      }
    });

    it('lists own notifications newest first, with the actor, and counts unread', async () => {
      await clear(me.id, other.id);
      const first = randomUUID();
      await notify(assigned([me.id], first));
      await notify({
        type: 'client_account_manager_assigned',
        recipients: [me.id, other.id],
        actorId: null,
        subjectId: randomUUID(),
        data: { client: 'عميل' },
      });

      const page = await list(me.cookie);
      expect(page.total).toBe(2);
      expect(page.pageSize).toBe(20);
      expect(page.items.map((item) => item.type)).toEqual([
        'client_account_manager_assigned',
        'task_assigned',
      ]);
      expect(page.items[0]?.actor).toBeNull();
      expect(page.items[1]).toMatchObject({
        actor: { id: actor.id },
        subject: { type: 'task', id: first },
        data: { task },
        count: 1,
        read: false,
      });

      const count = await client.request('GET', '/api/me/notifications/unread-count', {
        cookie: me.cookie,
      });
      expect(await count.json()).toEqual({ count: 2 });
    });

    it('filters by unread and category', async () => {
      const page = await list(me.cookie, '?category=clients_projects');
      expect(page.items.map((item) => item.type)).toEqual(['client_account_manager_assigned']);
      const [item] = page.items;
      await client.request('POST', `/api/me/notifications/${item?.id}/read`, { cookie: me.cookie });
      expect((await list(me.cookie, '?unread=true')).items.map((row) => row.type)).toEqual([
        'task_assigned',
      ]);
      expect((await list(me.cookie, '?unread=false')).items.map((row) => row.type)).toEqual([
        'client_account_manager_assigned',
      ]);
    });

    it('marks read and unread, idempotently, and only own notifications', async () => {
      const [item] = (await list(me.cookie, '?category=tasks')).items;
      const path = `/api/me/notifications/${item?.id}`;

      for (let i = 0; i < 2; i += 1) {
        const read = await client.request('POST', `${path}/read`, { cookie: me.cookie });
        expect(read.status).toBe(204);
      }
      expect((await list(me.cookie, '?category=tasks')).items[0]?.read).toBe(true);

      expect((await client.request('POST', `${path}/read`, { cookie: other.cookie })).status).toBe(
        404,
      );
      expect(
        (await client.request('POST', `${path}/unread`, { cookie: other.cookie })).status,
      ).toBe(404);
      expect(
        (
          await client.request('POST', `/api/me/notifications/${randomUUID()}/read`, {
            cookie: me.cookie,
          })
        ).status,
      ).toBe(404);

      const unread = await client.request('POST', `${path}/unread`, { cookie: me.cookie });
      expect(unread.status).toBe(204);
      expect((await list(me.cookie, '?category=tasks')).items[0]?.read).toBe(false);
    });

    it('marks all own notifications read', async () => {
      const response = await client.request('POST', '/api/me/notifications/read-all', {
        cookie: me.cookie,
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ updated: 1 });
      expect((await list(me.cookie, '?unread=true')).total).toBe(0);
      // The other user's notification stays unread.
      expect((await list(other.cookie, '?unread=true')).total).toBe(1);
    });

    it('reads and changes mute settings, refusing types that require action (rule 3)', async () => {
      const read = async (cookie: string) => {
        const response = await client.request('GET', '/api/me/notification-settings', { cookie });
        expect(response.status).toBe(200);
        return notificationSettingsSchema.parse(await response.json()) as NotificationSettings;
      };
      const initial = await read(me.cookie);
      expect(initial.types.find((type) => type.type === 'task_assigned')).toEqual({
        type: 'task_assigned',
        category: 'tasks',
        mutable: false,
        muted: false,
      });
      expect(initial.types.every((type) => !type.muted)).toBe(true);

      const saved = await client.request('PUT', '/api/me/notification-settings', {
        cookie: me.cookie,
        body: { mutedTypes: ['task_commented', 'task_due_soon', 'task_commented'] },
      });
      expect(saved.status).toBe(200);
      const body = notificationSettingsSchema.parse(await saved.json());
      expect(body.types.filter((type) => type.muted).map((type) => type.type)).toEqual([
        'task_commented',
        'task_due_soon',
      ]);
      // Another user's settings are untouched.
      expect((await read(other.cookie)).types.every((type) => !type.muted)).toBe(true);

      await expectError(
        await client.request('PUT', '/api/me/notification-settings', {
          cookie: me.cookie,
          body: { mutedTypes: ['task_commented', 'task_assigned'] },
        }),
        400,
        'NOT_MUTABLE',
      );
      expect((await read(me.cookie)).types.filter((type) => type.muted)).toHaveLength(2);

      await client.request('PUT', '/api/me/notification-settings', {
        cookie: me.cookie,
        body: { mutedTypes: [] },
      });
    });
  });

  describe('notify', () => {
    it('drops the actor, archived users and duplicates (rule 2)', async () => {
      await clear(me.id, other.id, actor.id, archived.id);
      const stored = await notify(assigned([me.id, me.id, actor.id, archived.id, other.id]));
      expect(stored).toBe(2);
      expect(await rowsOf(me.id)).toHaveLength(1);
      expect(await rowsOf(other.id)).toHaveLength(1);
      expect(await rowsOf(actor.id)).toHaveLength(0);
      expect(await rowsOf(archived.id)).toHaveLength(0);
    });

    it('keeps one type per recipient, the first by the catalog order (rule 2)', async () => {
      await clear(me.id, other.id);
      const subjectId = randomUUID();
      await notify([
        commented([me.id, other.id], subjectId, 'تعليق'),
        {
          type: 'task_mentioned',
          recipients: [me.id],
          actorId: actor.id,
          subjectId,
          data: { task, excerpt: 'تعليق' },
        },
      ]);
      expect((await rowsOf(me.id)).map((row) => row.type)).toEqual(['task_mentioned']);
      expect((await rowsOf(other.id)).map((row) => row.type)).toEqual(['task_commented']);
    });

    it('stores nothing for a muted type (rule 3)', async () => {
      await clear(me.id);
      await client.request('PUT', '/api/me/notification-settings', {
        cookie: me.cookie,
        body: { mutedTypes: ['task_commented'] },
      });
      await notify(commented([me.id], randomUUID(), 'تعليق'));
      expect(await rowsOf(me.id)).toHaveLength(0);
      await client.request('PUT', '/api/me/notification-settings', {
        cookie: me.cookie,
        body: { mutedTypes: [] },
      });
    });

    it('merges comments into the unread comment notification of the task (rule 5)', async () => {
      await clear(me.id);
      const subjectId = randomUUID();
      await notify(commented([me.id], subjectId, 'الأول'));
      await notify(commented([me.id], randomUUID(), 'مهمة أخرى'));
      // The merge moves it back to the top.
      await notify(commented([me.id], subjectId, 'الثاني'));
      let rows = await db
        .select()
        .from(notifications)
        .where(and(eq(notifications.recipientId, me.id), eq(notifications.subjectId, subjectId)));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ count: 2, data: { task, excerpt: 'الثاني' } });
      expect((await list(me.cookie)).items[0]?.subject.id).toBe(subjectId);

      // Once read, the next comment starts a new notification.
      await client.request('POST', `/api/me/notifications/${rows[0]?.id}/read`, {
        cookie: me.cookie,
      });
      await notify(commented([me.id], subjectId, 'الثالث'));
      rows = await db
        .select()
        .from(notifications)
        .where(and(eq(notifications.recipientId, me.id), eq(notifications.subjectId, subjectId)));
      expect(rows.map((row) => row.count).sort()).toEqual([1, 2]);
    });

    it('rolls back with the change that caused it (rule 1)', async () => {
      await clear(me.id);
      await expect(
        db.transaction(async (tx) => {
          await center.notify(tx, assigned([me.id]));
          throw new Error('business change failed');
        }),
      ).rejects.toThrow('business change failed');
      expect(await rowsOf(me.id)).toHaveLength(0);
    });

    it('keeps notices about different subjects for one recipient', async () => {
      await clear(me.id);
      const opened = (subjectId: string): Notice => ({
        type: 'task_opened',
        recipients: [me.id],
        actorId: actor.id,
        subjectId,
        data: { task },
      });
      expect(await notify([opened(randomUUID()), opened(randomUUID())])).toBe(2);
    });

    it('falls back to the next type of the change when the first is muted', async () => {
      await clear(me.id);
      await client.request('PUT', '/api/me/notification-settings', {
        cookie: me.cookie,
        body: { mutedTypes: ['task_mentioned'] },
      });
      const subjectId = randomUUID();
      await notify([
        commented([me.id], subjectId, 'تعليق'),
        { ...commented([me.id], subjectId, 'تعليق'), type: 'task_mentioned' } as Notice,
      ]);
      expect((await rowsOf(me.id)).map((row) => row.type)).toEqual(['task_commented']);
      await client.request('PUT', '/api/me/notification-settings', {
        cookie: me.cookie,
        body: { mutedTypes: [] },
      });
    });

    it('refuses a snapshot that breaks its type schema', async () => {
      await expect(notify(commented([me.id], randomUUID(), 'x'.repeat(141)))).rejects.toThrow();
    });
  });

  describe('stream', () => {
    it('delivers a notification committed after it opened (rule 4)', async () => {
      await clear(me.id);
      const abort = new AbortController();
      const response = await fetch(`${await app.getUrl()}/api/me/notifications/stream`, {
        headers: { cookie: me.cookie, origin: 'http://127.0.0.1:5173' },
        signal: abort.signal,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let received = '';
      const readUntil = async (text: string) => {
        while (!received.includes(text)) {
          const { value, done } = await reader.read();
          if (done) throw new Error('Stream ended');
          received += decoder.decode(value, { stream: true });
        }
      };
      await readUntil(': connected');

      const subjectId = randomUUID();
      // The other user's notification is not on this stream.
      await notify(assigned([other.id]));
      await notify(assigned([me.id], subjectId));
      await readUntil(subjectId);
      await readUntil('}\n\n');
      abort.abort();

      const line = received.split('\n').find((row) => row.startsWith('data: ')) as string;
      expect(received).toContain('event: notification');
      const event = JSON.parse(line.slice('data: '.length)) as NotificationStreamEvent;
      expect(event.unreadCount).toBe(1);
      expect(event.notification).toMatchObject({
        type: 'task_assigned',
        subject: { type: 'task', id: subjectId },
      });
      expect(received.match(/event: notification/g)).toHaveLength(1);
    });

    it('ends open streams before the server closes, so shutdown does not wait on them', async () => {
      const response = await fetch(`${await app.getUrl()}/api/me/notifications/stream`, {
        headers: { cookie: me.cookie, origin: 'http://127.0.0.1:5173' },
      });
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();
      await reader.read();
      app.get(NotificationStream).beforeApplicationShutdown();
      let done = false;
      while (!done) ({ done } = await reader.read());
      expect(done).toBe(true);
    });
  });

  describe('daily job', () => {
    it('sends each reminder once, however often the job runs (rule 8)', async () => {
      await clear(me.id);
      const subjectId = randomUUID();
      reminderSubjects.push(subjectId);
      const remind = (today: string) =>
        db.transaction((tx) =>
          reminders.remindOnce(
            tx,
            { kind: 'due_soon', subjectId, occurrence: '2026-10-10' },
            today,
            {
              type: 'task_due_soon',
              recipients: [me.id],
              actorId: null,
              subjectId,
              data: { task, dueDate: '2026-10-10', dueTime: null },
            },
          ),
        );
      expect(await remind('2026-10-08')).toBe(true);
      expect(await remind('2026-10-08')).toBe(false);
      expect(await remind('2026-10-10')).toBe(false);
      expect(await rowsOf(me.id)).toHaveLength(1);

      const [key] = await db
        .select()
        .from(notificationReminders)
        .where(eq(notificationReminders.subjectId, subjectId));
      expect(key).toMatchObject({
        kind: 'due_soon',
        occurrence: '2026-10-10',
        sentOn: '2026-10-08',
      });
    });

    it('runs the registered sources, then purges notifications read over 90 days ago (rule 13)', async () => {
      await clear(me.id);
      const now = new Date('2026-10-08T06:00:00.000Z');
      const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      await notify([assigned([me.id])]);
      await notify([assigned([me.id])]);
      await notify([assigned([me.id])]);
      const ids = (await rowsOf(me.id)).map((row) => row.id);
      await db
        .update(notifications)
        .set({ readAt: daysAgo(91) })
        .where(eq(notifications.id, ids[0] as string));
      await db
        .update(notifications)
        .set({ readAt: daysAgo(89) })
        .where(eq(notifications.id, ids[1] as string));

      const seen: string[] = [];
      reminders.register('test', async (today) => {
        seen.push(today);
        return 0;
      });
      const result = await reminders.runDaily('2026-10-08', now);
      expect(seen).toEqual(['2026-10-08']);
      expect(result.purged).toBeGreaterThanOrEqual(1);
      expect((await rowsOf(me.id)).map((row) => row.id).sort()).toEqual([ids[1], ids[2]].sort());
    });
  });
});
