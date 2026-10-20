import type { INestApplication } from '@nestjs/common';
import {
  type Announcement,
  addDays,
  announcementHomeSchema,
  announcementPageSchema,
  announcementReceiptsSchema,
  announcementSchema,
  businessDate,
  type CreateAnnouncementInput,
  type ErrorResponse,
  nextWorkDay,
  remindAnnouncementResultSchema,
} from '@vertex-hub/contracts';
import {
  announcementRecipients,
  announcements,
  auditEntries,
  createDatabase,
  notifications,
  users,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AnnouncementDelivery } from '../src/modules/announcements/announcement-delivery.js';
import { api, removeUsers, seedUser } from './helpers.js';
import { startApp } from './start-app.js';

type Person = { id: string; cookie: string };

describe('announcements (F16 part D)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  const seeded: string[] = [];
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let delivery: AnnouncementDelivery;
  let author: Person;
  let designer: Person;
  let photographer: Person;
  let outsider: Person;
  let photoManager: Person;
  let gm: Person;

  const body = (text = 'يبدأ الدوام في رمضان الساعة العاشرة') => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

  const input = (overrides: Partial<CreateAnnouncementInput> = {}): CreateAnnouncementInput => ({
    title: 'دوام رمضان',
    body: body() as CreateAnnouncementInput['body'],
    priority: 'normal',
    requiresAck: true,
    audience: { users: [designer.id, photographer.id] },
    send: 'now',
    ...overrides,
  });

  async function create(person: Person, overrides: Partial<CreateAnnouncementInput> = {}) {
    const response = await client.post('/api/announcements', person.cookie, input(overrides));
    expect(response.status).toBe(201);
    return announcementSchema.parse(await response.json());
  }

  async function expectError(response: Response, status: number, code: string) {
    expect(response.status).toBe(status);
    expect(((await response.json()) as ErrorResponse).code).toBe(code);
  }

  const read = async (person: Person, id: string) => {
    const response = await client.get(`/api/announcements/${id}`, person.cookie);
    return {
      status: response.status,
      body: response.ok ? announcementSchema.parse(await response.json()) : null,
    };
  };

  const receipt = async (announcementId: string, userId: string) => {
    const [row] = await db
      .select()
      .from(announcementRecipients)
      .where(
        and(
          eq(announcementRecipients.announcementId, announcementId),
          eq(announcementRecipients.userId, userId),
        ),
      );
    return row;
  };

  const notificationsOf = (subjectId: string, recipientId?: string) =>
    db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.subjectId, subjectId),
          recipientId ? eq(notifications.recipientId, recipientId) : undefined,
        ),
      );

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    delivery = app.get(AnnouncementDelivery);
    const signedIn = async (input: Parameters<typeof seedUser>[1] = {}) => {
      const user = await seedUser(db, input);
      seeded.push(user.id);
      return { id: user.id, cookie: await client.signIn(user.email) };
    };
    author = await signedIn();
    designer = await signedIn();
    photographer = await signedIn({ departments: [{ code: 'photography' }] });
    outsider = await signedIn();
    const manager = await client.signInWithTwoFactor(db, {
      departments: [{ code: 'photography', manager: true }],
    });
    seeded.push(manager.id);
    photoManager = { id: manager.id, cookie: manager.cookie };
    const general = await client.signInWithTwoFactor(db, { roles: ['general_manager'] });
    seeded.push(general.id);
    gm = { id: general.id, cookie: general.cookie };
  });

  afterAll(async () => {
    await app?.close();
    await removeUsers(db, seeded);
    await connection.close();
  });

  it('answers 401 without a session', async () => {
    const sent = await create(author);
    const id = sent.id;
    expect((await client.get('/api/announcements')).status).toBe(401);
    expect((await client.get('/api/announcements/home')).status).toBe(401);
    expect((await client.post('/api/announcements', undefined, input())).status).toBe(401);
    expect((await client.get(`/api/announcements/${id}`)).status).toBe(401);
    expect((await client.get(`/api/announcements/${id}/receipts`)).status).toBe(401);
    expect(
      (await client.request('PATCH', `/api/announcements/${id}`, { body: { title: 'عنوان' } }))
        .status,
    ).toBe(401);
    for (const action of [
      'send',
      'cancel-schedule',
      'withdraw',
      'archive',
      'acknowledge',
      'remind',
    ]) {
      expect((await client.post(`/api/announcements/${id}/${action}`)).status).toBe(401);
    }
  });

  it("answers 404 for someone else's draft or scheduled announcement", async () => {
    const draft = await create(author, { send: 'draft' });
    const scheduled = await create(author, {
      send: 'schedule',
      scheduledAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    for (const person of [designer, gm]) {
      expect((await read(person, draft.id)).status).toBe(404);
      expect((await client.post(`/api/announcements/${draft.id}/send`, person.cookie)).status).toBe(
        404,
      );
      expect(
        (await client.post(`/api/announcements/${draft.id}/archive`, person.cookie)).status,
      ).toBe(404);
      expect(
        (
          await client.request('PATCH', `/api/announcements/${draft.id}`, {
            cookie: person.cookie,
            body: { title: 'عنوان آخر' },
          })
        ).status,
      ).toBe(404);
      expect(
        (await client.post(`/api/announcements/${scheduled.id}/cancel-schedule`, person.cookie))
          .status,
      ).toBe(404);
    }
  });

  it('sends at once: freezes the recipients without the author and notifies them (rule D3)', async () => {
    const sent = await create(author, {
      audience: { users: [designer.id, photographer.id, author.id] },
    });
    expect(sent.status).toBe('sent');
    expect(sent.totals).toEqual({ recipients: 2, opened: 0, acknowledged: 0 });
    const rows = await notificationsOf(sent.id);
    expect(rows.map((row) => row.recipientId).sort()).toEqual(
      [designer.id, photographer.id].sort(),
    );
    expect(rows.every((row) => row.type === 'announcement' && row.box === 'action')).toBe(true);
    const [audit] = await db
      .select()
      .from(auditEntries)
      .where(and(eq(auditEntries.entityId, sent.id), eq(auditEntries.action, 'announcement.sent')));
    expect(audit?.actorId).toBe(author.id);
  });

  it('refuses an empty audience', async () => {
    await expectError(
      await client.post(
        '/api/announcements',
        author.cookie,
        input({ audience: { users: [author.id] } }),
      ),
      409,
      'EMPTY_AUDIENCE',
    );
  });

  it('lets only announcements.manage covering every recipient send critical or pin (rules D3, D7)', async () => {
    const today = businessDate();
    await expectError(
      await client.post('/api/announcements', author.cookie, input({ priority: 'critical' })),
      403,
      'FORBIDDEN_AUDIENCE',
    );
    await expectError(
      await client.post('/api/announcements', author.cookie, input({ pinnedUntil: today })),
      403,
      'FORBIDDEN_AUDIENCE',
    );
    // A department manager reaches only the members of the departments they manage.
    await expectError(
      await client.post('/api/announcements', photoManager.cookie, input({ priority: 'critical' })),
      403,
      'FORBIDDEN_AUDIENCE',
    );
    const ownDepartment = await create(photoManager, {
      priority: 'critical',
      requiresAck: false,
      audience: { users: [photographer.id] },
    });
    expect(ownDepartment.requiresAck).toBe(true);
    const anyone = await create(gm, { priority: 'critical', pinnedUntil: addDays(today, 7) });
    expect(anyone.status).toBe('sent');
  });

  it('records the first opening; without an acknowledgement, opening resolves it (rule D4)', async () => {
    const plain = await create(author, { requiresAck: false });
    expect((await notificationsOf(plain.id, designer.id))[0]?.box).toBe('info');
    const opened = await read(designer, plain.id);
    expect(opened.status).toBe(200);
    expect(opened.body?.receipt?.openedAt).not.toBeNull();
    expect(opened.body?.audience).toBeNull();
    expect((await receipt(plain.id, designer.id))?.openedAt).not.toBeNull();
    expect((await notificationsOf(plain.id, designer.id))[0]?.resolution).toBe('done');
    expect((await notificationsOf(plain.id, photographer.id))[0]?.resolvedAt).toBeNull();
    await expectError(
      await client.post(`/api/announcements/${plain.id}/acknowledge`, designer.cookie),
      409,
      'NO_ACK_REQUIRED',
    );
    expect((await read(outsider, plain.id)).status).toBe(404);
    const byManager = await read(gm, plain.id);
    expect(byManager.body?.audience).toEqual({ users: [designer.id, photographer.id] });
    expect(byManager.body?.receipt).toBeNull();
  });

  it("acknowledges: closes the recipient's notification and reminders (rule D4)", async () => {
    const sent = await create(author);
    expect(
      (await client.post(`/api/announcements/${sent.id}/acknowledge`, outsider.cookie)).status,
    ).toBe(404);
    expect(
      (await client.post(`/api/announcements/${sent.id}/acknowledge`, designer.cookie)).status,
    ).toBe(204);
    expect((await receipt(sent.id, designer.id))?.acknowledgedAt).not.toBeNull();
    const [row] = await notificationsOf(sent.id, designer.id);
    expect(row?.resolution).toBe('done');
    const [other] = await notificationsOf(sent.id, photographer.id);
    expect(other?.resolvedAt).toBeNull();
  });

  it('shows receipts to the author and managers only, with filters (rule D9)', async () => {
    const sent = await create(author);
    await client.post(`/api/announcements/${sent.id}/acknowledge`, designer.cookie);
    const response = await client.get(`/api/announcements/${sent.id}/receipts`, author.cookie);
    expect(response.status).toBe(200);
    const receipts = announcementReceiptsSchema.parse(await response.json());
    expect(receipts.totals).toEqual({ recipients: 2, opened: 1, acknowledged: 1 });
    const pending = announcementReceiptsSchema.parse(
      await (
        await client.get(
          `/api/announcements/${sent.id}/receipts?filter=not_acknowledged`,
          gm.cookie,
        )
      ).json(),
    );
    expect(pending.items.map((item) => item.user.id)).toEqual([photographer.id]);
    expect(
      (await client.get(`/api/announcements/${sent.id}/receipts`, designer.cookie)).status,
    ).toBe(403);
    expect(
      (await client.get(`/api/announcements/${sent.id}/receipts`, outsider.cookie)).status,
    ).toBe(404);
  });

  it('reminds those who have not acknowledged, once an hour (rule D8)', async () => {
    const sent = await create(author);
    await client.post(`/api/announcements/${sent.id}/acknowledge`, designer.cookie);
    expect(
      (await client.post(`/api/announcements/${sent.id}/remind`, designer.cookie)).status,
    ).toBe(403);
    const response = await client.post(`/api/announcements/${sent.id}/remind`, author.cookie);
    expect(response.status).toBe(200);
    expect(remindAnnouncementResultSchema.parse(await response.json())).toEqual({ reminded: 1 });
    const reminders = (await notificationsOf(sent.id, photographer.id)).filter(
      (row) => row.type === 'announcement_ack_reminder',
    );
    expect(reminders).toHaveLength(1);
    expect((await receipt(sent.id, photographer.id))?.remindersSent).toBe(0);
    expect((await client.post(`/api/announcements/${sent.id}/remind`, author.cookie)).status).toBe(
      429,
    );
  });

  it('edits a sent announcement; locks audience and priority; "Notify again" clears the acknowledgements (rule D10)', async () => {
    const sent = await create(author);
    await client.post(`/api/announcements/${sent.id}/acknowledge`, designer.cookie);
    await expectError(
      await client.request('PATCH', `/api/announcements/${sent.id}`, {
        cookie: author.cookie,
        body: { priority: 'important' },
      }),
      409,
      'LOCKED_FIELD',
    );
    expect(
      (
        await client.request('PATCH', `/api/announcements/${sent.id}`, {
          cookie: designer.cookie,
          body: { title: 'عنوان آخر' },
        })
      ).status,
    ).toBe(403);
    const response = await client.request('PATCH', `/api/announcements/${sent.id}`, {
      cookie: author.cookie,
      body: { title: 'دوام رمضان المعدّل', notifyAgain: true },
    });
    expect(response.status).toBe(200);
    const edited = announcementSchema.parse(await response.json());
    expect(edited.editedAt).not.toBeNull();
    expect(edited.renotifiedAt).not.toBeNull();
    expect((await receipt(sent.id, designer.id))?.acknowledgedAt).toBeNull();
    const [row] = await notificationsOf(sent.id, designer.id);
    expect(row?.resolvedAt).toBeNull();
    expect(row?.readAt).toBeNull();
    expect((row?.data as { title: string } | undefined)?.title).toBe('دوام رمضان المعدّل');
  });

  it('clears the link label while the link stays', async () => {
    const sent = await create(author, { linkUrl: 'https://vertex.example/a', linkLabel: 'الملف' });
    const response = await client.request('PATCH', `/api/announcements/${sent.id}`, {
      cookie: author.cookie,
      body: { linkLabel: null },
    });
    const edited = announcementSchema.parse(await response.json());
    expect(edited.linkUrl).toBe('https://vertex.example/a');
    expect(edited.linkLabel).toBeNull();
  });

  it('withdraws: voids the notifications and leaves the lists of recipients (rule D10)', async () => {
    const plain = await create(author, { requiresAck: false });
    expect(
      (await client.post(`/api/announcements/${plain.id}/withdraw`, author.cookie)).status,
    ).toBe(200);
    expect((await notificationsOf(plain.id)).every((row) => row.resolution === 'void')).toBe(true);
    const sent = await create(author);
    expect(
      (await client.post(`/api/announcements/${sent.id}/withdraw`, designer.cookie)).status,
    ).toBe(403);
    const response = await client.post(`/api/announcements/${sent.id}/withdraw`, gm.cookie);
    expect(response.status).toBe(200);
    expect(announcementSchema.parse(await response.json()).withdrawnBy?.id).toBe(gm.id);
    expect((await notificationsOf(sent.id)).every((row) => row.resolution === 'void')).toBe(true);
    expect((await read(designer, sent.id)).status).toBe(404);
    expect((await read(author, sent.id)).body?.status).toBe('withdrawn');
    const received = announcementPageSchema.parse(
      await (await client.get('/api/announcements', designer.cookie)).json(),
    );
    expect(received.items.map((item) => item.id)).not.toContain(sent.id);
    const mine = announcementPageSchema.parse(
      await (await client.get('/api/announcements?view=sent', author.cookie)).json(),
    );
    expect(mine.items.find((item) => item.id === sent.id)?.status).toBe('withdrawn');
    await expectError(
      await client.post(`/api/announcements/${sent.id}/withdraw`, author.cookie),
      409,
      'ALREADY_WITHDRAWN',
    );
  });

  it('keeps drafts private, sends them, and discards them by archiving', async () => {
    const draft = await create(author, { send: 'draft' });
    expect(draft.status).toBe('draft');
    expect(await notificationsOf(draft.id)).toHaveLength(0);
    expect((await read(gm, draft.id)).status).toBe(404);
    const sent = await client.post(`/api/announcements/${draft.id}/send`, author.cookie);
    expect(announcementSchema.parse(await sent.json()).status).toBe('sent');
    await expectError(
      await client.post(`/api/announcements/${draft.id}/archive`, author.cookie),
      409,
      'NOT_DRAFT',
    );
    const other = await create(author, { send: 'draft' });
    expect(
      (await client.post(`/api/announcements/${other.id}/archive`, author.cookie)).status,
    ).toBe(204);
    expect((await read(author, other.id)).status).toBe(404);
  });

  it('schedules, cancels and sends at the time; an emptied audience goes back to draft (rule D5, edge case 17)', async () => {
    const at = new Date(Date.now() + 10 * 60_000);
    await expect(
      client.post('/api/announcements', author.cookie, input({ send: 'schedule' })),
    ).resolves.toHaveProperty('status', 400);
    const scheduled = await create(author, { send: 'schedule', scheduledAt: at.toISOString() });
    expect(scheduled.status).toBe('scheduled');
    const cancelled = announcementSchema.parse(
      await (
        await client.post(`/api/announcements/${scheduled.id}/cancel-schedule`, author.cookie)
      ).json(),
    );
    expect(cancelled.status).toBe('draft');
    await expectError(
      await client.post(`/api/announcements/${scheduled.id}/cancel-schedule`, author.cookie),
      409,
      'NOT_SCHEDULED',
    );
    const again = await client.post(`/api/announcements/${scheduled.id}/send`, author.cookie, {
      scheduledAt: at.toISOString(),
    });
    expect(announcementSchema.parse(await again.json()).status).toBe('scheduled');
    await delivery.sendScheduled(new Date(at.getTime() + 60_000));
    expect((await read(author, scheduled.id)).body?.status).toBe('sent');
    expect(await notificationsOf(scheduled.id)).toHaveLength(2);

    const lonely = await seedUser(db);
    seeded.push(lonely.id);
    const emptied = await create(author, {
      send: 'schedule',
      scheduledAt: at.toISOString(),
      audience: { users: [lonely.id] },
    });
    await db.update(users).set({ archivedAt: new Date() }).where(eq(users.id, lonely.id));
    await delivery.sendScheduled(new Date(at.getTime() + 60_000));
    const back = (await read(author, emptied.id)).body as Announcement;
    expect(back.status).toBe('draft');
    expect(back.unsentAt).not.toBeNull();

    // An author archived before the time: not sent, back to draft (rule D5).
    const leaving = await seedUser(db);
    seeded.push(leaving.id);
    const leavingPerson = { id: leaving.id, cookie: await client.signIn(leaving.email) };
    const orphan = await create(leavingPerson, { send: 'schedule', scheduledAt: at.toISOString() });
    await db.update(users).set({ archivedAt: new Date() }).where(eq(users.id, leaving.id));
    await delivery.sendScheduled(new Date(at.getTime() + 60_000));
    const [row] = await db.select().from(announcements).where(eq(announcements.id, orphan.id));
    expect(row?.status).toBe('draft');
    expect(await notificationsOf(orphan.id)).toHaveLength(0);
  });

  it('lists received, sent and all; all needs announcements.manage scope all', async () => {
    const sent = await create(author, { title: 'إعلان للقائمة' });
    const received = announcementPageSchema.parse(
      await (await client.get('/api/announcements?search=للقائمة', designer.cookie)).json(),
    );
    expect(received.items.map((item) => item.id)).toEqual([sent.id]);
    expect(received.items[0]?.totals).toBeNull();
    expect((await client.get('/api/announcements?view=all', author.cookie)).status).toBe(403);
    const all = announcementPageSchema.parse(
      await (await client.get('/api/announcements?view=all&search=للقائمة', gm.cookie)).json(),
    );
    expect(all.items[0]?.totals?.recipients).toBe(2);
  });

  it('shows pinned and unacknowledged critical announcements on the home page (rules D6, D7)', async () => {
    const pinned = await create(gm, {
      title: 'إعلان مثبت',
      requiresAck: false,
      pinnedUntil: businessDate(),
    });
    const critical = await create(gm, { title: 'إعلان حرج', priority: 'critical' });
    const home = announcementHomeSchema.parse(
      await (await client.get('/api/announcements/home', designer.cookie)).json(),
    );
    expect(home.pinned.map((item) => item.id)).toContain(pinned.id);
    expect(home.critical.map((item) => item.id)).toContain(critical.id);
    await client.post(`/api/announcements/${critical.id}/acknowledge`, designer.cookie);
    const after = announcementHomeSchema.parse(
      await (await client.get('/api/announcements/home', designer.cookie)).json(),
    );
    expect(after.critical.map((item) => item.id)).not.toContain(critical.id);
    expect(
      announcementHomeSchema
        .parse(await (await client.get('/api/announcements/home', outsider.cookie)).json())
        .pinned.map((item) => item.id),
    ).not.toContain(pinned.id);
  });

  it('holds up to five attachments, added by the author and read by the recipients (F10)', async () => {
    const sent = await create(author);
    const attach = (person: Person, n: number) =>
      client.post('/api/files/items', person.cookie, {
        ownerType: 'announcement',
        ownerId: sent.id,
        role: 'attachment',
        source: { url: `https://vertex.example/file-${n}`, label: `ملف ${n}` },
      });
    for (let n = 1; n <= 5; n += 1) expect((await attach(author, n)).status).toBe(201);
    await expectError(await attach(author, 6), 409, 'LIMIT_REACHED');
    expect((await attach(designer, 7)).status).toBe(403);
    const list = (person: Person) =>
      client.get(`/api/files/items?ownerType=announcement&ownerId=${sent.id}`, person.cookie);
    const listed = await list(designer);
    expect(listed.status).toBe(200);
    expect(((await listed.json()) as { items: unknown[] }).items).toHaveLength(5);
    expect((await list(outsider)).status).toBe(404);
  });

  it('reminds daily three times from the next work day, then tells the author once (rule D8)', async () => {
    const sent = await create(author, { title: 'إعلان التذكيرات' });
    await client.post(`/api/announcements/${sent.id}/acknowledge`, designer.cookie);
    // Days before any other announcement of this file was sent, so only this one is due.
    const day0 = '2026-01-04';
    await db
      .update(announcements)
      .set({ sentAt: new Date(`${day0}T08:00:00Z`) })
      .where(eq(announcements.id, sent.id));
    await delivery.remindUnacknowledged(day0);
    expect((await receipt(sent.id, photographer.id))?.remindersSent).toBe(0);
    let day = day0;
    for (let round = 1; round <= 3; round += 1) {
      day = nextWorkDay(day);
      await delivery.remindUnacknowledged(day);
      // A second run on the same day sends nothing again.
      await delivery.remindUnacknowledged(day);
      expect((await receipt(sent.id, photographer.id))?.remindersSent).toBe(round);
      // The author's summary waits for the third round, reruns included.
      const summaries = (await notificationsOf(sent.id, author.id)).filter(
        (row) => row.type === 'announcement_ack_summary',
      );
      expect(summaries).toHaveLength(round === 3 ? 1 : 0);
    }
    expect((await receipt(sent.id, designer.id))?.remindersSent).toBe(0);
    const reminders = (await notificationsOf(sent.id, photographer.id)).filter(
      (row) => row.type === 'announcement_ack_reminder',
    );
    expect(reminders).toHaveLength(3);
    await delivery.remindUnacknowledged(nextWorkDay(day));
    const summaries = (await notificationsOf(sent.id, author.id)).filter(
      (row) => row.type === 'announcement_ack_summary',
    );
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.data).toEqual({ title: 'إعلان التذكيرات', pending: 1 });
    expect((await receipt(sent.id, photographer.id))?.remindersSent).toBe(3);
  });
});
