import type { INestApplication } from '@nestjs/common';
import {
  addMonths,
  attendanceItemSchema,
  attendanceMonthSchema,
  businessDate,
  businessInstant,
  holidaySchema,
  hrRequestSchema,
  monthSheetSchema,
  WEEKDAYS,
  workScheduleSchema,
} from '@vertex-hub/contracts';
import {
  attendanceDays,
  attendanceItems,
  attendanceMonthSummaries,
  attendanceMonths,
  attendancePunches,
  auditEntries,
  createDatabase,
  hrRequests,
  hrSettings,
  notifications,
  publicHolidays,
  workScheduleDays,
  workSchedules,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq, gte, inArray, like, lte } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AttendanceDays } from '../src/modules/hr/attendance-days.js';
import { api, removeUsers, seedUser } from './helpers.js';
import { startApp } from './start-app.js';

type Person = { id: string; cookie: string; name: string };

describe('HR attendance months: sheet, closing, reopening, Excel (F17 part D)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  const seeded: string[] = [];
  const schedules: string[] = [];
  const marker = `HRM${Date.now()}`;
  const today = businessDate();
  // A month long ended, so it may be closed (rule D2).
  const month = addMonths(today, -3).slice(0, 7);
  const date = (day: number) => `${month}-${String(day).padStart(2, '0')}`;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let gm: Person;
  let ops: Person;
  let finance: Person;
  let manager: Person;
  let designManager: Person;
  let employee: Person;
  let colleague: Person;
  let startsOnBefore: string | null = null;
  let holidayId = '';

  const call = (method: string, path: string, person: Person | undefined, body?: unknown) =>
    client.request(method, path, { cookie: person?.cookie, body });

  const ok = async (response: Response, status = 200) => {
    expect(response.status, await response.clone().text()).toBe(status);
    return response.json();
  };

  const refused = async (response: Response, status: number, code: string) => {
    const body = (await response.json()) as { code?: string; details?: unknown };
    expect(response.status, JSON.stringify(body)).toBe(status);
    expect(body.code).toBe(code);
    return body;
  };

  /** A correction the GM records for someone: approved at once, its punch written (rule C19). */
  const correct = (person: Person, day: string, direction: 'in' | 'out', time: string) =>
    call('POST', '/api/hr/requests', gm, {
      kind: 'correction',
      userId: person.id,
      date: day,
      direction,
      time,
      reason: 'تسجيل متأخر',
    });

  const sheet = async (person: Person, query = '') =>
    monthSheetSchema.parse(await ok(await call('GET', `/api/hr/months/${month}${query}`, person)));

  const lateItem = async () => {
    const [row] = await db
      .select({ item: attendanceItems })
      .from(attendanceItems)
      .innerJoin(attendanceDays, eq(attendanceDays.id, attendanceItems.dayId))
      .where(
        and(
          eq(attendanceItems.userId, employee.id),
          eq(attendanceDays.date, date(5)),
          eq(attendanceItems.kind, 'lateness'),
        ),
      );
    return row?.item;
  };

  /** Waives the items of the month still pending (overtime: rejects it), so it can close. */
  const waiveTheRest = async () => {
    const rows = await db
      .select({ id: attendanceItems.id, kind: attendanceItems.kind })
      .from(attendanceItems)
      .innerJoin(attendanceDays, eq(attendanceDays.id, attendanceItems.dayId))
      .where(
        and(
          inArray(attendanceItems.userId, [employee.id, colleague.id]),
          eq(attendanceItems.status, 'pending'),
          gte(attendanceDays.date, date(1)),
          lte(attendanceDays.date, date(28)),
        ),
      );
    for (const row of rows) {
      const decision = row.kind === 'overtime' ? 'rejected' : 'waived';
      await ok(await call('POST', `/api/hr/items/${row.id}/decision`, gm, { decision }));
    }
  };

  const summaryOf = async (person: Person) => {
    const [row] = await db
      .select({ summary: attendanceMonthSummaries })
      .from(attendanceMonthSummaries)
      .innerJoin(attendanceMonths, eq(attendanceMonths.id, attendanceMonthSummaries.monthId))
      .where(
        and(eq(attendanceMonths.month, month), eq(attendanceMonthSummaries.userId, person.id)),
      );
    return row?.summary;
  };

  const workbook = async (response: Response) => {
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get('content-type')).toContain('spreadsheetml');
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    const sheet = book.worksheets[0];
    const rows: unknown[][] = [];
    sheet?.eachRow((row) => {
      rows.push((row.values as unknown[]).slice(1));
    });
    return rows;
  };

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
    finance = await secured({ roles: ['finance'], name: `${marker} مالية` });
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
          startDate: date(1),
          scheduleId: schedule.id,
        }),
      );
    }
    // Rule C1: out of trial for the month; the API takes only today or later, so the row.
    const [settings] = await db.select().from(hrSettings);
    startsOnBefore = settings?.attendanceStartsOn ?? null;
    await db.update(hrSettings).set({ attendanceStartsOn: date(1) });

    // The employee late on the 5th (45 minutes); the colleague on time on the 6th, and on unpaid
    // leave on the 10th.
    await ok(await correct(employee, date(5), 'in', '09:45'), 201);
    await ok(await correct(employee, date(5), 'out', '17:00'), 201);
    await ok(await correct(colleague, date(6), 'in', '09:00'), 201);
    // 20 minutes over: no overtime at the default minimum of 30 (a later test lowers it).
    await ok(await correct(colleague, date(6), 'out', '17:20'), 201);
    await ok(
      await call('POST', '/api/hr/requests', gm, {
        kind: 'leave',
        userId: colleague.id,
        leaveType: 'unpaid',
        startsOn: date(10),
        endsOn: date(10),
        reason: 'ظرف عائلي',
      }),
      201,
    );
    // A holiday later in the month, changed once the month is closed (edge case 12).
    holidayId = holidaySchema.parse(
      await ok(
        await call('POST', '/api/hr/holidays', ops, {
          name: `${marker} عطلة`,
          startsOn: date(15),
          endsOn: date(15),
        }),
        201,
      ),
    ).id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db.update(hrSettings).set({ attendanceStartsOn: startsOnBefore });
    const monthRows = await db
      .select({ id: attendanceMonths.id })
      .from(attendanceMonths)
      .where(eq(attendanceMonths.month, month));
    const monthIds = monthRows.map((row) => row.id);
    if (monthIds.length > 0) {
      await db.delete(auditEntries).where(inArray(auditEntries.entityId, monthIds));
      await db.delete(notifications).where(inArray(notifications.subjectId, monthIds));
      await db
        .delete(attendanceMonthSummaries)
        .where(inArray(attendanceMonthSummaries.monthId, monthIds));
      await db.delete(attendanceMonths).where(inArray(attendanceMonths.id, monthIds));
    }
    if (holidayId) await db.delete(notifications).where(eq(notifications.subjectId, holidayId));
    await db.delete(publicHolidays).where(like(publicHolidays.name, `${marker}%`));
    if (seeded.length > 0) {
      await db.delete(auditEntries).where(inArray(auditEntries.entityId, seeded));
      await db.delete(notifications).where(inArray(notifications.subjectId, seeded));
    }
    await removeUsers(db, seeded);
    if (schedules.length > 0) {
      await db.delete(workScheduleDays).where(inArray(workScheduleDays.scheduleId, schedules));
      await db.delete(workSchedules).where(inArray(workSchedules.id, schedules));
    }
    await connection.close();
  });

  it('answers 401 without a session and 403 without the permission', async () => {
    expect((await call('GET', `/api/hr/months/${month}`, undefined)).status).toBe(401);
    expect((await call('GET', `/api/hr/months/${month}`, employee)).status).toBe(403);
    expect((await call('GET', `/api/hr/months/${month}/export`, employee)).status).toBe(403);
    expect((await call('POST', `/api/hr/months/${month}/close`, ops)).status).toBe(403);
    expect(
      (await call('POST', `/api/hr/months/${month}/reopen`, ops, { reason: 'x' })).status,
    ).toBe(403);
    expect((await call('POST', `/api/hr/months/${month}/close`, undefined)).status).toBe(401);
    expect(
      (await call('POST', `/api/hr/months/${month}/reopen`, undefined, { reason: 'x' })).status,
    ).toBe(401);
    expect((await call('GET', `/api/hr/months/${month}/export`, undefined)).status).toBe(401);
    expect(
      (await call('GET', `/api/hr/employees/${employee.id}/months/${month}/export`, undefined))
        .status,
    ).toBe(401);
    expect((await call('GET', '/api/hr/months/2026-13', gm)).status).toBe(400);
  });

  describe('the month sheet (rule D1)', () => {
    it('shows the days and live totals of the employees in scope, with pending counts', async () => {
      const read = await sheet(gm);
      expect(read.month).toMatchObject({ month, status: 'open', closedBy: null });
      expect(read.from).toBe(date(1));
      const mine = read.rows.find((row) => row.user.id === employee.id);
      expect(mine?.days.find((day) => day.date === date(5))).toMatchObject({
        status: 'partial',
        lateMinutes: 45,
        pendingItems: 1,
      });
      // The correction also made the day before it, an absence (rule C14).
      expect(mine?.pendingItems).toBeGreaterThanOrEqual(1);
      expect(mine?.pendingRequests).toBe(0);
      expect(mine?.totals).toMatchObject({ presentDays: 1, workedMinutes: 435 });
      const theirs = read.rows.find((row) => row.user.id === colleague.id);
      expect(theirs?.totals.leaveDays.unpaid).toBe(1);
      expect(theirs?.totals.unpaidLeaveDays).toBe(1);
    });

    it('lets Finance (`salaries.read`) read and export every employee (rule D3)', async () => {
      const read = await sheet(finance);
      expect(read.rows.map((row) => row.user.id)).toEqual(
        expect.arrayContaining([employee.id, colleague.id]),
      );
      await workbook(await call('GET', `/api/hr/months/${month}/export`, finance));
    });

    it('limits a department manager to their members (edge case 21)', async () => {
      const photography = await sheet(manager);
      expect(photography.rows.map((row) => row.user.id)).toEqual(
        expect.arrayContaining([employee.id, colleague.id]),
      );
      const design = await sheet(designManager);
      expect(design.rows.some((row) => row.user.id === employee.id)).toBe(false);
    });
  });

  describe('closing (rules D2, D3)', () => {
    it('refuses a month that has not ended', async () => {
      await refused(
        await call('POST', `/api/hr/months/${today.slice(0, 7)}/close`, gm),
        409,
        'MONTH_NOT_ENDED',
      );
    });

    it('refuses a month with an item still to decide, and lists it', async () => {
      const item = await lateItem();
      const body = await refused(
        await call('POST', `/api/hr/months/${month}/close`, gm),
        409,
        'MONTH_HAS_PENDING',
      );
      const { pending } = body.details as { pending: { kind: string; id: string }[] };
      expect(pending).toContainEqual(
        expect.objectContaining({ kind: 'item', id: item?.id, date: date(5) }),
      );
    });

    it('keeps the items its recompute raises, so they can be decided', async () => {
      // A lower overtime minimum after the days were computed: the colleague's 20 minutes count.
      const [settings] = await db.select().from(hrSettings);
      await db.update(hrSettings).set({ overtimeMinMinutes: 15 });
      try {
        const body = await refused(
          await call('POST', `/api/hr/months/${month}/close`, gm),
          409,
          'MONTH_HAS_PENDING',
        );
        const { pending } = body.details as { pending: { id: string; user: { id: string } }[] };
        const [overtime] = await db
          .select({ item: attendanceItems })
          .from(attendanceItems)
          .innerJoin(attendanceDays, eq(attendanceDays.id, attendanceItems.dayId))
          .where(
            and(
              eq(attendanceItems.userId, colleague.id),
              eq(attendanceDays.date, date(6)),
              eq(attendanceItems.kind, 'overtime'),
            ),
          );
        expect(overtime?.item).toMatchObject({ status: 'pending', minutes: 20 });
        expect(pending.map((row) => row.id)).toContain(overtime?.item.id);
      } finally {
        await db.update(hrSettings).set({ overtimeMinMinutes: settings?.overtimeMinMinutes ?? 30 });
      }
    });

    it('closes once decided: summaries frozen, Finance told, the audit written', async () => {
      const item = await lateItem();
      attendanceItemSchema.parse(
        await ok(
          await call('POST', `/api/hr/items/${item?.id}/decision`, gm, {
            decision: 'deducted',
            fraction: 0.25,
          }),
        ),
      );
      await waiveTheRest();
      const closed = attendanceMonthSchema.parse(
        await ok(await call('POST', `/api/hr/months/${month}/close`, gm)),
      );
      expect(closed).toMatchObject({ month, status: 'closed', closedBy: { id: gm.id } });
      expect(await summaryOf(employee)).toMatchObject({
        presentDays: 1,
        lateCount: 1,
        deductedDays: 0.25,
        workedMinutes: 435,
      });
      expect(await summaryOf(colleague)).toMatchObject({
        presentDays: 1,
        unpaidLeaveDays: 1,
        leaveDays: expect.objectContaining({ unpaid: 1 }),
      });
      const notices = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.recipientId, finance.id),
            eq(notifications.type, 'attendance_month_closed'),
          ),
        );
      expect(notices).toHaveLength(1);
      const [audit] = await db
        .select()
        .from(auditEntries)
        .where(
          and(eq(auditEntries.action, 'attendance_month.closed'), eq(auditEntries.actorId, gm.id)),
        );
      expect(audit?.after).toMatchObject({ month, status: 'closed' });
      // Closing a closed month changes nothing.
      expect(
        attendanceMonthSchema.parse(
          await ok(await call('POST', `/api/hr/months/${month}/close`, gm)),
        ).closedAt,
      ).toBe(closed.closedAt);
    });

    it('shows the frozen summary on the sheet', async () => {
      const read = await sheet(gm);
      expect(read.month.status).toBe('closed');
      expect(read.rows.find((row) => row.user.id === employee.id)?.totals).toMatchObject({
        deductedDays: 0.25,
        lateCount: 1,
      });
    });

    it('rejects new records dated in the closed month (rule D2, edge cases 12 and 13)', async () => {
      await refused(await correct(employee, date(7), 'in', '09:00'), 409, 'MONTH_CLOSED');
      await refused(
        await call('POST', '/api/hr/requests', gm, {
          kind: 'leave',
          userId: employee.id,
          leaveType: 'unpaid',
          startsOn: date(28),
          endsOn: addMonths(date(28), 1),
          reason: 'ظرف عائلي',
        }),
        409,
        'MONTH_CLOSED',
      );
      const item = await lateItem();
      await refused(
        await call('POST', `/api/hr/items/${item?.id}/decision`, gm, { decision: 'waived' }),
        409,
        'MONTH_CLOSED',
      );
      await refused(
        await call('POST', '/api/hr/holidays', ops, {
          name: `${marker} عطلة`,
          startsOn: date(12),
          endsOn: date(12),
        }),
        409,
        'MONTH_CLOSED',
      );
      await refused(
        await call('PATCH', `/api/hr/holidays/${holidayId}`, ops, { name: `${marker} عيد` }),
        409,
        'MONTH_CLOSED',
      );
      await refused(
        await call('POST', `/api/hr/holidays/${holidayId}/archive`, ops),
        409,
        'MONTH_CLOSED',
      );
    });

    it('refuses decisions, cancellations and punch reviews dated in it (rule D2)', async () => {
      // Rows the API no longer lets in: a pending request and a field punch of the closed month.
      const [request] = await db
        .insert(hrRequests)
        .values({
          userId: employee.id,
          kind: 'leave',
          leaveType: 'unpaid',
          startsOn: date(20),
          endsOn: date(20),
          days: 1,
          paidDays: 0,
          unpaidDays: 1,
          createdById: employee.id,
        })
        .returning();
      const [punch] = await db
        .insert(attendancePunches)
        .values({
          userId: colleague.id,
          direction: 'in',
          at: businessInstant(date(6), '12:00'),
          method: 'field',
          fieldNote: 'زيارة عميل',
          fieldReview: 'accepted',
          latitude: 33.5,
          longitude: 36.3,
        })
        .returning();
      try {
        await refused(
          await call('POST', `/api/hr/requests/${request?.id}/decision`, gm, {
            decision: 'approve',
          }),
          409,
          'MONTH_CLOSED',
        );
        await refused(
          await call('POST', `/api/hr/requests/${request?.id}/cancel`, employee, {}),
          409,
          'MONTH_CLOSED',
        );
        await refused(
          await call('POST', `/api/hr/attendance/punches/${punch?.id}/reject`, gm, { note: 'x' }),
          409,
          'MONTH_CLOSED',
        );
      } finally {
        if (punch) await db.delete(attendancePunches).where(eq(attendancePunches.id, punch.id));
        if (request) await db.delete(hrRequests).where(eq(hrRequests.id, request.id));
      }
    });

    it('does not recompute the days of a closed month', async () => {
      const [fifth] = await db
        .select()
        .from(attendanceDays)
        .where(and(eq(attendanceDays.userId, employee.id), eq(attendanceDays.date, date(5))));
      await db
        .update(attendanceDays)
        .set({ lateMinutes: 99 })
        .where(eq(attendanceDays.id, fifth?.id ?? ''));
      try {
        const refreshed = await db.transaction((tx) =>
          app.get(AttendanceDays).refresh(tx, employee.id, [date(5)]),
        );
        expect(refreshed.size).toBe(0);
        const [after] = await db
          .select()
          .from(attendanceDays)
          .where(eq(attendanceDays.id, fifth?.id ?? ''));
        expect(after?.lateMinutes).toBe(99);
      } finally {
        await db
          .update(attendanceDays)
          .set({ lateMinutes: fifth?.lateMinutes ?? 0 })
          .where(eq(attendanceDays.id, fifth?.id ?? ''));
      }
    });
  });

  describe('reopening (rule D4)', () => {
    it('needs a reason, then reopens; a second reopening is refused', async () => {
      expect(
        (await call('POST', `/api/hr/months/${month}/reopen`, gm, { reason: ' ' })).status,
      ).toBe(400);
      const reopened = attendanceMonthSchema.parse(
        await ok(
          await call('POST', `/api/hr/months/${month}/reopen`, gm, { reason: 'تصحيح متأخر' }),
        ),
      );
      expect(reopened).toMatchObject({
        status: 'open',
        reopenedBy: { id: gm.id },
        reopenReason: 'تصحيح متأخر',
      });
      // The summaries stay until the next closing.
      expect(await summaryOf(employee)).toBeDefined();
      await refused(
        await call('POST', `/api/hr/months/${month}/reopen`, gm, { reason: 'x' }),
        409,
        'NOT_CLOSED',
      );
    });

    it('takes records again, and the next closing rewrites the summaries', async () => {
      hrRequestSchema.parse(await ok(await correct(colleague, date(7), 'in', '09:00'), 201));
      hrRequestSchema.parse(await ok(await correct(colleague, date(7), 'out', '17:00'), 201));
      await waiveTheRest();
      await ok(await call('POST', `/api/hr/months/${month}/close`, gm));
      expect(await summaryOf(colleague)).toMatchObject({ presentDays: 2 });
    });
  });

  describe('Excel (rule D5)', () => {
    it('exports the month sheet, one row per employee', async () => {
      const rows = await workbook(await call('GET', `/api/hr/months/${month}/export`, gm));
      expect(rows[0]?.[0]).toBe('الموظف');
      const mine = rows.find((row) => row[0] === employee.name);
      expect(mine?.[13]).toBe(0.25);
    });

    it("exports an employee's month to themselves and to hr.read in scope only", async () => {
      const path = `/api/hr/employees/${employee.id}/months/${month}/export`;
      const rows = await workbook(await call('GET', path, employee));
      const fifth = rows.find(
        (row) => row[0] instanceof Date && row[0].toISOString().startsWith(date(5)),
      );
      expect(String(fifth?.[12])).toContain('تأخير');
      await workbook(await call('GET', path, manager));
      expect((await call('GET', path, colleague)).status).toBe(404);
      expect((await call('GET', path, designManager)).status).toBe(404);
    });
  });
});
