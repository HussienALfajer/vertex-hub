import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  businessDate,
  businessInstant,
  type CalendarDate,
  EMAIL_DATA_SCHEMAS,
  type EmailData,
  isWorkDay,
  type NotificationSettings,
  notificationSettingsSchema,
  weekday,
} from '@vertex-hub/contracts';
import {
  createDatabase,
  emailDigests,
  emailMessages,
  newId,
  notifications,
  tasks,
  users,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type Notice,
  NotificationCenter,
  NotificationEmails,
} from '../src/modules/notifications/index.js';
import { TaskDigest } from '../src/modules/tasks/task-digest.js';
import { api, removeUsers, seedUser } from './helpers.js';
import { startApp } from './start-app.js';
import { seedTaskCast } from './task-cast.js';

type Cast = Awaited<ReturnType<typeof seedTaskCast>>;

/** The next day after `from` that `accept` takes. */
function nextDay(from: CalendarDate, accept: (day: CalendarDate) => boolean): CalendarDate {
  let day = addDays(from, 1);
  while (!accept(day)) day = addDays(day, 1);
  return day;
}

// A fixed clock: a work day after today, so every real `email_after` has passed by then.
const workDay = nextDay(addDays(businessDate(), 1), isWorkDay);
const at = (time: string, day: CalendarDate = workDay) => businessInstant(day, time);
const friday = nextDay(businessDate(), (day) => weekday(day) === 5);

describe('notification emails (F14 email rules 2–12)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  const extraUsers: string[] = [];
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Cast;
  let center: NotificationCenter;
  let emails: NotificationEmails;
  /** The digest tasks the test source gives, by user. */
  const digestTasks = new Map<string, EmailData<'digest'>['overdue']['items']>();

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedTaskCast(db, client);
    center = app.get(NotificationCenter);
    emails = app.get(NotificationEmails);
    emails.registerDigestSource(async (userId) => ({
      overdue: { items: digestTasks.get(userId) ?? [], more: 0 },
      dueToday: { items: [], more: 0 },
    }));
  });

  afterAll(async () => {
    await cast?.cleanup();
    await removeUsers(db, extraUsers);
    await app?.close();
    await connection.close();
  });

  const people = () => [cast.designer, cast.designManager, cast.writer, cast.contentManager];

  beforeEach(async () => {
    const ids = people().map((person) => person.id);
    await db.delete(notifications).where(inArray(notifications.recipientId, ids));
    await db.delete(emailDigests).where(inArray(emailDigests.userId, ids));
    await db.delete(emailMessages).where(sentTo(ids));
    digestTasks.clear();
  });

  const sentTo = (ids: string[]) =>
    sql`exists (select 1 from jsonb_array_elements(${emailMessages.to}) as r
      where r->>'userId' in ${ids})`;

  const task = (title = 'تصاميم منيو الخريف') => ({
    title,
    department: 'design' as const,
    client: null,
    project: null,
  });

  async function notify(recipients: string[], notice: Partial<Notice> = {}) {
    await db.transaction((tx) =>
      center.notify(tx, {
        type: 'task_assigned',
        data: { task: task() },
        recipients,
        actorId: null,
        subjectId: newId(),
        ...notice,
      } as Notice),
    );
  }

  const rowsOf = (userId: string) =>
    db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientId, userId))
      .orderBy(desc(notifications.createdAt));

  const emailsTo = (userId: string) =>
    db
      .select()
      .from(emailMessages)
      .where(sentTo([userId]))
      .orderBy(desc(emailMessages.createdAt));

  async function saveSettings(cookie: string, body: Record<string, unknown>) {
    const response = await client.request('PUT', '/api/me/notification-settings', {
      cookie,
      body: { mutedTypes: [], ...body },
    });
    expect(response.status).toBe(200);
    return notificationSettingsSchema.parse(await response.json());
  }

  const typeOf = (settings: NotificationSettings, type: string) =>
    settings.types.find((item) => item.type === type);

  describe('settings (rules 2 and 11)', () => {
    it('shows the catalog defaults, then saves email choices and the digest switch', async () => {
      const { cookie } = cast.contentManager;
      const response = await client.request('GET', '/api/me/notification-settings', { cookie });
      const defaults = notificationSettingsSchema.parse(await response.json());
      expect(defaults.digestEnabled).toBe(true);
      expect(typeOf(defaults, 'task_assigned')).toMatchObject({ email: true, emailLocked: false });
      expect(typeOf(defaults, 'task_commented')).toMatchObject({ email: false });

      const saved = await saveSettings(cookie, {
        mutedTypes: ['task_mentioned'],
        // A type that cannot be muted can still be emailed (owner decision).
        emailTypes: ['task_review_requested', 'task_mentioned'],
        digestEnabled: false,
      });
      expect(saved.digestEnabled).toBe(false);
      expect(typeOf(saved, 'task_review_requested')?.email).toBe(true);
      expect(typeOf(saved, 'task_assigned')?.email).toBe(false);
      // Muted in the app: nothing to email, the switch locked; the choice stays.
      expect(typeOf(saved, 'task_mentioned')).toMatchObject({ email: true, emailLocked: true });

      // The screen saves every switch as it reads them: a muted type keeps its choice.
      const resaved = await saveSettings(cookie, {
        mutedTypes: ['task_mentioned'],
        emailTypes: saved.types.filter((item) => item.email).map((item) => item.type),
      });
      expect(typeOf(resaved, 'task_mentioned')).toMatchObject({ email: true, emailLocked: true });

      // Leaving them out keeps them.
      const kept = await saveSettings(cookie, { mutedTypes: [] });
      expect(kept.digestEnabled).toBe(false);
      expect(typeOf(kept, 'task_mentioned')).toMatchObject({ email: true, emailLocked: false });
      await saveSettings(cookie, { emailTypes: [...emailedDefaults()], digestEnabled: true });
    });
  });

  const emailedDefaults = () => [
    'task_assigned',
    'task_mentioned',
    'task_due_soon',
    'task_overdue',
    'task_overdue_escalated',
    'approval_responded',
    'invoice_paid',
  ];

  describe('marking (rules 3, 4 and 8)', () => {
    it('marks an emailed type pending for 10 minutes, and leaves the others alone', async () => {
      const before = Date.now();
      await notify([cast.designer.id]);
      await notify([cast.designer.id], {
        type: 'task_commented',
        data: { task: task(), excerpt: 'تعليق' },
      });
      const [commented, assigned] = await rowsOf(cast.designer.id);
      expect(assigned?.emailState).toBe('pending');
      const delay = (assigned?.emailAfter?.getTime() ?? 0) - before;
      expect(delay).toBeGreaterThanOrEqual(10 * 60 * 1000);
      expect(delay).toBeLessThan(11 * 60 * 1000);
      expect(commented?.emailState).toBeNull();
    });

    it('emails no invited user', async () => {
      const invited = await seedUser(db, { password: null });
      extraUsers.push(invited.id);
      await notify([invited.id]);
      const [row] = await rowsOf(invited.id);
      expect(row?.emailState).toBeNull();
    });

    it('skips the assignee reminders the digest covers, unless the digest is off', async () => {
      const dueSoon = {
        type: 'task_due_soon' as const,
        data: { task: task(), dueDate: workDay, dueTime: null },
        digestCovered: true,
      };
      await saveSettings(cast.writer.cookie, { digestEnabled: false });
      await notify([cast.designer.id, cast.writer.id], dueSoon);
      expect((await rowsOf(cast.designer.id))[0]?.emailState).toBe('skipped');
      expect((await rowsOf(cast.writer.id))[0]?.emailState).toBe('pending');
      // Managers of an unassigned task are emailed normally.
      await notify([cast.designManager.id], {
        type: 'task_overdue',
        data: { task: task(), dueDate: workDay, dueTime: null },
        digestCovered: false,
      });
      expect((await rowsOf(cast.designManager.id))[0]?.emailState).toBe('pending');
      await saveSettings(cast.writer.cookie, { digestEnabled: true });
    });

    it('puts a merged comment back to pending, so a later batch carries it once', async () => {
      await saveSettings(cast.designer.cookie, { emailTypes: ['task_commented'] });
      const subjectId = newId();
      const comment = {
        type: 'task_commented' as const,
        data: { task: task(), excerpt: 'أول' },
        subjectId,
      };
      await notify([cast.designer.id], comment);
      expect(await emails.runBatches(at('10:00'))).toBeGreaterThanOrEqual(1);
      expect((await rowsOf(cast.designer.id))[0]?.emailState).toBe('sent');

      await notify([cast.designer.id], { ...comment, data: { task: task(), excerpt: 'ثان' } });
      const [merged] = await rowsOf(cast.designer.id);
      expect(merged).toMatchObject({ count: 2, emailState: 'pending' });
      await emails.runBatches(at('10:30'));
      expect(await emailsTo(cast.designer.id)).toHaveLength(2);
      await saveSettings(cast.designer.cookie, { emailTypes: emailedDefaults() });
    });
  });

  describe('batches (rules 5–9)', () => {
    it('sends nothing outside 08:10–20:00 or on a Friday', async () => {
      await notify([cast.designer.id]);
      expect(await emails.runBatches(at('08:09'))).toBe(0);
      expect(await emails.runBatches(at('20:00'))).toBe(0);
      expect(await emails.runBatches(at('10:00', friday))).toBe(0);
      expect(await emailsTo(cast.designer.id)).toHaveLength(0);
    });

    it('waits until email_after, then sends one email titled with the item', async () => {
      await notify([cast.designer.id]);
      await db
        .update(notifications)
        .set({ emailAfter: at('10:05') })
        .where(eq(notifications.recipientId, cast.designer.id));
      await emails.runBatches(at('10:00'));
      expect(await emailsTo(cast.designer.id)).toHaveLength(0);

      await emails.runBatches(at('10:05'));
      const [email] = await emailsTo(cast.designer.id);
      expect(email).toMatchObject({
        kind: 'notification_batch',
        audience: 'staff',
        status: 'queued',
      });
      expect(email?.subject).toBe('أُسندت إليك «تصاميم منيو الخريف» بواسطة النظام');
      expect(email?.to).toEqual([
        { name: cast.designer.name, email: cast.designer.email, userId: cast.designer.id },
      ]);
      const [row] = await rowsOf(cast.designer.id);
      expect(row).toMatchObject({ emailState: 'sent', emailId: email?.id });

      // Nothing twice.
      await emails.runBatches(at('10:10'));
      expect(await emailsTo(cast.designer.id)).toHaveLength(1);
    });

    it('skips what was read in the app before it was emailed', async () => {
      await notify([cast.designer.id]);
      await notify([cast.designer.id]);
      const [read] = await rowsOf(cast.designer.id);
      await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(eq(notifications.id, read?.id ?? ''));
      await emails.runBatches(at('10:00'));
      const [email] = await emailsTo(cast.designer.id);
      const data = EMAIL_DATA_SCHEMAS.notification_batch.parse(email?.data);
      expect(data.notifications.items.map((item) => item.id)).not.toContain(read?.id);
      expect(data.notifications.items).toHaveLength(1);
      const states = new Map(
        (await rowsOf(cast.designer.id)).map((row) => [row.id, row.emailState]),
      );
      expect(states.get(read?.id ?? '')).toBe('skipped');
    });

    it('carries the newest 20 and counts the rest', async () => {
      for (let i = 0; i < 21; i += 1) {
        await notify([cast.designer.id], { data: { task: task(`مهمة ${i}`) } });
      }
      await emails.runBatches(at('10:00'));
      const sent = await emailsTo(cast.designer.id);
      expect(sent).toHaveLength(1);
      const data = EMAIL_DATA_SCHEMAS.notification_batch.parse(sent[0]?.data);
      expect(data.notifications.items).toHaveLength(20);
      expect(data.notifications.more).toBe(1);
      expect(data.notifications.items[0]?.data).toMatchObject({ task: { title: 'مهمة 20' } });
      expect(sent[0]?.subject).toBe('لديك 21 إشعارًا جديدًا');
      const rows = await rowsOf(cast.designer.id);
      expect(rows.every((row) => row.emailState === 'sent')).toBe(true);
    });

    it('skips the pending notifications of an archived recipient (edge case 6)', async () => {
      const leaving = await seedUser(db);
      extraUsers.push(leaving.id);
      await notify([leaving.id]);
      await db.update(users).set({ archivedAt: new Date() }).where(eq(users.id, leaving.id));
      await emails.runBatches(at('10:00'));
      expect(await emailsTo(leaving.id)).toHaveLength(0);
      expect((await rowsOf(leaving.id))[0]?.emailState).toBe('skipped');
    });
  });

  describe('morning digest (rules 7, 10–12)', () => {
    const lateTask = {
      id: newId(),
      title: 'تصوير الأطباق',
      client: 'مطعم الشام',
      dueDate: addDays(workDay, -2),
      dueTime: null,
      daysLate: 2,
    };

    it('sends the tasks and the notifications held overnight, once a day', async () => {
      digestTasks.set(cast.designer.id, [lateTask]);
      await notify([cast.designer.id]);
      await notify([cast.designer.id]);
      const [read] = await rowsOf(cast.designer.id);
      await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(eq(notifications.id, read?.id ?? ''));

      await emails.runDigest(workDay, at('08:00'));
      const [digest] = await emailsTo(cast.designer.id);
      expect(digest).toMatchObject({ kind: 'digest' });
      const data = EMAIL_DATA_SCHEMAS.digest.parse(digest?.data);
      expect(data.date).toBe(workDay);
      expect(data.overdue.items).toEqual([lateTask]);
      expect(data.notifications.items).toHaveLength(1);
      expect(data.unreadCount).toBe(1);
      const [key] = await db
        .select()
        .from(emailDigests)
        .where(
          and(eq(emailDigests.userId, cast.designer.id), eq(emailDigests.digestDate, workDay)),
        );
      expect(key?.emailId).toBe(digest?.id);
      const states = (await rowsOf(cast.designer.id)).map((row) => row.emailState).sort();
      expect(states).toEqual(['sent', 'skipped']);

      // A second run, or the 08:10 batch, sends nothing more.
      await emails.runDigest(workDay, at('08:00'));
      await emails.runBatches(at('08:10'));
      expect(await emailsTo(cast.designer.id)).toHaveLength(1);
    });

    it('sends nothing and keeps no key when the three lists are empty', async () => {
      await emails.runDigest(workDay, at('08:00'));
      expect(await emailsTo(cast.contentManager.id)).toHaveLength(0);
      const keys = await db
        .select()
        .from(emailDigests)
        .where(eq(emailDigests.userId, cast.contentManager.id));
      expect(keys).toHaveLength(0);
    });

    it('sends nothing to a user who turned it off, nor on a Friday', async () => {
      digestTasks.set(cast.writer.id, [lateTask]);
      await saveSettings(cast.writer.cookie, { digestEnabled: false });
      await emails.runDigest(workDay, at('08:00'));
      expect(await emailsTo(cast.writer.id)).toHaveLength(0);
      await saveSettings(cast.writer.cookie, { digestEnabled: true });
      expect(await emails.runDigest(friday, at('08:00', friday))).toBe(0);
    });
  });

  describe('the tasks digest source (rule 10)', () => {
    it("lists the user's overdue tasks and those due today, with the days late", async () => {
      const client = await cast.createClient();
      const today = businessDate();
      const dueToday = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
        clientId: client.id,
        dueDate: today,
      });
      const late = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designer.id,
        clientId: client.id,
      });
      await db
        .update(tasks)
        .set({ dueDate: addDays(today, -3) })
        .where(eq(tasks.id, late.id));
      const someoneElse = await cast.createTask(cast.designManager.cookie, {
        assigneeId: cast.designManager.id,
        dueDate: today,
      });

      const digest = await app
        .get(TaskDigest)
        .digest(cast.designer.id, businessInstant(today, '08:00'));
      expect(digest.overdue.items.map((item) => item.id)).toContain(late.id);
      expect(digest.overdue.items.find((item) => item.id === late.id)).toMatchObject({
        daysLate: 3,
        client: client.tradeName,
      });
      expect(digest.dueToday.items.map((item) => item.id)).toContain(dueToday.id);
      const all = [...digest.overdue.items, ...digest.dueToday.items].map((item) => item.id);
      expect(all).not.toContain(someoneElse.id);
    });
  });
});
