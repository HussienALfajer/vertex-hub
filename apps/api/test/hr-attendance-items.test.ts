import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  attendanceDateSubjectId,
  attendanceDaySchema,
  attendanceItemDetailSchema,
  attendanceItemPageSchema,
  attendanceItemSchema,
  businessDate,
  businessInstant,
  hrOpinionSchema,
  hrRequestSchema,
  myAttendanceTodaySchema,
  punchResultSchema,
  todayBoardSchema,
  WEEKDAYS,
  webAuthnChallengeSchema,
  weekdayOf,
  workScheduleSchema,
} from '@vertex-hub/contracts';
import {
  attendanceDays,
  attendanceItems,
  attendanceKiosks,
  attendancePunches,
  auditEntries,
  createDatabase,
  hrSettings,
  leaveLedger,
  notifications,
  timedReminders,
  workScheduleDays,
  workSchedules,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AttendanceReminders } from '../src/modules/hr/attendance-reminders.js';
import { api, removeUsers, seedUser } from './helpers.js';
import { SoftAuthenticator } from './soft-authenticator.js';
import { startApp } from './start-app.js';

type Person = { id: string; cookie: string; name: string };

/** Damascus, inside the office: where the remote and field punches of these tests are. */
const LOCATION = { latitude: 33.5138, longitude: 36.2765, accuracyM: 12 };

describe('HR attendance decisions: items, corrections, remote days, field review (F17 part C)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  const seeded: string[] = [];
  const schedules: string[] = [];
  const kioskIds: string[] = [];
  const marker = `HRI${Date.now()}`;
  const today = businessDate();
  // Two past days of the employee's (rule C19: corrections are for moments that have passed).
  const firstDay = addDays(today, -3);
  const secondDay = addDays(today, -2);
  const sameMonth = firstDay.slice(0, 7) === secondDay.slice(0, 7);
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let gm: Person;
  let ops: Person;
  let manager: Person;
  let designManager: Person;
  let employee: Person;
  let colleague: Person;
  let startsOnBefore: string | null = null;
  const phone = new SoftAuthenticator();

  const call = (method: string, path: string, person: Person | undefined, body?: unknown) =>
    client.request(method, path, { cookie: person?.cookie, body });

  const ok = async (response: Response, status = 200) => {
    expect(response.status, await response.clone().text()).toBe(status);
    return response.json();
  };

  const code = async (response: Response) => ((await response.json()) as { code?: string }).code;

  /** A correction the GM records for someone: approved at once, its punch written (rule C19). */
  const correct = async (person: Person, date: string, direction: 'in' | 'out', time: string) =>
    hrRequestSchema.parse(
      await ok(
        await call('POST', '/api/hr/requests', gm, {
          kind: 'correction',
          userId: person.id,
          date,
          direction,
          time,
          reason: 'نسي التسجيل',
        }),
        201,
      ),
    );

  const itemsOf = async (person: Person, date: string) =>
    db
      .select({ item: attendanceItems })
      .from(attendanceItems)
      .innerJoin(attendanceDays, eq(attendanceDays.id, attendanceItems.dayId))
      .where(and(eq(attendanceItems.userId, person.id), eq(attendanceDays.date, date)))
      .then((rows) => rows.map((row) => row.item));

  const liveItem = async (person: Person, date: string, kind: string) =>
    (await itemsOf(person, date)).find((item) => item.kind === kind && item.status !== 'void');

  const noticesOf = (person: Person, type: string) =>
    db
      .select()
      .from(notifications)
      .where(and(eq(notifications.recipientId, person.id), eq(notifications.type, type as never)));

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    const plain = async (input: Parameters<typeof seedUser>[1] = {}) => {
      const user = await seedUser(db, input);
      seeded.push(user.id);
      return { id: user.id, name: user.name, cookie: await client.signIn(user.email) };
    };
    const secured = async (input: NonNullable<Parameters<typeof seedUser>[1]>) => {
      const user = await client.signInWithTwoFactor(db, input);
      seeded.push(user.id);
      return { id: user.id, name: user.name, cookie: user.cookie };
    };
    gm = await secured({ roles: ['general_manager'], name: `${marker} مدير` });
    ops = await secured({
      departments: [{ code: 'internal_operations', manager: true }],
      name: `${marker} عمليات`,
    });
    manager = await plain({
      departments: [{ code: 'photography', manager: true }],
      name: `${marker} مدير تصوير`,
    });
    designManager = await plain({
      departments: [{ code: 'design', manager: true }],
      name: `${marker} مدير تصميم`,
    });
    employee = await plain({ departments: [{ code: 'photography' }], name: `سامر ${marker}` });
    colleague = await plain({ departments: [{ code: 'photography' }], name: `رنا ${marker}` });
    // 09:00–17:00 every day, so every date of these tests is a work day.
    const schedule = workScheduleSchema.parse(
      await ok(
        await call('POST', '/api/hr/schedules', ops, {
          name: `${marker} يومي`,
          kind: 'fixed',
          days: WEEKDAYS.map((weekday) => ({
            weekday,
            startTime: '09:00',
            latestStartTime: null,
            requiredMinutes: 480,
          })),
        }),
        201,
      ),
    );
    schedules.push(schedule.id);
    for (const person of [employee, colleague]) {
      await ok(
        await call('PATCH', `/api/hr/employees/${person.id}`, ops, {
          startDate: addDays(today, -30),
          scheduleId: schedule.id,
        }),
      );
    }
    // Rule C1: out of trial for these tests; the API takes only today or later, so the row.
    const [settings] = await db.select().from(hrSettings);
    startsOnBefore = settings?.attendanceStartsOn ?? null;
    await db.update(hrSettings).set({ attendanceStartsOn: addDays(today, -30) });
  });

  afterAll(async () => {
    await app?.close();
    await db.update(hrSettings).set({ attendanceStartsOn: startsOnBefore });
    const ids = [...seeded, ...kioskIds];
    if (ids.length > 0) {
      await db.delete(notifications).where(inArray(notifications.subjectId, ids));
      await db.delete(auditEntries).where(inArray(auditEntries.entityId, ids));
      await db.delete(timedReminders).where(inArray(timedReminders.subjectId, ids));
    }
    for (const date of [firstDay, secondDay, today]) {
      await db
        .delete(notifications)
        .where(
          and(
            eq(notifications.subjectId, attendanceDateSubjectId(date)),
            inArray(notifications.recipientId, seeded),
          ),
        );
    }
    const items = await db
      .select({ id: attendanceItems.id })
      .from(attendanceItems)
      .where(inArray(attendanceItems.userId, seeded));
    const punches = await db
      .select({ id: attendancePunches.id })
      .from(attendancePunches)
      .where(inArray(attendancePunches.userId, seeded));
    const touched = [...items, ...punches].map((row) => row.id);
    if (touched.length > 0) {
      await db.delete(auditEntries).where(inArray(auditEntries.entityId, touched));
    }
    await removeUsers(db, seeded);
    if (schedules.length > 0) {
      await db.delete(workScheduleDays).where(inArray(workScheduleDays.scheduleId, schedules));
      await db.delete(workSchedules).where(inArray(workSchedules.id, schedules));
    }
    await connection.close();
  });

  it('answers 401 without a session and 403 without the permission', async () => {
    const id = '01900000-0000-7000-8000-000000000000';
    expect((await call('GET', '/api/hr/items', undefined)).status).toBe(401);
    expect((await call('GET', `/api/hr/items/${id}`, undefined)).status).toBe(401);
    expect(
      (await call('POST', `/api/hr/items/${id}/justification`, undefined, { text: 'x' })).status,
    ).toBe(401);
    expect(
      (await call('POST', `/api/hr/items/${id}/decision`, ops, { decision: 'waived' })).status,
    ).toBe(403);
    expect(
      (await call('POST', `/api/hr/attendance/punches/${id}/reject`, ops, { note: 'x' })).status,
    ).toBe(403);
    expect((await call('GET', '/api/hr/attendance/today', employee)).status).toBe(403);
    expect((await call('GET', '/api/hr/attendance/today', undefined)).status).toBe(401);
  });

  describe('items raised by the day (rules C14, C17)', () => {
    it('raises lateness at the first presence and missing out once the day has ended', async () => {
      await correct(employee, firstDay, 'in', '09:45');
      const late = await liveItem(employee, firstDay, 'lateness');
      expect(late).toMatchObject({ status: 'pending', minutes: 45 });
      // Rule C17: the first lateness of the month is proposed as a warning.
      expect(late?.proposedFraction).toBe(0);
      expect(await liveItem(employee, firstDay, 'missing_out')).toMatchObject({ minutes: 0 });
      const raised = await noticesOf(employee, 'attendance_item_raised');
      expect(raised.some((row) => row.subjectId === late?.id)).toBe(true);
      const [pending] = (await noticesOf(gm, 'attendance_items_pending')).filter(
        (row) => row.subjectId === attendanceDateSubjectId(today),
      );
      expect(pending?.count).toBeGreaterThanOrEqual(2);
    });

    it('voids missing out when an approved correction closes the day', async () => {
      const request = hrRequestSchema.parse(
        await ok(
          await call('POST', '/api/hr/requests', employee, {
            kind: 'correction',
            date: firstDay,
            direction: 'out',
            time: '17:00',
            reason: 'نسيت الانصراف',
          }),
          201,
        ),
      );
      expect(request).toMatchObject({ status: 'pending', correctionDirection: 'out' });
      expect(await liveItem(employee, firstDay, 'missing_out')).toBeDefined();
      await ok(
        await call('POST', `/api/hr/requests/${request.id}/decision`, gm, { decision: 'approve' }),
      );
      expect(await liveItem(employee, firstDay, 'missing_out')).toBeUndefined();
      const [punch] = await db
        .select()
        .from(attendancePunches)
        .where(eq(attendancePunches.requestId, request.id));
      expect(punch).toMatchObject({ method: 'correction', direction: 'out' });
      expect(punch?.at.toISOString()).toBe(businessInstant(firstDay, '17:00').toISOString());
    });

    it('refuses a correction for a moment still to come', async () => {
      const response = await call('POST', '/api/hr/requests', employee, {
        kind: 'correction',
        date: addDays(today, 1),
        direction: 'in',
        time: '09:00',
        reason: 'x',
      });
      expect(response.status).toBe(400);
      expect(await code(response)).toBe('NOT_YET');
    });

    it('proposes the tier for a later lateness, and raises overtime once the day ended', async () => {
      await correct(employee, secondDay, 'in', '09:45');
      await correct(employee, secondDay, 'out', '23:00');
      const late = await liveItem(employee, secondDay, 'lateness');
      expect(late?.proposedFraction).toBe(sameMonth ? 0.5 : 0);
      expect(await liveItem(employee, secondDay, 'overtime')).toMatchObject({ minutes: 360 });
      expect(await liveItem(employee, secondDay, 'missing_out')).toBeUndefined();
    });
  });

  describe('reading, justifying and opinions (rules B14, C17)', () => {
    it('lists items for the employee and those hr.read covers only', async () => {
      const mine = attendanceItemPageSchema.parse(
        await ok(
          await call('GET', `/api/hr/items?userId=me&month=${firstDay.slice(0, 7)}`, employee),
        ),
      );
      expect(mine.items.map((item) => item.kind)).toContain('lateness');
      const covered = attendanceItemPageSchema.parse(
        await ok(await call('GET', `/api/hr/items?userId=${employee.id}`, manager)),
      );
      expect(covered.total).toBeGreaterThan(0);
      const outside = attendanceItemPageSchema.parse(
        await ok(await call('GET', `/api/hr/items?userId=${employee.id}`, designManager)),
      );
      expect(outside.total).toBe(0);
      const others = attendanceItemPageSchema.parse(
        await ok(await call('GET', '/api/hr/items?status=pending', colleague)),
      );
      expect(others.items.every((item) => item.user.id === colleague.id)).toBe(true);
    });

    it('lets the employee justify a pending item, and closes its notice', async () => {
      const late = await liveItem(employee, firstDay, 'lateness');
      expect(
        (await call('POST', `/api/hr/items/${late?.id}/justification`, colleague, { text: 'x' }))
          .status,
      ).toBe(404);
      const justified = attendanceItemSchema.parse(
        await ok(
          await call('POST', `/api/hr/items/${late?.id}/justification`, employee, {
            text: 'زحمة سير',
          }),
        ),
      );
      expect(justified.justification).toBe('زحمة سير');
      const [notice] = (await noticesOf(employee, 'attendance_item_raised')).filter(
        (row) => row.subjectId === late?.id,
      );
      expect(notice?.resolvedAt).not.toBeNull();
    });

    it('takes an opinion from the department manager, and hides the item from others', async () => {
      const late = await liveItem(employee, firstDay, 'lateness');
      const opinion = hrOpinionSchema.parse(
        await ok(
          await call('POST', '/api/hr/opinions', manager, { itemId: late?.id, body: 'ملتزم عادة' }),
          201,
        ),
      );
      expect(opinion).toMatchObject({ itemId: late?.id, requestId: null });
      expect(
        (await call('POST', '/api/hr/opinions', designManager, { itemId: late?.id, body: 'x' }))
          .status,
      ).toBe(404);
      expect((await call('GET', `/api/hr/items/${late?.id}`, designManager)).status).toBe(404);
      const detail = attendanceItemDetailSchema.parse(
        await ok(await call('GET', `/api/hr/items/${late?.id}`, employee)),
      );
      expect(detail.opinions).toHaveLength(1);
      expect(detail.day.date).toBe(firstDay);
      expect(detail.permissions).toMatchObject({ canJustify: true, canDecide: false });
    });
  });

  describe('decisions (rule C18)', () => {
    it('refuses a decision the item does not take', async () => {
      const late = await liveItem(employee, firstDay, 'lateness');
      const decide = (body: unknown) =>
        call('POST', `/api/hr/items/${late?.id}/decision`, gm, body);
      expect(await code(await decide({ decision: 'paid' }))).toBe('INVALID_DECISION');
      // The proposal is a warning (0), so a deduction needs its fraction.
      expect(await code(await decide({ decision: 'deducted' }))).toBe('INVALID_DECISION');
    });

    it('deducts, tells the employee without the fraction, and can change the decision', async () => {
      const late = await liveItem(employee, firstDay, 'lateness');
      const deducted = attendanceItemSchema.parse(
        await ok(
          await call('POST', `/api/hr/items/${late?.id}/decision`, gm, {
            decision: 'deducted',
            fraction: 0.25,
          }),
        ),
      );
      expect(deducted).toMatchObject({ status: 'deducted', decidedFraction: 0.25 });
      const [decided] = (await noticesOf(employee, 'attendance_item_decided')).filter(
        (row) => row.subjectId === late?.id,
      );
      expect(decided?.data).toEqual({ kind: 'lateness', date: firstDay, decision: 'deducted' });
      const warned = attendanceItemSchema.parse(
        await ok(
          await call('POST', `/api/hr/items/${late?.id}/decision`, gm, { decision: 'warned' }),
        ),
      );
      expect(warned).toMatchObject({ status: 'warned', decidedFraction: null });
      expect(
        await code(
          await call('POST', `/api/hr/items/${late?.id}/justification`, employee, { text: 'x' }),
        ),
      ).toBe('NOT_PENDING');
      const [audit] = await db
        .select()
        .from(auditEntries)
        .where(
          and(
            eq(auditEntries.entityId, late?.id ?? ''),
            eq(auditEntries.action, 'attendance_item.decided'),
          ),
        );
      expect(audit).toBeDefined();
    });

    it('credits overtime as time off, and gives the credit back when it changes', async () => {
      const overtime = await liveItem(employee, secondDay, 'overtime');
      const credited = attendanceItemSchema.parse(
        await ok(
          await call('POST', `/api/hr/items/${overtime?.id}/decision`, gm, {
            decision: 'time_off',
          }),
        ),
      );
      // 360 minutes at 480 a day: 0.75, rounded down to a half day.
      expect(credited).toMatchObject({
        status: 'time_off',
        decidedMinutes: 360,
        creditedDays: 0.5,
      });
      const credits = () =>
        db
          .select({ days: leaveLedger.days, itemId: leaveLedger.itemId })
          .from(leaveLedger)
          .where(
            and(eq(leaveLedger.userId, employee.id), eq(leaveLedger.entry, 'overtime_credit')),
          );
      expect((await credits()).map((row) => row.days)).toEqual([0.5]);
      expect(
        await code(
          await call('POST', `/api/hr/items/${overtime?.id}/decision`, gm, {
            decision: 'paid',
            minutes: 361,
          }),
        ),
      ).toBe('INVALID_DECISION');
      const paid = attendanceItemSchema.parse(
        await ok(
          await call('POST', `/api/hr/items/${overtime?.id}/decision`, gm, {
            decision: 'paid',
            minutes: 120,
          }),
        ),
      );
      expect(paid).toMatchObject({ status: 'paid', decidedMinutes: 120, creditedDays: null });
      expect((await credits()).map((row) => row.days).sort()).toEqual([-0.5, 0.5]);
      expect((await credits()).every((row) => row.itemId === overtime?.id)).toBe(true);
    });

    it('voids the items of days attendance no longer applies to (rules C2, C14)', async () => {
      const late = await liveItem(employee, secondDay, 'lateness');
      expect(late?.status).toBe('pending');
      const warned = await liveItem(employee, firstDay, 'lateness');
      expect(warned?.status).toBe('warned');
      // A later start date takes the earlier days out.
      await ok(
        await call('PATCH', `/api/hr/employees/${employee.id}`, ops, {
          startDate: addDays(today, -1),
        }),
      );
      expect(await liveItem(employee, secondDay, 'lateness')).toBeUndefined();
      expect(await liveItem(employee, firstDay, 'lateness')).toBeUndefined();
      const [notice] = (await noticesOf(employee, 'attendance_item_raised')).filter(
        (row) => row.subjectId === late?.id,
      );
      expect(notice?.resolution).toBe('void');
      // The decided lateness of the first day is voided with an audit entry.
      const [voided] = await db
        .select()
        .from(auditEntries)
        .where(
          and(
            eq(auditEntries.entityId, warned?.id ?? ''),
            eq(auditEntries.action, 'attendance_item.voided'),
          ),
        );
      expect(voided).toBeDefined();
    });
  });

  describe('remote days and field punches (rules C8, C11, C12, C19)', () => {
    it('allows remote punches only on an approved remote day', async () => {
      const challenge = webAuthnChallengeSchema.parse(
        await ok(await call('POST', '/api/hr/passkeys/options', employee, {})),
      );
      await ok(
        await call('POST', '/api/hr/passkeys', employee, {
          ticket: challenge.ticket,
          response: phone.register(challenge.options),
        }),
        201,
      );
      const remote = () =>
        call('POST', '/api/hr/attendance/punch/options', employee, {
          method: 'remote',
          ...LOCATION,
        });
      expect(await code(await remote())).toBe('NOT_REMOTE_DAY');
      const request = hrRequestSchema.parse(
        await ok(
          await call('POST', '/api/hr/requests', employee, {
            kind: 'remote_day',
            startsOn: today,
            endsOn: today,
            reason: 'صيانة المكتب',
          }),
          201,
        ),
      );
      expect(request).toMatchObject({ status: 'pending', days: 1, shortNotice: true });
      expect(
        await code(
          await call('POST', '/api/hr/requests', employee, {
            kind: 'remote_day',
            startsOn: today,
            endsOn: today,
            reason: 'x',
          }),
        ),
      ).toBe('REQUEST_OVERLAP');
      await ok(
        await call('POST', `/api/hr/requests/${request.id}/decision`, gm, { decision: 'approve' }),
      );
      const mine = myAttendanceTodaySchema.parse(
        await ok(await call('GET', '/api/hr/attendance/me/today', employee)),
      );
      expect(mine.methods).toContain('remote');
      expect(mine.day?.place).toBe('remote');
      expect((await remote()).status).toBe(200);
    });

    it('tells the GMs of a field punch, rejects it with a note and tells the employee', async () => {
      const first = await call('POST', '/api/hr/attendance/punch/options', employee, {
        method: 'field',
        ...LOCATION,
      });
      const challenge = webAuthnChallengeSchema.parse(await ok(first));
      const result = punchResultSchema.parse(
        await ok(
          await call('POST', '/api/hr/attendance/punch', employee, {
            ticket: challenge.ticket,
            assertion: phone.assert(challenge.options),
            fieldNote: 'زيارة عميل',
          }),
          201,
        ),
      );
      const recorded = (await noticesOf(gm, 'field_punch_recorded')).filter(
        (row) => row.subjectId === attendanceDateSubjectId(today),
      );
      expect(recorded).toHaveLength(1);
      const [correction] = await db
        .select({ id: attendancePunches.id })
        .from(attendancePunches)
        .where(
          and(
            eq(attendancePunches.userId, employee.id),
            eq(attendancePunches.method, 'correction'),
          ),
        );
      expect(
        await code(
          await call('POST', `/api/hr/attendance/punches/${correction?.id}/reject`, gm, {
            note: 'x',
          }),
        ),
      ).toBe('NOT_FIELD');
      const day = attendanceDaySchema.parse(
        await ok(
          await call('POST', `/api/hr/attendance/punches/${result.punch.id}/reject`, gm, {
            note: 'لا يوجد موعد مع العميل',
          }),
        ),
      );
      const rejected = day.punches.find((punch) => punch.id === result.punch.id);
      expect(rejected?.fieldReview).toBe('rejected');
      expect(rejected?.archivedAt).not.toBeNull();
      expect(day.firstInAt).toBeNull();
      expect(await noticesOf(employee, 'field_punch_rejected')).toHaveLength(1);
      expect(
        await code(
          await call('POST', `/api/hr/attendance/punches/${result.punch.id}/reject`, gm, {
            note: 'x',
          }),
        ),
      ).toBe('NOT_FIELD');
    });
  });

  describe('the minute job (rules C21, C22)', () => {
    it('reminds of a missing check-in once, and resolves it with the punch', async () => {
      // Today's day of the colleague, with no punch yet.
      await ok(await call('GET', '/api/hr/attendance/me/today', colleague));
      const reminders = app.get(AttendanceReminders);
      await reminders.run(businessInstant(today, '09:30'));
      await reminders.run(businessInstant(today, '09:31'));
      const reminded = await noticesOf(colleague, 'attendance_check_in_missing');
      expect(reminded).toHaveLength(1);
      expect(reminded[0]?.resolvedAt).toBeNull();
      await correct(colleague, today, 'in', '00:05');
      const [resolved] = await noticesOf(colleague, 'attendance_check_in_missing');
      expect(resolved?.resolvedAt).not.toBeNull();
    });

    it('tells Ops and the GMs of an offline screen in working hours, and closes it on return', async () => {
      const [main] = await db
        .select({
          weekday: workScheduleDays.weekday,
          startTime: workScheduleDays.startTime,
        })
        .from(workScheduleDays)
        .innerJoin(workSchedules, eq(workSchedules.id, workScheduleDays.scheduleId))
        .where(eq(workSchedules.isDefault, true));
      if (!main) throw new Error('No default schedule');
      let date = today;
      while (weekdayOf(date) !== main.weekday) date = addDays(date, 1);
      const now = new Date(
        businessInstant(date, main.startTime.slice(0, 5)).getTime() + 30 * 60_000,
      );
      const kiosk = (await ok(
        await call('POST', '/api/hr/kiosks', ops, { name: `${marker} المدخل` }),
        201,
      )) as { id: string };
      kioskIds.push(kiosk.id);
      await db
        .update(attendanceKiosks)
        .set({ tokenHash: `${marker}-token`, lastSeenAt: new Date(now.getTime() - 20 * 60_000) })
        .where(eq(attendanceKiosks.id, kiosk.id));
      const reminders = app.get(AttendanceReminders);
      await reminders.run(now);
      const offline = (await noticesOf(ops, 'kiosk_offline')).filter(
        (row) => row.subjectId === kiosk.id,
      );
      expect(offline).toHaveLength(1);
      expect((await noticesOf(gm, 'kiosk_offline')).some((row) => row.subjectId === kiosk.id)).toBe(
        true,
      );
      await db
        .update(attendanceKiosks)
        .set({ lastSeenAt: now })
        .where(eq(attendanceKiosks.id, kiosk.id));
      await reminders.run(now);
      const [closed] = (await noticesOf(ops, 'kiosk_offline')).filter(
        (row) => row.subjectId === kiosk.id,
      );
      expect(closed?.resolvedAt).not.toBeNull();
    });
  });

  describe('the Today board', () => {
    it('shows everyone in scope where they stand, and nobody outside it', async () => {
      const board = todayBoardSchema.parse(
        await ok(await call('GET', '/api/hr/attendance/today', ops)),
      );
      expect(board.date).toBe(today);
      const rowOf = (person: Person) => board.rows.find((row) => row.user.id === person.id);
      expect(rowOf(colleague)).toMatchObject({
        state: 'in',
        noPasskey: true,
        method: 'correction',
      });
      expect(rowOf(employee)).toMatchObject({ noPasskey: false });
      expect(rowOf(employee)?.day?.place).toBe('remote');
      const scoped = todayBoardSchema.parse(
        await ok(await call('GET', '/api/hr/attendance/today', designManager)),
      );
      expect(scoped.rows.some((row) => row.user.id === employee.id)).toBe(false);
    });
  });
});
