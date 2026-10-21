import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  businessDate,
  type CreateHrRequestInput,
  calendarSchema,
  conflictListSchema,
  hrOpinionSchema,
  hrRequestDetailSchema,
  hrRequestPageSchema,
  hrRequestPreviewSchema,
  hrRequestSchema,
  leaveBalanceSchema,
  taskDetailSchema,
  weekOf,
} from '@vertex-hub/contracts';
import {
  auditEntries,
  createDatabase,
  employeeFiles,
  leaveLedger,
  notifications,
  publicHolidays,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LeaveJobs } from '../src/modules/hr/leave-jobs.js';
import { expectError } from './client-cast.js';
import { api, removeTasks, removeUsers, seedUser } from './helpers.js';
import { startApp } from './start-app.js';

type Person = { id: string; cookie: string; name: string };

/** Leaves far in the future, so other test files never meet them. */
const YEAR = 2991;

/** A Saturday: with the main schedule (Saturday to Thursday), `day(6)` is a Friday off. */
const BASE = weekOf(`${YEAR}-03-10`).from;

const day = (n: number) => addDays(BASE, n);

describe('HR leave: balances, requests and decisions (F17 part B)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  const seeded: string[] = [];
  const requests: string[] = [];
  const holidays: string[] = [];
  const tasks: string[] = [];
  const marker = `HRL${Date.now()}`;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let gm: Person;
  let ops: Person;
  let finance: Person;
  let manager: Person;
  let designManager: Person;
  let employee: Person;
  let colleague: Person;

  const request = async (person: Person, body: CreateHrRequestInput, status = 201) => {
    const response = await client.post('/api/hr/requests', person.cookie, body);
    expect(response.status, await response.clone().text()).toBe(status);
    const created = hrRequestSchema.parse(await response.json());
    requests.push(created.id);
    return created;
  };

  const tryRequest = (person: Person, body: CreateHrRequestInput) =>
    client.post('/api/hr/requests', person.cookie, body);

  const annual = (
    startsOn: string,
    endsOn = startsOn,
  ): Extract<CreateHrRequestInput, { kind: 'leave' }> => ({
    kind: 'leave',
    leaveType: 'annual',
    startsOn,
    endsOn,
  });

  const decide = (person: Person, id: string, body: unknown) =>
    client.post(`/api/hr/requests/${id}/decision`, person.cookie, body);

  const balance = async (person: Person, userId = employee.id, year = YEAR) => {
    const response = await client.get(`/api/hr/balances/${userId}?year=${year}`, person.cookie);
    expect(response.status, await response.clone().text()).toBe(200);
    return leaveBalanceSchema.parse(await response.json());
  };

  const typeBalance = async (leaveType: 'annual' | 'sick' | 'emergency') =>
    (await balance(employee)).balances.find((row) => row.leaveType === leaveType);

  const detail = async (person: Person, id: string) => {
    const response = await client.get(`/api/hr/requests/${id}`, person.cookie);
    expect(response.status, await response.clone().text()).toBe(200);
    return hrRequestDetailSchema.parse(await response.json());
  };

  const noticesOf = (type: string, subjectId: string) =>
    db
      .select()
      .from(notifications)
      .where(and(eq(notifications.type, type as never), eq(notifications.subjectId, subjectId)));

  const createTask = (dueDate: string, body: Record<string, unknown> = {}) =>
    client.post('/api/tasks', gm.cookie, {
      title: `${marker} مهمة`,
      department: 'photography',
      assigneeId: employee.id,
      dueDate,
      ...body,
    });

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
    employee = await plain({ departments: [{ code: 'photography' }], name: `${marker} سامر` });
    colleague = await plain({ departments: [{ code: 'photography' }], name: `${marker} رنا` });
    // Seeded users get their employee file when HR first reads them (rule A1).
    for (const person of [employee, colleague]) {
      expect((await client.get(`/api/hr/employees/${person.id}`, ops.cookie)).status).toBe(200);
    }
  });

  afterAll(async () => {
    await app?.close();
    await removeTasks(db, tasks);
    if (holidays.length > 0) {
      await db.delete(notifications).where(inArray(notifications.subjectId, holidays));
      await db.delete(publicHolidays).where(inArray(publicHolidays.id, holidays));
    }
    const ids = [...seeded, ...requests, ...holidays, ...tasks];
    if (ids.length > 0) {
      await db.delete(notifications).where(inArray(notifications.subjectId, ids));
      await db.delete(auditEntries).where(inArray(auditEntries.entityId, ids));
    }
    await removeUsers(db, seeded);
    await connection.close();
  });

  it('answers 401 without a session and 403 without the permission', async () => {
    const id = '01900000-0000-7000-8000-000000000000';
    expect((await client.get('/api/hr/requests')).status).toBe(401);
    expect((await client.post('/api/hr/requests', undefined, annual(day(0)))).status).toBe(401);
    expect((await client.post('/api/hr/requests/preview', undefined, annual(day(0)))).status).toBe(
      401,
    );
    expect((await client.get(`/api/hr/requests/${id}`)).status).toBe(401);
    expect((await client.get(`/api/hr/balances/${id}?year=${YEAR}`)).status).toBe(401);
    expect((await client.post(`/api/hr/requests/${id}/cancel`)).status).toBe(401);
    expect(
      (await decide(colleague, id, { decision: 'approve' })).status,
      'decision needs hr.approve',
    ).toBe(403);
    expect(
      (
        await client.post(`/api/hr/balances/${employee.id}/adjustments`, ops.cookie, {
          leaveType: 'annual',
          year: YEAR,
          days: 1,
          note: 'x',
          entry: 'adjustment',
        })
      ).status,
    ).toBe(403);
    expect(
      (await client.post('/api/hr/opinions', colleague.cookie, { requestId: id, body: 'x' }))
        .status,
    ).toBe(403);
  });

  describe('balances (rules B6 and B7)', () => {
    it('records opening balances and adjustments, and tells the employee of an adjustment', async () => {
      const adjust = (body: unknown) =>
        client.post(`/api/hr/balances/${employee.id}/adjustments`, gm.cookie, body);
      const opening = await adjust({
        leaveType: 'annual',
        year: YEAR,
        days: 10,
        note: 'رصيد افتتاحي',
        entry: 'opening',
      });
      expect(opening.status, await opening.clone().text()).toBe(201);
      const after = leaveBalanceSchema.parse(await opening.json());
      expect(after.balances[0]).toMatchObject({ leaveType: 'annual', balance: 10, opening: 10 });
      for (const leaveType of ['sick', 'emergency']) {
        expect(
          (await adjust({ leaveType, year: YEAR, days: 3, note: 'منحة', entry: 'adjustment' }))
            .status,
        ).toBe(201);
      }
      const notices = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.type, 'leave_balance_adjusted'),
            eq(notifications.recipientId, employee.id),
          ),
        );
      expect(notices).toHaveLength(2);
      const [audit] = await db
        .select()
        .from(auditEntries)
        .where(
          and(
            eq(auditEntries.entityId, employee.id),
            eq(auditEntries.action, 'leave_balance.opening'),
          ),
        );
      expect(audit?.after).toMatchObject({ leaveType: 'annual', days: 10 });
    });

    it('shows balances to the employee and to hr.read in scope, 404 to anyone else', async () => {
      expect((await balance(employee)).balances.map((row) => row.balance)).toEqual([10, 3, 3]);
      expect((await balance(manager)).userId).toBe(employee.id);
      expect((await balance(ops)).userId).toBe(employee.id);
      for (const person of [designManager, finance, colleague]) {
        const response = await client.get(
          `/api/hr/balances/${employee.id}?year=${YEAR}`,
          person.cookie,
        );
        expect(response.status).toBe(404);
      }
    });
  });

  describe('requests (rules B8–B13)', () => {
    let pending: string;

    it('refuses days with no work, late requests and annual leave on probation', async () => {
      await expectError(await tryRequest(employee, annual(day(6))), 400, 'NOT_A_WORK_DAY');
      const yesterday = addDays(businessDate(), -1);
      await expectError(
        await tryRequest(employee, annual(yesterday, addDays(yesterday, 7))),
        409,
        'TOO_LATE',
      );
      await db
        .update(employeeFiles)
        .set({ probationEndDate: `${YEAR}-12-31` })
        .where(eq(employeeFiles.userId, employee.id));
      await expectError(await tryRequest(employee, annual(day(0))), 409, 'ON_PROBATION');
      await db
        .update(employeeFiles)
        .set({ probationEndDate: null })
        .where(eq(employeeFiles.userId, employee.id));
    });

    it('previews the work days of a leave, then submits it to the GMs', async () => {
      const preview = await client.post(
        '/api/hr/requests/preview',
        employee.cookie,
        annual(day(0), day(6)),
      );
      expect(preview.status, await preview.clone().text()).toBe(200);
      expect(hrRequestPreviewSchema.parse(await preview.json())).toEqual({
        days: 6,
        paidDays: 6,
        unpaidDays: 0,
        shortNotice: false,
        warnings: [],
      });
      await expectError(
        await tryRequest(employee, annual(day(0), day(13))),
        409,
        'INSUFFICIENT_BALANCE',
      );
      const created = await request(employee, annual(day(0), day(6)));
      expect(created).toMatchObject({ status: 'pending', days: 6, user: { id: employee.id } });
      pending = created.id;
      const [notice] = await noticesOf('hr_request_submitted', pending);
      expect(notice?.recipientId).toBe(gm.id);
    });

    it('counts pending days against the balance and refuses overlaps', async () => {
      expect(await typeBalance('annual')).toMatchObject({ balance: 10, pending: 6, available: 4 });
      await expectError(
        await tryRequest(employee, annual(day(7), day(12))),
        409,
        'INSUFFICIENT_BALANCE',
      );
      await expectError(await tryRequest(employee, annual(day(5))), 409, 'REQUEST_OVERLAP');
      await expectError(
        await tryRequest(employee, {
          kind: 'permission',
          date: day(3),
          fromTime: '09:00',
          toTime: '10:00',
          reason: 'موعد',
        }),
        409,
        'REQUEST_OVERLAP',
      );
    });

    it('takes the two halves of one day, and permissions within their limits', async () => {
      await request(employee, { ...annual(day(7)), half: 'first_half' });
      await request(employee, { ...annual(day(7)), half: 'second_half' });
      await expectError(
        await tryRequest(employee, { ...annual(day(7)), half: 'first_half' }),
        409,
        'REQUEST_OVERLAP',
      );
      const permission = (date: string, toTime = '10:00') =>
        ({ kind: 'permission', date, fromTime: '09:00', toTime, reason: 'موعد' }) as const;
      await expectError(
        await tryRequest(employee, permission(day(8), '12:00')),
        409,
        'PERMISSION_LIMIT',
      );
      for (const n of [8, 9, 10, 11]) await request(employee, permission(day(n)));
      await expectError(await tryRequest(employee, permission(day(12))), 409, 'PERMISSION_LIMIT');
    });

    it('shows a request to its owner and to hr.read in scope, with the work to GMs', async () => {
      const task = await createTask(day(2));
      expect(task.status, await task.clone().text()).toBe(201);
      tasks.push(taskDetailSchema.parse(await task.json()).id);
      const forGm = await detail(gm, pending);
      expect(forGm.overlappingWork?.map((work) => work.kind)).toEqual(['task']);
      expect(forGm.permissions).toMatchObject({ canDecide: true, canGiveOpinion: true });
      const forManager = await detail(manager, pending);
      expect(forManager.overlappingWork).toBeNull();
      expect(forManager.permissions).toMatchObject({ canDecide: false, canGiveOpinion: true });
      expect((await detail(employee, pending)).permissions.canCancel).toBe(true);
      for (const person of [designManager, colleague, finance]) {
        expect((await client.get(`/api/hr/requests/${pending}`, person.cookie)).status).toBe(404);
      }
    });

    it('takes opinions from hr.read in scope', async () => {
      const opinion = await client.post('/api/hr/opinions', manager.cookie, {
        requestId: pending,
        body: 'لا مانع لدي',
      });
      expect(opinion.status, await opinion.clone().text()).toBe(201);
      expect(hrOpinionSchema.parse(await opinion.json()).author.id).toBe(manager.id);
      expect(
        (
          await client.post('/api/hr/opinions', designManager.cookie, {
            requestId: pending,
            body: 'x',
          })
        ).status,
      ).toBe(404);
      expect((await detail(gm, pending)).opinions.map((row) => row.body)).toEqual(['لا مانع لدي']);
    });

    it("lists one's own requests, and those hr.read covers", async () => {
      const list = async (person: Person, query = '') => {
        const response = await client.get(`/api/hr/requests?pageSize=100${query}`, person.cookie);
        expect(response.status).toBe(200);
        return hrRequestPageSchema.parse(await response.json()).items.map((item) => item.id);
      };
      expect(await list(employee)).toContain(pending);
      expect(await list(colleague)).not.toContain(pending);
      expect(await list(manager, '&status=pending&order=asc')).toContain(pending);
      expect(await list(designManager)).not.toContain(pending);
      expect(await list(designManager, `&userId=${employee.id}`)).toEqual([]);
    });

    describe('decisions (rules B14–B17)', () => {
      it('needs a note to reject, then approves and takes the days', async () => {
        expect((await decide(gm, pending, { decision: 'reject' })).status).toBe(400);
        const approved = await decide(gm, pending, { decision: 'approve' });
        expect(approved.status, await approved.clone().text()).toBe(200);
        expect(hrRequestSchema.parse(await approved.json())).toMatchObject({
          status: 'approved',
          decidedBy: { id: gm.id },
        });
        await expectError(await decide(gm, pending, { decision: 'approve' }), 409, 'NOT_PENDING');
        expect(await typeBalance('annual')).toMatchObject({ balance: 4, taken: 6 });
        const [decided] = await noticesOf('hr_request_decided', pending);
        expect(decided?.recipientId).toBe(employee.id);
        const [submitted] = await noticesOf('hr_request_submitted', pending);
        expect(submitted?.resolvedAt).not.toBeNull();
      });

      it('shows the leave on the calendar, with its type only for hr.read in scope', async () => {
        const leaveOf = async (person: Person) => {
          const response = await client.get(
            `/api/calendar?from=${day(0)}&to=${day(6)}`,
            person.cookie,
          );
          expect(response.status).toBe(200);
          return calendarSchema
            .parse(await response.json())
            .leaves.find((leave) => leave.requestId === pending);
        };
        expect(await leaveOf(colleague)).toMatchObject({
          user: { id: employee.id },
          leaveType: null,
        });
        expect((await leaveOf(manager))?.leaveType).toBe('annual');
        expect((await leaveOf(designManager))?.leaveType).toBeNull();
      });

      it('warns when a task is assigned or re-dated onto the leave, until accepted', async () => {
        await expectError(await createTask(day(1)), 409, 'ASSIGNEE_ON_LEAVE');
        const taskId = tasks[0] as string;
        const redate = (body: unknown) =>
          client.request('PATCH', `/api/tasks/${taskId}`, { cookie: gm.cookie, body });
        const refused = await expectError(
          await redate({ dueDate: day(3) }),
          409,
          'ASSIGNEE_ON_LEAVE',
        );
        expect(refused.details).toEqual([{ startsOn: day(0), endsOn: day(6) }]);
        expect((await redate({ dueDate: day(3), acceptLeave: true })).status).toBe(200);
        const [audit] = await db
          .select()
          .from(auditEntries)
          .where(
            and(eq(auditEntries.entityId, taskId), eq(auditEntries.action, 'task.leave_accepted')),
          );
        expect(audit?.after).toMatchObject({ assigneeId: employee.id, dueDate: day(3) });
      });

      it('reports the leave as a conflict on shoots and meetings', async () => {
        const params = new URLSearchParams({
          userIds: employee.id,
          startsAt: `${day(2)}T10:00:00+03:00`,
          endsAt: `${day(2)}T12:00:00+03:00`,
        });
        const response = await client.get(`/api/calendar/conflicts?${params}`, gm.cookie);
        expect(response.status, await response.clone().text()).toBe(200);
        expect(conflictListSchema.parse(await response.json()).items).toEqual([
          expect.objectContaining({ kind: 'leave', id: pending, title: '' }),
        ]);
      });

      it('recounts an approved leave when a holiday is added or archived (edge case 11)', async () => {
        const created = await client.post('/api/hr/holidays', ops.cookie, {
          name: `${marker} عطلة`,
          startsOn: day(4),
          endsOn: day(4),
        });
        expect(created.status, await created.clone().text()).toBe(201);
        const holidayId = ((await created.json()) as { id: string }).id;
        holidays.push(holidayId);
        expect((await detail(employee, pending)).days).toBe(5);
        expect(await typeBalance('annual')).toMatchObject({ balance: 5, taken: 5 });
        expect(
          (await client.post(`/api/hr/holidays/${holidayId}/archive`, ops.cookie)).status,
        ).toBe(200);
        expect((await detail(employee, pending)).days).toBe(6);
        expect(await typeBalance('annual')).toMatchObject({ balance: 4, taken: 6 });
      });

      it('lets the employee cancel before the first day, and restores the days', async () => {
        expect(
          (await client.post(`/api/hr/requests/${pending}/cancel`, colleague.cookie)).status,
        ).toBe(404);
        const cancelled = await client.post(`/api/hr/requests/${pending}/cancel`, employee.cookie, {
          note: 'تغيّرت الخطة',
        });
        expect(cancelled.status, await cancelled.clone().text()).toBe(200);
        expect(hrRequestSchema.parse(await cancelled.json()).status).toBe('cancelled');
        expect(await typeBalance('annual')).toMatchObject({ balance: 10, taken: 0 });
        await expectError(
          await client.post(`/api/hr/requests/${pending}/cancel`, employee.cookie),
          409,
          'NOT_CANCELLABLE',
        );
        const task = await createTask(day(1));
        expect(task.status).toBe(201);
        tasks.push(taskDetailSchema.parse(await task.json()).id);
      });
    });
  });

  describe('sick and emergency leave (rules B12 and B13)', () => {
    it('pays sick days up to the balance and asks for the certificate', async () => {
      const sick: CreateHrRequestInput = {
        kind: 'leave',
        leaveType: 'sick',
        startsOn: day(14),
        endsOn: day(19),
        reason: 'عملية جراحية',
      };
      const preview = await client.post('/api/hr/requests/preview', employee.cookie, sick);
      expect(hrRequestPreviewSchema.parse(await preview.json())).toEqual({
        days: 6,
        paidDays: 3,
        unpaidDays: 3,
        shortNotice: false,
        warnings: ['unpaid_days', 'certificate_required'],
      });
      const created = await request(employee, sick);
      expect(created).toMatchObject({ certificateRequired: true, documents: 0 });
      const files = await client.get(
        `/api/files/items?ownerType=hr_request&ownerId=${created.id}`,
        employee.cookie,
      );
      expect(files.status, await files.clone().text()).toBe(200);
      expect(
        (
          await client.get(
            `/api/files/items?ownerType=hr_request&ownerId=${created.id}`,
            colleague.cookie,
          )
        ).status,
      ).toBe(404);
      await expectError(
        await decide(gm, created.id, { decision: 'approve' }),
        409,
        'CERTIFICATE_MISSING',
      );
      const approved = await decide(gm, created.id, {
        decision: 'approve',
        confirmMissingCertificate: true,
      });
      expect(approved.status).toBe(200);
      expect(await typeBalance('sick')).toMatchObject({ balance: 0, taken: 3 });
    });

    it('draws emergency days on both the cap and the annual balance', async () => {
      const created = await request(employee, {
        kind: 'leave',
        leaveType: 'emergency',
        startsOn: day(21),
        endsOn: day(22),
        reason: 'ظرف عائلي',
      });
      expect(created).toMatchObject({ days: 2, paidDays: 2, unpaidDays: 0 });
      expect((await decide(gm, created.id, { decision: 'approve' })).status).toBe(200);
      expect(await typeBalance('emergency')).toMatchObject({ balance: 1, taken: 2 });
      // The half days of day 7 are still pending.
      expect(await typeBalance('annual')).toMatchObject({ balance: 8, pending: 1, available: 7 });
    });
  });

  describe('records by hr.approve and archived accounts', () => {
    it('approves at once what an approver records, for someone else or for themselves', async () => {
      expect(
        (await tryRequest(colleague, { ...annual(day(28)), userId: employee.id })).status,
      ).toBe(404);
      const recorded = await request(gm, {
        kind: 'leave',
        leaveType: 'unpaid',
        startsOn: day(28),
        endsOn: day(28),
        reason: 'سُجّلت بعد الغياب',
        userId: employee.id,
      });
      expect(recorded).toMatchObject({
        status: 'approved',
        user: { id: employee.id },
        createdBy: { id: gm.id },
        unpaidDays: 1,
      });
      expect(await noticesOf('hr_request_submitted', recorded.id)).toEqual([]);
      const [decided] = await noticesOf('hr_request_decided', recorded.id);
      expect(decided?.recipientId).toBe(employee.id);
      // After the fact: no deadline, and never short notice (settled note on rule B9).
      const thisYear = Number(businessDate().slice(0, 4));
      const yesterday = addDays(businessDate(), -1);
      expect(
        (
          await client.post(`/api/hr/balances/${employee.id}/adjustments`, gm.cookie, {
            leaveType: 'annual',
            year: thisYear,
            days: 10,
            note: 'رصيد افتتاحي',
            entry: 'opening',
          })
        ).status,
      ).toBe(201);
      const late = await request(gm, {
        ...annual(yesterday, addDays(yesterday, 3)),
        userId: employee.id,
      });
      expect(late).toMatchObject({ status: 'approved', shortNotice: false });
      const own = await request(gm, {
        kind: 'leave',
        leaveType: 'unpaid',
        startsOn: day(29),
        endsOn: day(29),
        reason: 'شأن خاص',
      });
      expect(own.status).toBe('approved');
    });

    it("cancels an archived account's pending requests (rule A8)", async () => {
      const leaver = await seedUser(db, {
        departments: [{ code: 'photography' }],
        name: `${marker} مغادر`,
      });
      seeded.push(leaver.id);
      const person = {
        id: leaver.id,
        name: leaver.name,
        cookie: await client.signIn(leaver.email),
      };
      const pendingLeave = await request(person, {
        kind: 'leave',
        leaveType: 'unpaid',
        startsOn: day(30),
        endsOn: day(30),
        reason: 'سفر',
      });
      const archived = await client.post(`/api/users/${leaver.id}/archive`, gm.cookie);
      expect(archived.status, await archived.clone().text()).toBe(200);
      expect((await detail(gm, pendingLeave.id)).status).toBe('cancelled');
    });
  });

  describe('the daily job (rules B4, B5 and B18)', () => {
    it('grants, accrues pro rata and rolls the year over, once', async () => {
      const newcomer = await seedUser(db, {
        departments: [{ code: 'photography' }],
        name: `${marker} جديد`,
      });
      seeded.push(newcomer.id);
      const jobs = app.get(LeaveJobs);
      await client.get(`/api/hr/employees/${newcomer.id}`, ops.cookie);
      await db
        .update(employeeFiles)
        .set({ startDate: `${YEAR}-01-16`, annualLeaveDays: 14 })
        .where(eq(employeeFiles.userId, newcomer.id));
      const rowsOf = () =>
        db
          .select({
            leaveType: leaveLedger.leaveType,
            year: leaveLedger.year,
            entry: leaveLedger.entry,
            days: leaveLedger.days,
            period: leaveLedger.period,
          })
          .from(leaveLedger)
          .where(eq(leaveLedger.userId, newcomer.id));
      await jobs.balances(`${YEAR}-02-01`);
      await jobs.balances(`${YEAR}-02-05`);
      expect(await rowsOf()).toEqual(
        expect.arrayContaining([
          { leaveType: 'sick', year: YEAR, entry: 'grant', days: 14, period: null },
          { leaveType: 'emergency', year: YEAR, entry: 'grant', days: 3, period: null },
          // 14 / 12 × 16 / 31 of January, rounded down to a half day.
          { leaveType: 'annual', year: YEAR, entry: 'accrual', days: 0.5, period: `${YEAR}-01` },
        ]),
      );
      expect(await rowsOf()).toHaveLength(3);
      // On 1 January: December's accrual catches the year up, then the rollover carries 5.
      await jobs.balances(`${YEAR + 1}-01-01`);
      const next = await rowsOf();
      expect(next).toEqual(
        expect.arrayContaining([
          { leaveType: 'annual', year: YEAR, entry: 'accrual', days: 12.5, period: `${YEAR}-12` },
          { leaveType: 'annual', year: YEAR + 1, entry: 'carry_over', days: 5, period: null },
          { leaveType: 'annual', year: YEAR, entry: 'expiry', days: -8, period: null },
        ]),
      );
      await jobs.balances(`${YEAR + 1}-01-02`);
      expect(await rowsOf()).toHaveLength(next.length);
    });

    it("tells the managers of a colleague's leave on the work day before, once", async () => {
      const jobs = app.get(LeaveJobs);
      // The emergency leave starts on day 21, a Saturday; day 20 is the Friday before it.
      expect(await jobs.colleagueNotices(day(20))).toBeGreaterThanOrEqual(1);
      expect(await jobs.colleagueNotices(day(20))).toBe(0);
      const notices = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.type, 'colleague_on_leave'),
            eq(notifications.recipientId, manager.id),
          ),
        );
      expect(notices).toHaveLength(1);
      expect(notices[0]?.data).toEqual({
        employee: employee.name,
        startsOn: day(21),
        endsOn: day(22),
      });
    });
  });
});
