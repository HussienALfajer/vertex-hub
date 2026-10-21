import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  auditPageSchema,
  businessDate,
  type EmployeeFile,
  employeeFileSchema,
  employeePageSchema,
  fileItemListSchema,
  fileItemSchema,
  salaryChangeListSchema,
  salaryChangeSchema,
  userWithLinkResponseSchema,
} from '@vertex-hub/contracts';
import {
  auditEntries,
  createDatabase,
  employeeFiles,
  notifications,
  users,
  workSchedules,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HrDailyService } from '../src/modules/hr/index.js';
import { expectError } from './client-cast.js';
import { api, removeUsers, seedUser } from './helpers.js';
import { startApp } from './start-app.js';

type Person = { id: string; cookie: string; name: string };

describe('HR employee files (F17 part A)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  const seeded: string[] = [];
  const schedules: string[] = [];
  const marker = `HR${Date.now()}`;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let daily: HrDailyService;
  let gm: Person;
  let ops: Person;
  let finance: Person;
  let manager: Person;
  let employee: Person;
  let colleague: Person;

  const today = businessDate();

  const file = async (person: Person, userId: string) => {
    const response = await client.get(`/api/hr/employees/${userId}`, person.cookie);
    expect(response.status, await response.clone().text()).toBe(200);
    return employeeFileSchema.parse(await response.json());
  };

  const patch = (person: Person | undefined, userId: string, body: unknown) =>
    client.request('PATCH', `/api/hr/employees/${userId}`, { cookie: person?.cookie, body });

  const notificationsOf = (type: string, subjectId: string) =>
    db
      .select()
      .from(notifications)
      .where(and(eq(notifications.type, type as never), eq(notifications.subjectId, subjectId)));

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    daily = app.get(HrDailyService);
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
    employee = await plain({ departments: [{ code: 'photography' }], name: `${marker} سامر` });
    colleague = await plain({ name: `${marker} رنا` });
  });

  afterAll(async () => {
    await app?.close();
    await db.delete(auditEntries).where(inArray(auditEntries.entityId, seeded));
    await removeUsers(db, seeded);
    if (schedules.length > 0) {
      await db.delete(workSchedules).where(inArray(workSchedules.id, schedules));
    }
    await connection.close();
  });

  it('answers 401 without a session', async () => {
    const id = employee.id;
    expect((await client.get('/api/hr/employees')).status).toBe(401);
    expect((await client.get(`/api/hr/employees/${id}`)).status).toBe(401);
    expect((await patch(undefined, id, { address: 'دمشق' })).status).toBe(401);
    expect(
      (await client.request('PUT', `/api/hr/employees/${id}/payout`, { body: { method: 'cash' } }))
        .status,
    ).toBe(401);
    expect((await client.get(`/api/hr/employees/${id}/salaries`)).status).toBe(401);
    expect((await client.post(`/api/hr/employees/${id}/salaries`, undefined, {})).status).toBe(401);
    expect((await client.post(`/api/hr/employees/${id}/end`, undefined, {})).status).toBe(401);
    expect((await client.request('DELETE', `/api/hr/employees/${id}/end`)).status).toBe(401);
  });

  describe('People and the file (rule A2)', () => {
    const page = async (person: Person, query = '') => {
      const response = await client.get(
        `/api/hr/employees?search=${encodeURIComponent(marker)}${query}`,
        person.cookie,
      );
      expect(response.status).toBe(200);
      return employeePageSchema.parse(await response.json());
    };

    it('lists every file to the GM with pay, to Ops without pay and to Finance with pay only', async () => {
      const all = await page(gm);
      expect(all.items.map((item) => item.userId)).toEqual(
        expect.arrayContaining([employee.id, colleague.id, ops.id]),
      );
      const mine = all.items.find((item) => item.userId === employee.id);
      expect(mine?.employment?.schedule.name).toBe('Main schedule');
      expect(mine?.employment?.annualLeaveDays).toBe(14);
      expect(mine?.pay).toMatchObject({ payoutMethod: null, currentSalary: null });

      const forOps = (await page(ops)).items.find((item) => item.userId === employee.id);
      expect(forOps?.employment).toBeDefined();
      expect(forOps?.pay).toBeUndefined();

      const forFinance = (await page(finance)).items.find((item) => item.userId === employee.id);
      expect(forFinance?.pay).toBeDefined();
      expect(forFinance?.employment).toBeUndefined();

      expect(
        (await page(gm, `&departmentId=${mine?.departments[0]?.id}`)).items.map((i) => i.userId),
      ).toEqual(expect.arrayContaining([employee.id, manager.id]));
    });

    it('refuses People to everyone else', async () => {
      expect((await client.get('/api/hr/employees', employee.cookie)).status).toBe(403);
      expect((await client.get('/api/hr/employees', manager.cookie)).status).toBe(403);
    });

    it('shows the employee their whole file and others nothing (404)', async () => {
      const own = await file(employee, employee.id);
      expect(own.personal).toBeDefined();
      expect(own.employment).toBeDefined();
      expect(own.pay).toBeDefined();
      expect((await client.get(`/api/hr/employees/${employee.id}`, colleague.cookie)).status).toBe(
        404,
      );
      expect((await client.get(`/api/hr/employees/${employee.id}`, manager.cookie)).status).toBe(
        404,
      );
    });

    it('shows Ops the file without pay and Finance the pay without the file', async () => {
      const forOps = await file(ops, employee.id);
      expect(forOps.personal).toBeDefined();
      expect(forOps.pay).toBeUndefined();
      const forFinance = await file(finance, employee.id);
      expect(forFinance.pay).toBeDefined();
      expect(forFinance.personal).toBeUndefined();
      expect(forFinance.employment).toBeUndefined();
    });

    it('answers 404 for no such user', async () => {
      const response = await client.get(
        '/api/hr/employees/01900000-0000-7000-8000-000000000000',
        gm.cookie,
      );
      expect(response.status).toBe(404);
    });
  });

  describe('editing the file', () => {
    it('lets Ops edit it, audits personal fields without their values', async () => {
      const response = await patch(ops, colleague.id, {
        nationalId: '01020304050',
        address: 'دمشق، المزة',
        emergencyPhone: '+963 944 123 456',
        employmentType: 'part_time',
        startDate: '2026-01-10',
        probationEndDate: '2026-04-10',
        remoteWeekdays: ['thursday', 'sunday'],
        annualLeaveDays: 16.5,
      });
      expect(response.status, await response.clone().text()).toBe(200);
      const updated = employeeFileSchema.parse(await response.json());
      expect(updated.personal).toMatchObject({
        nationalId: '01020304050',
        emergencyPhone: '+963944123456',
      });
      expect(updated.employment).toMatchObject({
        employmentType: 'part_time',
        remoteWeekdays: ['sunday', 'thursday'],
        annualLeaveDays: 16.5,
      });
      expect(updated.pay).toBeUndefined();

      const [entry] = await db
        .select()
        .from(auditEntries)
        .where(
          and(
            eq(auditEntries.entityId, colleague.id),
            eq(auditEntries.action, 'employee_file.updated'),
          ),
        );
      expect(entry?.after).toMatchObject({
        nationalId: 'changed',
        address: 'changed',
        employmentType: 'part_time',
        startDate: '2026-01-10',
      });
      expect(JSON.stringify(entry)).not.toContain('01020304050');
    });

    it('keeps probation and contract ends after the start (INVALID_DATES)', async () => {
      await expectError(
        await patch(ops, colleague.id, { contractEndDate: '2025-12-31' }),
        400,
        'INVALID_DATES',
      );
    });

    it('refuses an archived schedule (SCHEDULE_ARCHIVED)', async () => {
      const [schedule] = await db
        .insert(workSchedules)
        .values({ name: `${marker} قديم`, kind: 'fixed', archivedAt: new Date() })
        .returning();
      if (!schedule) throw new Error('No schedule');
      schedules.push(schedule.id);
      await expectError(
        await patch(ops, colleague.id, { scheduleId: schedule.id }),
        409,
        'SCHEDULE_ARCHIVED',
      );
    });

    it('refuses editing to Finance, the employee and department managers', async () => {
      for (const person of [finance, colleague, manager]) {
        expect((await patch(person, colleague.id, { address: 'حلب' })).status).toBe(403);
      }
    });
  });

  describe('payout method (rule A5)', () => {
    const put = (person: Person, body: unknown) =>
      client.request('PUT', `/api/hr/employees/${colleague.id}/payout`, {
        cookie: person.cookie,
        body,
      });

    it('lets Finance set a transfer with its details, and clears them for cash', async () => {
      const details = { institution: 'بنك سوريا الدولي', account: 'SY12 3456', holder: 'رنا' };
      expect((await put(finance, { method: 'bank_transfer', holder: 'رنا' })).status).toBe(400);
      const response = await put(finance, { method: 'bank_transfer', ...details });
      expect(response.status, await response.clone().text()).toBe(200);
      expect(employeeFileSchema.parse(await response.json()).pay).toMatchObject({
        payoutMethod: 'bank_transfer',
        payoutAccount: 'SY12 3456',
      });
      const cash = employeeFileSchema.parse(await (await put(finance, { method: 'cash' })).json());
      expect(cash.pay).toMatchObject({ payoutMethod: 'cash', payoutAccount: null });
    });

    it('refuses it to Ops and the employee', async () => {
      expect((await put(ops, { method: 'cash' })).status).toBe(403);
      expect((await put(colleague, { method: 'cash' })).status).toBe(403);
    });
  });

  describe('salary history (rule A4)', () => {
    const add = (person: Person, body: Record<string, unknown>) =>
      client.post(`/api/hr/employees/${employee.id}/salaries`, person.cookie, {
        currency: 'USD',
        reason: 'الراتب الابتدائي',
        ...body,
      });

    it('lets the GM add a change, tells the employee without the amount', async () => {
      const response = await add(gm, { effectiveOn: addDays(today, -30), amountMinor: 45_000_00 });
      expect(response.status, await response.clone().text()).toBe(201);
      const change = salaryChangeSchema.parse(await response.json());
      expect(change.createdBy?.id).toBe(gm.id);

      const own = await file(employee, employee.id);
      expect(own.pay?.currentSalary).toEqual({
        amountMinor: 45_000_00,
        currency: 'USD',
        effectiveOn: addDays(today, -30),
      });
      const [notice] = await notificationsOf('salary_changed', employee.id);
      expect(notice?.recipientId).toBe(employee.id);
      expect(JSON.stringify(notice?.data)).not.toContain('4500000');
    });

    it('refuses a second change on the same date until the first is archived', async () => {
      const effectiveOn = addDays(today, 30);
      const first = salaryChangeSchema.parse(
        await (await add(gm, { effectiveOn, amountMinor: 50_000_00 })).json(),
      );
      await expectError(
        await add(gm, { effectiveOn, amountMinor: 55_000_00 }),
        409,
        'DUPLICATE_EFFECTIVE_DATE',
      );
      const archived = await client.post(`/api/hr/salaries/${first.id}/archive`, gm.cookie, {
        reason: 'خطأ في المبلغ',
      });
      expect(archived.status).toBe(200);
      expect(salaryChangeSchema.parse(await archived.json()).archiveReason).toBe('خطأ في المبلغ');
      expect((await add(gm, { effectiveOn, amountMinor: 55_000_00 })).status).toBe(201);
    });

    it('shows the history to the employee and Finance, and 404 to Ops', async () => {
      for (const person of [employee, finance, gm]) {
        const response = await client.get(
          `/api/hr/employees/${employee.id}/salaries`,
          person.cookie,
        );
        expect(response.status).toBe(200);
        const history = salaryChangeListSchema.parse(await response.json());
        expect(history.items).toHaveLength(3);
        expect(history.items[0]?.effectiveOn).toBe(addDays(today, 30));
      }
      expect(
        (await client.get(`/api/hr/employees/${employee.id}/salaries`, ops.cookie)).status,
      ).toBe(404);
    });

    it('keeps adding and archiving to the GM', async () => {
      expect((await add(finance, { effectiveOn: today, amountMinor: 1 })).status).toBe(403);
      expect((await add(ops, { effectiveOn: today, amountMinor: 1 })).status).toBe(403);
      expect(
        (
          await client.post(
            '/api/hr/salaries/01900000-0000-7000-8000-000000000000/archive',
            finance.cookie,
            { reason: 'x' },
          )
        ).status,
      ).toBe(403);
    });

    it('shows salary amounts in the audit log to salaries.read holders only', async () => {
      const entries = async (person: Person) => {
        const response = await client.get(
          '/api/audit?entityType=salary_change&action=salary_change.created',
          person.cookie,
        );
        expect(response.status).toBe(200);
        return auditPageSchema
          .parse(await response.json())
          .items.filter((entry) => entry.after?.userId === employee.id);
      };
      expect((await entries(gm))[0]?.after).toHaveProperty('amountMinor');
      const forOps = await entries(ops);
      expect(forOps.length).toBeGreaterThan(0);
      expect(forOps[0]?.after).not.toHaveProperty('amountMinor');
    });
  });

  describe('documents (rule A6)', () => {
    const owner = () => ({ ownerType: 'employee', ownerId: employee.id, role: 'document' });
    const create = (person: Person, name: string, confidential: boolean) =>
      client.post('/api/files/items', person.cookie, {
        ...owner(),
        name,
        confidential,
        source: { url: `https://example.com/${encodeURIComponent(name)}` },
      });
    const names = async (person: Person) => {
      const response = await client.get(
        `/api/files/items?ownerType=employee&ownerId=${employee.id}`,
        person.cookie,
      );
      expect(response.status).toBe(200);
      return fileItemListSchema
        .parse(await response.json())
        .items.map((item) => item.name)
        .sort();
    };

    it('lets Ops add documents and Finance confidential ones only', async () => {
      expect((await create(ops, 'العقد', false)).status).toBe(201);
      await expectError(await create(ops, 'كشف الراتب', true), 403, 'NOT_CONFIDENTIAL_READER');
      expect((await create(finance, 'صورة الهوية', false)).status).toBe(403);
      const confidential = await create(finance, 'كشف الراتب', true);
      expect(confidential.status, await confidential.clone().text()).toBe(201);
      expect(fileItemSchema.parse(await confidential.json()).confidential).toBe(true);
      expect((await create(employee, 'شهادة', false)).status).toBe(403);
    });

    it('shows confidential documents to Finance and the employee only', async () => {
      expect(await names(ops)).toEqual(['العقد']);
      expect(await names(finance)).toEqual(['كشف الراتب']);
      expect(await names(employee)).toEqual(['العقد', 'كشف الراتب']);
      expect(await names(gm)).toEqual(['العقد', 'كشف الراتب']);
      expect(
        (
          await client.get(
            `/api/files/items?ownerType=employee&ownerId=${employee.id}`,
            colleague.cookie,
          )
        ).status,
      ).toBe(404);
    });
  });

  describe('contract and probation reminders (rule A7)', () => {
    it('reminds GMs and Ops once, and a changed date resolves the reminder', async () => {
      const contractEndDate = addDays(today, 20);
      expect((await patch(ops, colleague.id, { contractEndDate })).status).toBe(200);
      await daily.runDaily(today);
      const sent = await notificationsOf('contract_ending', colleague.id);
      const recipients = sent.map((row) => row.recipientId);
      expect(recipients).toEqual(expect.arrayContaining([gm.id, ops.id]));
      expect(recipients).not.toContain(colleague.id);
      expect(sent[0]?.data).toEqual({ employee: colleague.name, endsOn: contractEndDate });

      await daily.runDaily(today);
      expect(await notificationsOf('contract_ending', colleague.id)).toHaveLength(sent.length);

      expect(
        (await patch(ops, colleague.id, { contractEndDate: addDays(today, 200) })).status,
      ).toBe(200);
      const after = await notificationsOf('contract_ending', colleague.id);
      expect(after.every((row) => row.resolvedAt !== null)).toBe(true);
    });

    it('reminds of the probation end 14 days before', async () => {
      const probationEndDate = addDays(today, 10);
      expect(
        (await patch(ops, colleague.id, { startDate: addDays(today, -60), probationEndDate }))
          .status,
      ).toBe(200);
      await daily.runDaily(today);
      const [notice] = await notificationsOf('probation_ending', colleague.id);
      expect(notice?.data).toEqual({ employee: colleague.name, endsOn: probationEndDate });
    });
  });

  describe('end of service (rule A8)', () => {
    const end = (person: Person, body: unknown) =>
      client.post(`/api/hr/employees/${employee.id}/end`, person.cookie, body);

    it('refuses a past day and anyone without employees.manage', async () => {
      await expectError(
        await end(ops, { endedOn: addDays(today, -1), reason: 'resigned' }),
        400,
        'INVALID_DATES',
      );
      expect((await end(finance, { endedOn: today, reason: 'resigned' })).status).toBe(403);
      expect((await end(employee, { endedOn: today, reason: 'resigned' })).status).toBe(403);
    });

    it('sets the last day, tells GMs, Ops and the department managers, and can be undone', async () => {
      const response = await end(ops, {
        endedOn: addDays(today, 3),
        reason: 'resigned',
        note: 'استقالة بالتراضي',
      });
      expect(response.status, await response.clone().text()).toBe(200);
      const ended: EmployeeFile = employeeFileSchema.parse(await response.json());
      expect(ended.status).toBe('leaving');
      expect(ended.employment).toMatchObject({
        endReason: 'resigned',
        endNote: 'استقالة بالتراضي',
      });
      const recipients = (await notificationsOf('employee_leaving', employee.id)).map(
        (row) => row.recipientId,
      );
      expect(recipients).toEqual(expect.arrayContaining([gm.id, manager.id]));
      expect(recipients).not.toContain(employee.id);

      await expectError(
        await end(ops, { endedOn: addDays(today, 5), reason: 'resigned' }),
        409,
        'ALREADY_ENDED',
      );
      const cleared = await client.request('DELETE', `/api/hr/employees/${employee.id}/end`, {
        cookie: ops.cookie,
      });
      expect(cleared.status).toBe(200);
      expect(employeeFileSchema.parse(await cleared.json()).status).toBe('active');
    });

    it('archives the account the day after the last working day', async () => {
      expect((await end(ops, { endedOn: today, reason: 'contract_ended' })).status).toBe(200);
      expect((await daily.runDaily(today)).archived).toBe(0);
      expect((await daily.runDaily(addDays(today, 1))).archived).toBe(1);
      const [account] = await db.select().from(users).where(eq(users.id, employee.id));
      expect(account?.archivedAt).not.toBeNull();
      const [row] = await db
        .select()
        .from(employeeFiles)
        .where(eq(employeeFiles.userId, employee.id));
      expect(row?.archivedAt).not.toBeNull();
      expect((await file(gm, employee.id)).status).toBe('ended');
      expect((await daily.runDaily(addDays(today, 2))).archived).toBe(0);
      await expectError(await patch(ops, employee.id, { address: 'حمص' }), 409, 'USER_ARCHIVED');
    });
  });

  describe('the file follows the account (rule A1)', () => {
    it('is created with a new user, archived and restored with them', async () => {
      const [department] = (await file(gm, colleague.id)).departments;
      const response = await client.post('/api/users', gm.cookie, {
        name: `${marker} جديد`,
        email: `${marker.toLowerCase()}-new@vertexhub.test`,
        primaryDepartmentId: department?.id,
      });
      expect(response.status, await response.clone().text()).toBe(201);
      const { user } = userWithLinkResponseSchema.parse(await response.json());
      seeded.push(user.id);
      const [row] = await db.select().from(employeeFiles).where(eq(employeeFiles.userId, user.id));
      expect(row).toMatchObject({ annualLeaveDays: 14, archivedAt: null });

      expect((await client.post(`/api/users/${user.id}/archive`, gm.cookie)).status).toBe(200);
      expect((await file(gm, user.id)).status).toBe('ended');
      expect((await client.post(`/api/users/${user.id}/restore`, gm.cookie)).status).toBe(200);
      const [restored] = await db
        .select()
        .from(employeeFiles)
        .where(eq(employeeFiles.userId, user.id));
      expect(restored?.archivedAt).toBeNull();
    });
  });
});
