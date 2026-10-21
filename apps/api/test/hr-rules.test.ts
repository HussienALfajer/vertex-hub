import type { INestApplication } from '@nestjs/common';
import {
  auditPageSchema,
  employeeFileSchema,
  type HrSettings,
  holidayListSchema,
  holidaySchema,
  hrSettingsSchema,
  templateDetailSchema,
  workScheduleListSchema,
  workScheduleSchema,
} from '@vertex-hub/contracts';
import {
  auditEntries,
  createDatabase,
  employeeFiles,
  hrSettings,
  notifications,
  publicHolidays,
  workScheduleDays,
  workSchedules,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HR_SETTINGS_ENTITY_ID } from '../src/modules/hr/hr-settings.service.js';
import { TemplateRunsService } from '../src/modules/templates/template-runs.service.js';
import { expectError } from './client-cast.js';
import { api, removeTemplates, removeUsers, seedUser } from './helpers.js';
import { startApp } from './start-app.js';

type Person = { id: string; cookie: string; name: string };

/** Holidays far in the future, so other test files never meet them. */
const YEAR = 2990;

const fixedDay = (weekday: string, startTime = '09:00') => ({
  weekday,
  startTime,
  latestStartTime: null,
  requiredMinutes: 480,
});

describe('HR rules: schedules, holidays and settings (F17 part B)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  const seeded: string[] = [];
  const schedules: string[] = [];
  const holidays: string[] = [];
  const templates: string[] = [];
  const marker = `HRB${Date.now()}`;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let gm: Person;
  let ops: Person;
  let finance: Person;
  let manager: Person;
  let employee: Person;
  let mainScheduleId: string;
  let originalSettings: HrSettings;

  const holidayNotices = (subjectId: string) =>
    db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.type, 'holiday_changed'), eq(notifications.subjectId, subjectId)),
      );

  const createSchedule = async (body: unknown, person = ops) => {
    const response = await client.post('/api/hr/schedules', person.cookie, body);
    expect(response.status, await response.clone().text()).toBe(201);
    const schedule = workScheduleSchema.parse(await response.json());
    schedules.push(schedule.id);
    return schedule;
  };

  const createHoliday = async (body: unknown, person = ops) => {
    const response = await client.post('/api/hr/holidays', person.cookie, body);
    expect(response.status, await response.clone().text()).toBe(201);
    const holiday = holidaySchema.parse(await response.json());
    holidays.push(holiday.id);
    return holiday;
  };

  const settings = async (person: Person) => {
    const response = await client.get('/api/hr/settings', person.cookie);
    expect(response.status).toBe(200);
    return hrSettingsSchema.parse(await response.json());
  };

  const putSettings = (person: Person | undefined, body: unknown) =>
    client.request('PUT', '/api/hr/settings', { cookie: person?.cookie, body });

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
    employee = await plain({ departments: [{ code: 'photography' }], name: `${marker} سامر` });
    const [main] = await db
      .select({ id: workSchedules.id })
      .from(workSchedules)
      .where(eq(workSchedules.isDefault, true));
    if (!main) throw new Error('No default schedule');
    mainScheduleId = main.id;
    originalSettings = await settings(gm);
  });

  afterAll(async () => {
    await app?.close();
    // The default goes back to the seeded schedule, whatever a failed test left.
    await db
      .update(workSchedules)
      .set({ isDefault: false })
      .where(inArray(workSchedules.id, schedules));
    await db
      .update(workSchedules)
      .set({ isDefault: true })
      .where(eq(workSchedules.id, mainScheduleId));
    await db
      .update(employeeFiles)
      .set({ scheduleId: mainScheduleId })
      .where(inArray(employeeFiles.scheduleId, schedules));
    if (originalSettings) {
      await db.update(hrSettings).set({ ...originalSettings, updatedById: null });
    }
    const ids = [...seeded, ...schedules, ...holidays, mainScheduleId, HR_SETTINGS_ENTITY_ID];
    await db.delete(auditEntries).where(inArray(auditEntries.entityId, ids));
    if (holidays.length > 0) {
      await db.delete(notifications).where(inArray(notifications.subjectId, holidays));
      await db.delete(publicHolidays).where(inArray(publicHolidays.id, holidays));
    }
    if (schedules.length > 0) {
      await db.delete(workScheduleDays).where(inArray(workScheduleDays.scheduleId, schedules));
      await db.delete(workSchedules).where(inArray(workSchedules.id, schedules));
    }
    await removeTemplates(db, templates);
    await removeUsers(db, seeded);
    await connection.close();
  });

  it('answers 401 without a session', async () => {
    const id = '01900000-0000-7000-8000-000000000000';
    expect((await client.get('/api/hr/schedules')).status).toBe(401);
    expect((await client.post('/api/hr/schedules', undefined, {})).status).toBe(401);
    expect((await client.request('PATCH', `/api/hr/schedules/${id}`, { body: {} })).status).toBe(
      401,
    );
    expect((await client.post(`/api/hr/schedules/${id}/archive`)).status).toBe(401);
    expect((await client.get(`/api/hr/holidays?year=${YEAR}`)).status).toBe(401);
    expect((await client.post('/api/hr/holidays', undefined, {})).status).toBe(401);
    expect((await client.post('/api/hr/holidays/repeat', undefined, {})).status).toBe(401);
    expect((await client.request('PATCH', `/api/hr/holidays/${id}`, { body: {} })).status).toBe(
      401,
    );
    expect((await client.post(`/api/hr/holidays/${id}/archive`)).status).toBe(401);
    expect((await client.get('/api/hr/settings')).status).toBe(401);
    expect((await putSettings(undefined, originalSettings)).status).toBe(401);
  });

  describe('work schedules (rule B2)', () => {
    const week = ['saturday', 'sunday', 'monday', 'tuesday', 'wednesday'] as const;

    it('reads with hr.read: GM, Ops and department managers, not Finance or employees', async () => {
      for (const person of [gm, ops, manager]) {
        const response = await client.get('/api/hr/schedules', person.cookie);
        expect(response.status).toBe(200);
        const list = workScheduleListSchema.parse(await response.json());
        expect(list.items[0]?.id).toBe(mainScheduleId);
        expect(list.items[0]?.isDefault).toBe(true);
        expect(list.items[0]?.days).toHaveLength(6);
      }
      for (const person of [finance, employee]) {
        expect((await client.get('/api/hr/schedules', person.cookie)).status).toBe(403);
      }
    });

    it('is managed by hr.manage only', async () => {
      const body = { name: `${marker} x`, kind: 'fixed', days: [fixedDay('saturday')] };
      for (const person of [manager, finance, employee]) {
        expect((await client.post('/api/hr/schedules', person.cookie, body)).status).toBe(403);
      }
      for (const person of [manager, finance, employee]) {
        expect(
          (await client.post(`/api/hr/schedules/${mainScheduleId}/archive`, person.cookie)).status,
        ).toBe(403);
        expect(
          (
            await client.request('PATCH', `/api/hr/schedules/${mainScheduleId}`, {
              cookie: person.cookie,
              body: { name: 'x' },
            })
          ).status,
        ).toBe(403);
      }
    });

    it('creates fixed and flexible schedules, days in week order, audited', async () => {
      const fixed = await createSchedule({
        name: `${marker} Ramadan`,
        kind: 'fixed',
        days: [fixedDay('monday', '10:00'), ...week.slice(0, 2).map((day) => fixedDay(day))],
      });
      expect(fixed.isDefault).toBe(false);
      expect(fixed.employees).toBe(0);
      expect(fixed.days.map((day) => day.weekday)).toEqual(['saturday', 'sunday', 'monday']);
      expect(fixed.days[2]).toEqual(fixedDay('monday', '10:00'));
      const flexible = await createSchedule({
        name: `${marker} Flexible`,
        kind: 'flexible',
        days: week.map((weekday) => ({
          weekday,
          startTime: '08:00',
          latestStartTime: '10:30',
          requiredMinutes: 420,
        })),
      });
      expect(flexible.days[0]?.latestStartTime).toBe('10:30');
      const response = await client.get(
        `/api/audit?entityType=work_schedule&entityId=${fixed.id}`,
        gm.cookie,
      );
      const entry = auditPageSchema.parse(await response.json()).items[0];
      expect(entry?.action).toBe('work_schedule.created');
    });

    it('refuses invalid times and taken names', async () => {
      const late = { name: `${marker} late`, kind: 'fixed', days: [fixedDay('saturday', '16:00')] };
      await expectError(
        await client.post('/api/hr/schedules', ops.cookie, late),
        400,
        'INVALID_TIMES',
      );
      const windowless = {
        name: `${marker} windowless`,
        kind: 'flexible',
        days: [fixedDay('saturday')],
      };
      await expectError(
        await client.post('/api/hr/schedules', ops.cookie, windowless),
        400,
        'INVALID_TIMES',
      );
      const taken = { name: `${marker} RAMADAN`, kind: 'fixed', days: [fixedDay('saturday')] };
      await expectError(
        await client.post('/api/hr/schedules', ops.cookie, taken),
        409,
        'SCHEDULE_NAME_TAKEN',
      );
    });

    it('replaces the days on an edit and checks the merged times', async () => {
      const schedule = await createSchedule({
        name: `${marker} edit`,
        kind: 'fixed',
        days: [fixedDay('saturday')],
      });
      const response = await client.request('PATCH', `/api/hr/schedules/${schedule.id}`, {
        cookie: ops.cookie,
        body: { days: [fixedDay('sunday', '08:00'), fixedDay('monday', '08:00')] },
      });
      expect(response.status, await response.clone().text()).toBe(200);
      const edited = workScheduleSchema.parse(await response.json());
      expect(edited.days.map((day) => day.weekday)).toEqual(['sunday', 'monday']);
      await expectError(
        await client.request('PATCH', `/api/hr/schedules/${schedule.id}`, {
          cookie: ops.cookie,
          body: { kind: 'flexible' },
        }),
        400,
        'INVALID_TIMES',
      );
    });

    it('keeps exactly one default, moved by making another the default', async () => {
      await expectError(
        await client.request('PATCH', `/api/hr/schedules/${mainScheduleId}`, {
          cookie: ops.cookie,
          body: { isDefault: false },
        }),
        409,
        'DEFAULT_REQUIRED',
      );
      await expectError(
        await client.post(`/api/hr/schedules/${mainScheduleId}/archive`, ops.cookie),
        409,
        'DEFAULT_REQUIRED',
      );
      const next = await createSchedule({
        name: `${marker} next default`,
        kind: 'fixed',
        days: [fixedDay('saturday')],
        isDefault: true,
      });
      expect(next.isDefault).toBe(true);
      const defaults = await db
        .select({ id: workSchedules.id })
        .from(workSchedules)
        .where(eq(workSchedules.isDefault, true));
      expect(defaults).toEqual([{ id: next.id }]);
      const back = await client.request('PATCH', `/api/hr/schedules/${mainScheduleId}`, {
        cookie: ops.cookie,
        body: { isDefault: true },
      });
      expect(back.status).toBe(200);
      expect(workScheduleSchema.parse(await back.json()).isDefault).toBe(true);
    });

    it('refuses to archive a schedule with employees, then archives it once they move', async () => {
      const schedule = await createSchedule({
        name: `${marker} in use`,
        kind: 'fixed',
        days: [fixedDay('saturday')],
      });
      const assign = (scheduleId: string) =>
        client.request('PATCH', `/api/hr/employees/${employee.id}`, {
          cookie: ops.cookie,
          body: { scheduleId },
        });
      expect((await assign(schedule.id)).status).toBe(200);
      const response = await client.post(`/api/hr/schedules/${schedule.id}/archive`, ops.cookie);
      const body = await expectError(response, 409, 'SCHEDULE_IN_USE');
      expect(body.details).toEqual({ employees: 1 });
      expect((await assign(mainScheduleId)).status).toBe(200);
      const archived = await client.post(`/api/hr/schedules/${schedule.id}/archive`, ops.cookie);
      expect(archived.status).toBe(200);
      expect(workScheduleSchema.parse(await archived.json()).archivedAt).not.toBeNull();
      await expectError(await assign(schedule.id), 409, 'SCHEDULE_ARCHIVED');
      const list = workScheduleListSchema.parse(
        await (await client.get('/api/hr/schedules', ops.cookie)).json(),
      );
      expect(list.items.map((item) => item.id)).not.toContain(schedule.id);
      expect(
        (
          await client.request('PATCH', `/api/hr/schedules/${schedule.id}`, {
            cookie: ops.cookie,
            body: { name: `${marker} renamed` },
          })
        ).status,
      ).toBe(404);
    });
  });

  describe('public holidays (rule B3)', () => {
    it('is read by everyone with calendar.read and managed by hr.manage only', async () => {
      const response = await client.get(`/api/hr/holidays?year=${YEAR}`, employee.cookie);
      expect(response.status).toBe(200);
      const body = { name: 'x', startsOn: `${YEAR}-01-01`, endsOn: `${YEAR}-01-01` };
      const id = '01900000-0000-7000-8000-000000000000';
      for (const person of [manager, finance, employee]) {
        expect((await client.post('/api/hr/holidays', person.cookie, body)).status).toBe(403);
        expect(
          (await client.post('/api/hr/holidays/repeat', person.cookie, { year: YEAR })).status,
        ).toBe(403);
        expect(
          (
            await client.request('PATCH', `/api/hr/holidays/${id}`, {
              cookie: person.cookie,
              body: { name: 'x' },
            })
          ).status,
        ).toBe(403);
        expect((await client.post(`/api/hr/holidays/${id}/archive`, person.cookie)).status).toBe(
          403,
        );
      }
    });

    it('adds a holiday, paid by default, and tells everyone but the author', async () => {
      const holiday = await createHoliday({
        name: `${marker} Eid`,
        startsOn: `${YEAR}-05-16`,
        endsOn: `${YEAR}-05-19`,
      });
      expect(holiday.paid).toBe(true);
      const notices = await holidayNotices(holiday.id);
      const recipients = notices.map((notice) => notice.recipientId);
      expect(recipients).toEqual(expect.arrayContaining([employee.id, gm.id, finance.id]));
      expect(recipients).not.toContain(ops.id);
      expect(notices[0]?.data).toMatchObject({
        change: 'added',
        startsOn: `${YEAR}-05-16`,
        endsOn: `${YEAR}-05-19`,
      });
      const list = holidayListSchema.parse(
        await (await client.get(`/api/hr/holidays?year=${YEAR}`, employee.cookie)).json(),
      );
      expect(list.items.map((item) => item.id)).toContain(holiday.id);
      const nextYear = holidayListSchema.parse(
        await (await client.get(`/api/hr/holidays?year=${YEAR + 1}`, employee.cookie)).json(),
      );
      expect(nextYear.items.map((item) => item.id)).not.toContain(holiday.id);
    });

    it('refuses more than ten days, a reversed range and an overlap', async () => {
      const post = (startsOn: string, endsOn: string) =>
        client.post('/api/hr/holidays', ops.cookie, { name: `${marker} x`, startsOn, endsOn });
      await expectError(await post(`${YEAR}-02-01`, `${YEAR}-02-11`), 400, 'INVALID_DATES');
      await expectError(await post(`${YEAR}-02-05`, `${YEAR}-02-04`), 400, 'INVALID_DATES');
      await expectError(await post(`${YEAR}-05-19`, `${YEAR}-05-20`), 409, 'HOLIDAY_OVERLAP');
      expect((await post(`${YEAR}-05-20`, `${YEAR}-05-20`)).status).toBe(201);
      const [last] = await db
        .select({ id: publicHolidays.id })
        .from(publicHolidays)
        .where(eq(publicHolidays.startsOn, `${YEAR}-05-20`));
      if (last) holidays.push(last.id);
    });

    it('notifies a new date, not a rename, and archives with a notice', async () => {
      const holiday = await createHoliday({
        name: `${marker} Labour`,
        startsOn: `${YEAR}-05-01`,
        endsOn: `${YEAR}-05-01`,
        paid: false,
      });
      const patch = (body: unknown) =>
        client.request('PATCH', `/api/hr/holidays/${holiday.id}`, { cookie: ops.cookie, body });
      const before = (await holidayNotices(holiday.id)).length;
      expect((await patch({ name: `${marker} Labour Day` })).status).toBe(200);
      expect(await holidayNotices(holiday.id)).toHaveLength(before);
      await expectError(
        await patch({ startsOn: `${YEAR}-05-19`, endsOn: `${YEAR}-05-19` }),
        409,
        'HOLIDAY_OVERLAP',
      );
      const moved = await patch({ startsOn: `${YEAR}-05-02`, endsOn: `${YEAR}-05-03` });
      expect(moved.status, await moved.clone().text()).toBe(200);
      const redated = (await holidayNotices(holiday.id)).find(
        (notice) => (notice.data as { change: string }).change === 'redated',
      );
      expect(redated?.data).toMatchObject({ startsOn: `${YEAR}-05-02`, endsOn: `${YEAR}-05-03` });
      const archived = await client.post(`/api/hr/holidays/${holiday.id}/archive`, ops.cookie);
      expect(archived.status).toBe(200);
      expect(holidaySchema.parse(await archived.json()).archivedAt).not.toBeNull();
      const changes = (await holidayNotices(holiday.id)).map(
        (notice) => (notice.data as { change: string }).change,
      );
      expect(changes).toContain('archived');
      expect((await patch({ name: 'x' })).status).toBe(404);
    });

    it("repeats last year's holidays on the same dates, skipping those that would overlap", async () => {
      const response = await client.post('/api/hr/holidays/repeat', ops.cookie, {
        year: YEAR + 1,
      });
      expect(response.status, await response.clone().text()).toBe(201);
      const copies = holidayListSchema.parse(await response.json()).items;
      holidays.push(...copies.map((copy) => copy.id));
      const ours = copies.filter((copy) => copy.name.startsWith(marker));
      expect(ours.map((copy) => [copy.startsOn, copy.endsOn])).toEqual([
        [`${YEAR + 1}-05-16`, `${YEAR + 1}-05-19`],
        [`${YEAR + 1}-05-20`, `${YEAR + 1}-05-20`],
      ]);
      // A second run finds every copy already there.
      const again = await client.post('/api/hr/holidays/repeat', ops.cookie, { year: YEAR + 1 });
      expect(holidayListSchema.parse(await again.json()).items).toEqual([]);
    });
  });

  describe('HR settings', () => {
    it('reads the seeded defaults with hr.read', async () => {
      expect(originalSettings.graceMinutes).toBeGreaterThanOrEqual(0);
      expect((await client.get('/api/hr/settings', manager.cookie)).status).toBe(200);
      for (const person of [finance, employee]) {
        expect((await client.get('/api/hr/settings', person.cookie)).status).toBe(403);
      }
    });

    it('is replaced by hr.manage only, validated and audited', async () => {
      expect((await putSettings(manager, originalSettings)).status).toBe(403);
      const tiers = [
        { upToMinutes: null, fraction: 1 },
        { upToMinutes: 30, fraction: 0.25 },
      ];
      expect((await putSettings(ops, { ...originalSettings, latenessTiers: tiers })).status).toBe(
        400,
      );
      const changed = { ...originalSettings, graceMinutes: 15, defaultAnnualLeaveDays: 21 };
      const response = await putSettings(ops, changed);
      expect(response.status, await response.clone().text()).toBe(200);
      expect(hrSettingsSchema.parse(await response.json())).toEqual(changed);
      expect(await settings(gm)).toEqual(changed);
      const audit = await client.get(
        `/api/audit?entityType=hr_settings&entityId=${HR_SETTINGS_ENTITY_ID}`,
        gm.cookie,
      );
      const entries = auditPageSchema.parse(await audit.json());
      expect(entries.items[0]?.action).toBe('hr_settings.updated');
      // Saving the same settings again changes nothing and writes no entry.
      expect((await putSettings(ops, changed)).status).toBe(200);
      const again = await client.get(
        `/api/audit?entityType=hr_settings&entityId=${HR_SETTINGS_ENTITY_ID}`,
        gm.cookie,
      );
      expect(auditPageSchema.parse(await again.json()).total).toBe(entries.total);
    });

    it('gives a new file the default annual leave of the settings', async () => {
      const newcomer = await seedUser(db, { name: `${marker} جديد` });
      seeded.push(newcomer.id);
      const response = await client.get(`/api/hr/employees/${newcomer.id}`, gm.cookie);
      expect(response.status).toBe(200);
      const file = employeeFileSchema.parse(await response.json());
      expect(file.employment?.annualLeaveDays).toBe(21);
      expect((await putSettings(ops, originalSettings)).status).toBe(200);
    });
  });

  describe('work days skip public holidays (rule B1)', () => {
    it('moves the due dates of a new template run past a holiday', async () => {
      const created = await client.post('/api/templates', ops.cookie, {
        name: `${marker} template`,
        kind: 'project',
        description: 'For tests',
        stages: [],
        steps: [{ key: 'brief', title: 'Brief', department: 'marketing', dueDay: 3 }],
        assignees: [],
      });
      expect(created.status, await created.clone().text()).toBe(201);
      const template = templateDetailSchema.parse(await created.json());
      templates.push(template.id);
      const runs = app.get(TemplateRunsService);
      // Saturday 9 January: day 3 is Monday 11 without holidays.
      const start = `${YEAR}-01-09`;
      const plain = await runs.planNewProject([template.id], start);
      expect(plain.get(template.id)?.lastDue).toBe(`${YEAR}-01-11`);
      await createHoliday({ name: `${marker} New year`, startsOn: start, endsOn: `${YEAR}-01-10` });
      const skipped = await runs.planNewProject([template.id], start);
      expect(skipped.get(template.id)?.lastDue).toBe(`${YEAR}-01-13`);
    });
  });
});
