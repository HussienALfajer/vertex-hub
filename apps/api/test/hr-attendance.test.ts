import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  attendanceDayListSchema,
  attendanceGreetingSchema,
  attendanceKioskListSchema,
  attendanceKioskPairingSchema,
  attendancePasskeyListSchema,
  attendancePasskeySchema,
  businessDate,
  holidaySchema,
  hrRequestPageSchema,
  hrSettingsSchema,
  kioskCodeEventSchema,
  myAttendanceTodaySchema,
  punchResultSchema,
  taskDetailSchema,
  WEEKDAYS,
  webAuthnChallengeSchema,
  weekdayOf,
  workScheduleSchema,
} from '@vertex-hub/contracts';
import {
  attendanceDays,
  attendancePunches,
  auditEntries,
  createDatabase,
  hrRequests,
  notifications,
  publicHolidays,
  shootCrew,
  shoots,
  workScheduleDays,
  workSchedules,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HrDailyService } from '../src/modules/hr/index.js';
import { api, removeShoots, removeTasks, removeUsers, seedUser } from './helpers.js';
import { SoftAuthenticator } from './soft-authenticator.js';
import { startApp } from './start-app.js';

type Person = { id: string; cookie: string; name: string };

/** The office network of these tests: the screen and the phones leave through it. */
const OFFICE_IP = '203.0.113.7';
const HOME_IP = '198.51.100.20';

/** A Server-Sent Events reader over a fetch response. */
function eventReader(response: Response) {
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const queue: { event: string; data: unknown }[] = [];
  return {
    async next(event: string, timeoutMs = 5000): Promise<unknown> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        // The latest of its kind: older codes have expired.
        const found = queue.filter((item) => item.event === event);
        if (found.length > 0) {
          queue.splice(0, queue.length, ...queue.filter((item) => item.event !== event));
          return found.at(-1)?.data;
        }
        if (Date.now() > deadline) throw new Error(`No ${event} event`);
        const chunk = await Promise.race([
          reader.read(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
        ]);
        if (!chunk || chunk.done) continue;
        buffer += decoder.decode(chunk.value, { stream: true });
        for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const name = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (name && data) queue.push({ event: name, data: JSON.parse(data) });
        }
      }
    },
    close: () => reader.cancel().catch(() => {}),
  };
}

describe('HR attendance: passkeys, entrance screens and punches (F17 part C)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  const seeded: string[] = [];
  const schedules: string[] = [];
  const shootIds: string[] = [];
  const holidayIds: string[] = [];
  const taskIds: string[] = [];
  const marker = `HRA${Date.now()}`;
  const today = businessDate();
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let gm: Person;
  let ops: Person;
  let manager: Person;
  let designManager: Person;
  let employee: Person;
  let colleague: Person;
  let exempt: Person;
  let newcomer: Person;
  let newcomerSchedule = '';
  let kioskCookie = '';
  let kioskId = '';
  let screen: ReturnType<typeof eventReader> | null = null;
  const phone = new SoftAuthenticator();
  let colleaguePhone = new SoftAuthenticator();

  const call = (
    method: string,
    path: string,
    person: Person | undefined,
    body?: unknown,
    ip?: string,
  ) => client.request(method, path, { cookie: person?.cookie, body, ip });

  const ok = async (response: Response, status = 200) => {
    expect(response.status, await response.clone().text()).toBe(status);
    return response.json();
  };

  const code = async (response: Response) => ((await response.json()) as { code?: string }).code;

  const registerPasskey = async (person: Person, authenticator: SoftAuthenticator) => {
    const challenge = webAuthnChallengeSchema.parse(
      await ok(await call('POST', '/api/hr/passkeys/options', person, {})),
    );
    return attendancePasskeySchema.parse(
      await ok(
        await call('POST', '/api/hr/passkeys', person, {
          ticket: challenge.ticket,
          response: authenticator.register(challenge.options),
        }),
        201,
      ),
    );
  };

  /** Both requests of a punch; the response of the second. */
  const punch = async (
    person: Person,
    authenticator: SoftAuthenticator,
    options: Record<string, unknown>,
    extra: Record<string, unknown> = {},
    ip = OFFICE_IP,
  ) => {
    const first = await call('POST', '/api/hr/attendance/punch/options', person, options, ip);
    if (first.status !== 200) return first;
    const challenge = webAuthnChallengeSchema.parse(await first.json());
    return call(
      'POST',
      '/api/hr/attendance/punch',
      person,
      { ticket: challenge.ticket, assertion: authenticator.assert(challenge.options), ...extra },
      ip,
    );
  };

  /** Moves the person's punches two minutes back, past the duplicate guard (edge case 8). */
  const age = (person: Person) =>
    db
      .update(attendancePunches)
      .set({ at: new Date(Date.now() - 2 * 60_000) })
      .where(eq(attendancePunches.userId, person.id));

  let lastCode: { code: string; expiresAt: number } | null = null;

  /** A code still accepted (its window or the next one, rule C5), waiting for one if needed. */
  const currentCode = async () => {
    if (!screen) throw new Error('No screen stream');
    if (!lastCode || Date.now() > lastCode.expiresAt + 10_000) {
      const event = kioskCodeEventSchema.parse(await screen.next('code', 25_000));
      lastCode = { code: event.code, expiresAt: Date.parse(event.expiresAt) };
    }
    return lastCode.code;
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
    exempt = await plain({ departments: [{ code: 'photography' }], name: `${marker} معفى` });
    newcomer = await plain({ departments: [{ code: 'photography' }], name: `${marker} جديد` });
    // A schedule that works every day from midnight, so today is a work day whenever this runs.
    const schedule = workScheduleSchema.parse(
      await ok(
        await call('POST', '/api/hr/schedules', ops, {
          name: `${marker} كل يوم`,
          kind: 'fixed',
          days: WEEKDAYS.map((weekday) => ({
            weekday,
            startTime: '00:00',
            latestStartTime: null,
            requiredMinutes: 60,
          })),
        }),
        201,
      ),
    );
    schedules.push(schedule.id);
    const file = (person: Person, body: Record<string, unknown>) =>
      call('PATCH', `/api/hr/employees/${person.id}`, ops, body);
    const started = { startDate: addDays(today, -30), scheduleId: schedule.id };
    await ok(await file(employee, { ...started, remoteWeekdays: [weekdayOf(today)] }));
    await ok(await file(colleague, started));
    await ok(await file(exempt, { ...started, attendanceExempt: true }));
    // A schedule of its own, so editing it touches nobody else.
    const own = workScheduleSchema.parse(
      await ok(
        await call('POST', '/api/hr/schedules', ops, {
          name: `${marker} جديد`,
          kind: 'fixed',
          days: WEEKDAYS.map((weekday) => ({
            weekday,
            startTime: '00:00',
            latestStartTime: null,
            requiredMinutes: 60,
          })),
        }),
        201,
      ),
    );
    schedules.push(own.id);
    newcomerSchedule = own.id;
    await ok(await file(newcomer, { startDate: addDays(today, -3), scheduleId: own.id }));
  });

  afterAll(async () => {
    await screen?.close();
    await app?.close();
    await removeShoots(db, shootIds);
    await removeTasks(db, taskIds);
    if (holidayIds.length > 0) {
      await db.delete(notifications).where(inArray(notifications.subjectId, holidayIds));
      await db.delete(auditEntries).where(inArray(auditEntries.entityId, holidayIds));
      await db.delete(publicHolidays).where(inArray(publicHolidays.id, holidayIds));
    }
    const ids = [...seeded, ...shootIds];
    if (ids.length > 0) {
      await db.delete(notifications).where(inArray(notifications.subjectId, ids));
      await db.delete(auditEntries).where(inArray(auditEntries.entityId, ids));
    }
    if (kioskId) await db.delete(auditEntries).where(eq(auditEntries.entityId, kioskId));
    await removeUsers(db, seeded);
    if (schedules.length > 0) {
      await db.delete(workScheduleDays).where(inArray(workScheduleDays.scheduleId, schedules));
      await db.delete(workSchedules).where(inArray(workSchedules.id, schedules));
    }
    await connection.close();
  });

  it('answers 401 without a session and 403 without the permission', async () => {
    const id = '01900000-0000-7000-8000-000000000000';
    expect((await call('GET', '/api/hr/attendance/me/today', undefined)).status).toBe(401);
    expect(
      (await call('GET', `/api/hr/attendance/days?month=${today.slice(0, 7)}`, undefined)).status,
    ).toBe(401);
    expect(
      (await call('POST', '/api/hr/attendance/punch/options', undefined, { method: 'field' }))
        .status,
    ).toBe(401);
    expect(
      (await call('POST', '/api/hr/attendance/punch', undefined, { ticket: 'x', assertion: {} }))
        .status,
    ).toBe(401);
    expect((await call('POST', '/api/hr/passkeys/options', undefined, {})).status).toBe(401);
    expect((await call('GET', '/api/hr/passkeys/me', undefined)).status).toBe(401);
    expect((await call('GET', `/api/hr/passkeys?userId=${id}`, colleague)).status).toBe(403);
    expect((await call('POST', `/api/hr/passkeys/${id}/revoke`, ops, { note: 'x' })).status).toBe(
      403,
    );
    expect((await call('GET', '/api/hr/kiosks', manager)).status).toBe(403);
    expect((await call('POST', '/api/hr/kiosks', manager, { name: 'x' })).status).toBe(403);
    expect((await call('POST', `/api/hr/kiosks/${id}/archive`, manager)).status).toBe(403);
    expect((await call('POST', `/api/hr/kiosks/${id}/pairing-code`, manager)).status).toBe(403);
    expect((await call('GET', '/api/kiosk/stream', undefined)).status).toBe(401);
  });

  describe('attendance passkeys (rules C3, C9)', () => {
    it('refuses an exempt user', async () => {
      expect(await code(await call('POST', '/api/hr/passkeys/options', exempt, {}))).toBe('EXEMPT');
    });

    it('activates the first passkey at once and never signs anyone in', async () => {
      const passkey = await registerPasskey(employee, phone);
      expect(passkey).toMatchObject({ status: 'active', user: { id: employee.id } });
      const mine = attendancePasskeyListSchema.parse(
        await ok(await call('GET', '/api/hr/passkeys/me', employee)),
      );
      expect(mine.items.map((item) => item.status)).toEqual(['active']);
      await registerPasskey(colleague, colleaguePhone);
    });

    it('refuses a signature from another authenticator or a forged ticket', async () => {
      const stranger = new SoftAuthenticator();
      const challenge = webAuthnChallengeSchema.parse(
        await ok(await call('POST', '/api/hr/passkeys/options', employee, {})),
      );
      const forged = `${challenge.ticket.split('.')[0]}.AAAA`;
      expect(
        await code(
          await call('POST', '/api/hr/passkeys', employee, {
            ticket: forged,
            response: stranger.register(challenge.options),
          }),
        ),
      ).toBe('TICKET_EXPIRED');
      expect(
        await code(
          await call('POST', '/api/hr/passkeys', colleague, {
            ticket: challenge.ticket,
            response: stranger.register(challenge.options),
          }),
        ),
        "another user's ticket",
      ).toBe('TICKET_EXPIRED');
    });

    it('holds a replacement for the GM, who approves it and revokes the old one', async () => {
      const newPhone = new SoftAuthenticator();
      const pending = await registerPasskey(colleague, newPhone);
      expect(pending.status).toBe('pending');
      expect(await code(await call('POST', '/api/hr/passkeys/options', colleague, {}))).toBe(
        'PENDING_EXISTS',
      );
      const [request] = await db
        .select()
        .from(hrRequests)
        .where(
          and(eq(hrRequests.userId, colleague.id), eq(hrRequests.kind, 'passkey_replacement')),
        );
      expect(request?.status).toBe('pending');
      const submitted = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.subjectId, request?.id ?? ''),
            eq(notifications.type, 'hr_request_submitted'),
          ),
        );
      expect(submitted.map((row) => row.recipientId)).toContain(gm.id);
      // The old phone still punches until the GM decides.
      const page = hrRequestPageSchema.parse(
        await ok(await call('GET', '/api/hr/requests?kind=passkey_replacement&status=pending', gm)),
      );
      expect(page.items.map((item) => item.id)).toContain(request?.id);
      await ok(
        await call('POST', `/api/hr/requests/${request?.id}/decision`, gm, { decision: 'approve' }),
      );
      const list = attendancePasskeyListSchema.parse(
        await ok(await call('GET', `/api/hr/passkeys?userId=${colleague.id}`, ops)),
      );
      expect(list.items.map((item) => item.status)).toEqual(['active', 'revoked']);
      expect(list.items[0]?.id).toBe(pending.id);
      // The replaced phone no longer verifies.
      expect(
        await code(
          await punch(
            colleague,
            colleaguePhone,
            { method: 'field', latitude: 33.5, longitude: 36.3 },
            { fieldNote: 'x' },
          ),
        ),
      ).toBe('PASSKEY_FAILED');
      colleaguePhone = newPhone;
    });

    it('lets the department manager see their members only, and the GM revoke', async () => {
      const scoped = attendancePasskeyListSchema.parse(
        await ok(await call('GET', `/api/hr/passkeys?userId=${employee.id}`, manager)),
      );
      expect(scoped.items).toHaveLength(1);
      const outside = attendancePasskeyListSchema.parse(
        await ok(await call('GET', `/api/hr/passkeys?userId=${employee.id}`, designManager)),
      );
      expect(outside.items).toHaveLength(0);
      const spare = await registerPasskey(exempt, new SoftAuthenticator()).catch(() => null);
      expect(spare, 'exempt users have none').toBeNull();
    });
  });

  describe('entrance screens (rules C4–C6)', () => {
    it('pairs a screen with a one-time code and streams its codes', async () => {
      const created = attendanceKioskPairingSchema.parse(
        await ok(await call('POST', '/api/hr/kiosks', ops, { name: `${marker} المدخل` }), 201),
      );
      kioskId = created.id;
      expect(created).toMatchObject({ paired: false });
      expect(created.pairingCode).toMatch(/^[A-Z2-9]{8}$/);
      expect(
        await code(
          await call('POST', '/api/kiosk/pair', undefined, { code: 'ABCDEFGH' }, OFFICE_IP),
        ),
      ).toBe('INVALID_PAIRING_CODE');
      const paired = await call(
        'POST',
        '/api/kiosk/pair',
        undefined,
        { code: created.pairingCode.toLowerCase() },
        OFFICE_IP,
      );
      expect(await ok(paired)).toEqual({ id: created.id, name: created.name });
      const cookie = paired.headers.getSetCookie()[0] ?? '';
      expect(cookie).toMatch(/^vh_kiosk=[\w-]+; Path=\/api\/kiosk; Max-Age=\d+; HttpOnly/);
      kioskCookie = cookie.split(';')[0] ?? '';
      expect(
        await code(
          await call(
            'POST',
            '/api/kiosk/pair',
            undefined,
            { code: created.pairingCode },
            OFFICE_IP,
          ),
        ),
        'the code is used once',
      ).toBe('INVALID_PAIRING_CODE');
      const stream = await client.request('GET', '/api/kiosk/stream', {
        cookie: kioskCookie,
        ip: OFFICE_IP,
      });
      expect(stream.status).toBe(200);
      screen = eventReader(stream);
      expect(await screen.next('kiosk')).toEqual({ id: created.id, name: created.name });
      expect(await currentCode()).toMatch(new RegExp(`^${created.id}\\.\\d+\\.[\\w-]{22}$`));
      const list = attendanceKioskListSchema.parse(
        await ok(await call('GET', '/api/hr/kiosks', ops)),
      );
      expect(list.items.find((item) => item.id === created.id)).toMatchObject({
        paired: true,
        lastIpAddress: OFFICE_IP,
      });
    });
  });

  describe('punches (rules C5–C8, C11, C13, C15, C20)', () => {
    it('offers the methods of the day, in trial before the start date', async () => {
      const mine = myAttendanceTodaySchema.parse(
        await ok(await call('GET', '/api/hr/attendance/me/today', employee)),
      );
      expect(mine).toMatchObject({
        date: today,
        exemption: null,
        trial: true,
        passkey: { active: true, pending: false },
        nextDirection: 'in',
        methods: ['office', 'remote', 'field'],
      });
      expect(mine.day).toMatchObject({ kind: 'work', status: 'trial', place: 'remote' });
      const other = myAttendanceTodaySchema.parse(
        await ok(await call('GET', '/api/hr/attendance/me/today', exempt)),
      );
      expect(other).toMatchObject({ exemption: 'exempt', day: null, methods: [] });
    });

    it('refuses a code from outside the office network, and audits it', async () => {
      const scanned = await currentCode();
      expect(
        await code(await punch(employee, phone, { method: 'office', code: scanned }, {}, HOME_IP)),
      ).toBe('OFF_OFFICE_NETWORK');
      const [refusal] = await db
        .select()
        .from(auditEntries)
        .where(
          and(
            eq(auditEntries.entityId, employee.id),
            eq(auditEntries.action, 'attendance.punch_refused'),
          ),
        );
      expect(refusal?.after).toMatchObject({ reason: 'OFF_OFFICE_NETWORK', ipAddress: HOME_IP });
      expect(
        await code(
          await punch(employee, phone, {
            method: 'office',
            code: `${kioskId}.1.AAAAAAAAAAAAAAAAAAAAAA`,
          }),
        ),
      ).toBe('INVALID_CODE');
      expect(await code(await punch(exempt, phone, { method: 'office', code: scanned }))).toBe(
        'EXEMPT',
      );
    });

    it('checks in at the office with the code and the passkey, and greets on the screen', async () => {
      const response = await punch(employee, phone, {
        method: 'office',
        code: await currentCode(),
      });
      const result = punchResultSchema.parse(await ok(response, 201));
      expect(result.punch).toMatchObject({
        direction: 'in',
        method: 'office',
        kioskName: `${marker} المدخل`,
        fieldReview: null,
      });
      expect(result.day).toMatchObject({ date: today, status: 'trial' });
      expect(result.day.punches).toHaveLength(1);
      expect(result.greeting).toMatchObject({
        direction: 'in',
        firstName: 'سامر',
        tasksDueToday: 0,
      });
      const greeting = attendanceGreetingSchema.parse(await screen?.next('greeting'));
      expect(greeting.firstName).toBe('سامر');
      expect(
        await code(await punch(employee, phone, { method: 'office', code: await currentCode() })),
        'a second punch within a minute',
      ).toBe('DUPLICATE_PUNCH');
    });

    it('checks out with the next punch and reports the time worked', async () => {
      await age(employee);
      const result = punchResultSchema.parse(
        await ok(
          await punch(employee, phone, { method: 'remote', latitude: 33.51, longitude: 36.29 }),
          201,
        ),
      );
      expect(result.punch).toMatchObject({ direction: 'out', method: 'remote', latitude: 33.51 });
      expect(result.greeting).toMatchObject({ direction: 'out', workedMinutes: 2 });
      expect(result.day.punches.map((p) => p.direction)).toEqual(['in', 'out']);
    });

    it('needs the location away from the office, and a remote day for a remote punch', async () => {
      await age(employee);
      expect(await code(await punch(employee, phone, { method: 'remote' }))).toBe(
        'LOCATION_REQUIRED',
      );
      expect(
        await code(
          await punch(colleague, colleaguePhone, { method: 'remote', latitude: 1, longitude: 1 }),
        ),
      ).toBe('NOT_REMOTE_DAY');
      expect(await code(await punch(colleague, colleaguePhone, { method: 'field' }))).toBe(
        'LOCATION_REQUIRED',
      );
      const noNote = await punch(colleague, colleaguePhone, {
        method: 'field',
        latitude: 33.5,
        longitude: 36.3,
      });
      expect(noNote.status, 'a field punch needs its note').toBe(400);
    });

    it('records a field punch as accepted (rule C11)', async () => {
      const result = punchResultSchema.parse(
        await ok(
          await punch(
            colleague,
            colleaguePhone,
            { method: 'field', latitude: 33.5, longitude: 36.3, accuracyM: 12 },
            { fieldNote: 'زيارة عميل' },
          ),
          201,
        ),
      );
      expect(result.punch).toMatchObject({
        method: 'field',
        fieldReview: 'accepted',
        fieldNote: 'زيارة عميل',
        accuracyM: 12,
      });
    });

    it('opens a shoot check-in to its crew around its time (rule C13)', async () => {
      const task = taskDetailSchema.parse(
        await ok(
          await call('POST', '/api/tasks', gm, {
            title: `${marker} تصوير`,
            department: 'photography',
            assigneeId: employee.id,
            dueDate: addDays(today, 3),
          }),
          201,
        ),
      );
      taskIds.push(task.id);
      const [shoot] = await db
        .insert(shoots)
        .values({
          title: `${marker} تصوير المنتجات`,
          type: 'product',
          taskId: task.id,
          startsAt: new Date(Date.now() + 20 * 60_000),
          endsAt: new Date(Date.now() + 120 * 60_000),
          location: 'الاستوديو',
          createdById: gm.id,
        })
        .returning();
      if (!shoot) throw new Error('No shoot');
      shootIds.push(shoot.id);
      await db
        .insert(shootCrew)
        .values({ shootId: shoot.id, userId: employee.id, role: 'photographer', isLead: true });
      const mine = myAttendanceTodaySchema.parse(
        await ok(await call('GET', '/api/hr/attendance/me/today', employee)),
      );
      expect(mine.methods).toContain('shoot');
      expect(mine.shoots.map((item) => item.id)).toEqual([shoot.id]);
      await age(colleague);
      expect(
        await code(
          await punch(colleague, colleaguePhone, {
            method: 'shoot',
            shootId: shoot.id,
            latitude: 1,
            longitude: 1,
          }),
        ),
      ).toBe('NOT_ON_SHOOT');
      await age(employee);
      const result = punchResultSchema.parse(
        await ok(
          await punch(employee, phone, {
            method: 'shoot',
            shootId: shoot.id,
            latitude: 33.5,
            longitude: 36.3,
          }),
          201,
        ),
      );
      expect(result.punch).toMatchObject({
        direction: 'in',
        method: 'shoot',
        fieldReview: 'accepted',
        shoot: { id: shoot.id, location: 'الاستوديو' },
      });
    });
  });

  describe('days (rules C1, C14, C16)', () => {
    it("lists a month's days to the person and to hr.read in scope only", async () => {
      const month = today.slice(0, 7);
      const own = attendanceDayListSchema.parse(
        await ok(await call('GET', `/api/hr/attendance/days?month=${month}`, employee)),
      );
      expect(own.items.find((day) => day.date === today)?.punches.length).toBe(3);
      expect(
        (await call('GET', `/api/hr/attendance/days?month=${month}&userId=${employee.id}`, manager))
          .status,
      ).toBe(200);
      expect(
        (
          await call(
            'GET',
            `/api/hr/attendance/days?month=${month}&userId=${employee.id}`,
            designManager,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await call(
            'GET',
            `/api/hr/attendance/days?month=${month}&userId=${employee.id}`,
            colleague,
          )
        ).status,
      ).toBe(404);
    });

    it('leaves the trial from the start date, which is today or later', async () => {
      const settings = hrSettingsSchema.parse(await ok(await call('GET', '/api/hr/settings', ops)));
      expect(
        await code(
          await call('PUT', '/api/hr/settings', ops, {
            ...settings,
            attendanceStartsOn: addDays(today, -1),
          }),
        ),
      ).toBe('INVALID_DATES');
      try {
        await ok(
          await call('PUT', '/api/hr/settings', ops, { ...settings, attendanceStartsOn: today }),
        );
        const [day] = await db
          .select()
          .from(attendanceDays)
          .where(and(eq(attendanceDays.userId, employee.id), eq(attendanceDays.date, today)));
        expect(day?.status).toBe('in_progress');
      } finally {
        await ok(await call('PUT', '/api/hr/settings', ops, settings));
      }
      const [day] = await db
        .select()
        .from(attendanceDays)
        .where(and(eq(attendanceDays.userId, employee.id), eq(attendanceDays.date, today)));
      expect(day?.status).toBe('trial');
    });

    it('shows an approved leave on the day (rule C14)', async () => {
      await ok(
        await call('POST', '/api/hr/requests', gm, {
          kind: 'leave',
          leaveType: 'unpaid',
          userId: colleague.id,
          startsOn: today,
          endsOn: today,
          reason: 'سبب',
        }),
        201,
      );
      const [day] = await db
        .select()
        .from(attendanceDays)
        .where(and(eq(attendanceDays.userId, colleague.id), eq(attendanceDays.date, today)));
      expect(day).toMatchObject({ leave: 'full', status: 'leave' });
    });

    it('turns the day into a holiday and back when a holiday changes (rule C14)', async () => {
      const kindToday = async () =>
        (
          await db
            .select({ kind: attendanceDays.kind })
            .from(attendanceDays)
            .where(and(eq(attendanceDays.userId, employee.id), eq(attendanceDays.date, today)))
        )[0]?.kind;
      const holiday = holidaySchema.parse(
        await ok(
          await call('POST', '/api/hr/holidays', ops, {
            name: `${marker} عطلة`,
            startsOn: today,
            endsOn: today,
          }),
          201,
        ),
      );
      holidayIds.push(holiday.id);
      expect(await kindToday()).toBe('holiday');
      await ok(await call('POST', `/api/hr/holidays/${holiday.id}/archive`, ops));
      expect(await kindToday()).toBe('work');
    });

    it('creates the days of everyone attendance applies to in the daily job (rule C2)', async () => {
      const tomorrow = addDays(today, 1);
      await app.get(HrDailyService).runDaily(tomorrow);
      const rows = await db
        .select({ userId: attendanceDays.userId, status: attendanceDays.status })
        .from(attendanceDays)
        .where(
          and(
            eq(attendanceDays.date, tomorrow),
            inArray(attendanceDays.userId, [employee.id, colleague.id, exempt.id]),
          ),
        )
        .orderBy(desc(attendanceDays.userId));
      expect(rows.map((row) => row.userId).sort()).toEqual([employee.id, colleague.id].sort());
      expect(rows.every((row) => row.status === 'trial')).toBe(true);
    });
  });

  describe('file and schedule changes (rules B2, C2, C14; edge case 10)', () => {
    const todayRow = async (person: Person) =>
      (
        await db
          .select()
          .from(attendanceDays)
          .where(and(eq(attendanceDays.userId, person.id), eq(attendanceDays.date, today)))
      )[0];

    it("moves today's hours with its schedule while it has no punch", async () => {
      await ok(await call('GET', '/api/hr/attendance/me/today', newcomer));
      expect((await todayRow(newcomer))?.requiredMinutes).toBe(60);
      await ok(
        await call('PATCH', `/api/hr/schedules/${newcomerSchedule}`, ops, {
          days: WEEKDAYS.map((weekday) => ({
            weekday,
            startTime: '00:00',
            latestStartTime: null,
            requiredMinutes: 90,
          })),
        }),
      );
      expect((await todayRow(newcomer))?.requiredMinutes).toBe(90);
    });

    it('takes a first and a second half-day leave as a full day', async () => {
      for (const half of ['first_half', 'second_half']) {
        await ok(
          await call('POST', '/api/hr/requests', gm, {
            kind: 'leave',
            leaveType: 'unpaid',
            userId: newcomer.id,
            startsOn: today,
            endsOn: today,
            half,
            reason: 'سبب',
          }),
          201,
        );
      }
      expect(await todayRow(newcomer)).toMatchObject({ leave: 'full', status: 'leave' });
    });

    it('takes the days before a later start date out', async () => {
      await ok(
        await call('PATCH', `/api/hr/employees/${newcomer.id}`, ops, {
          startDate: addDays(today, 1),
        }),
      );
      expect((await todayRow(newcomer))?.archivedAt).not.toBeNull();
    });
  });

  describe('revocation and unpairing', () => {
    it('lets the GM revoke a passkey, after which the person cannot punch', async () => {
      const [active] = attendancePasskeyListSchema
        .parse(await ok(await call('GET', '/api/hr/passkeys/me', employee)))
        .items.filter((item) => item.status === 'active');
      const revoked = attendancePasskeySchema.parse(
        await ok(
          await call('POST', `/api/hr/passkeys/${active?.id}/revoke`, gm, { note: 'هاتف مفقود' }),
        ),
      );
      expect(revoked).toMatchObject({ status: 'revoked', decidedBy: { id: gm.id } });
      await age(employee);
      expect(
        await code(await punch(employee, phone, { method: 'field', latitude: 1, longitude: 1 })),
      ).toBe('NO_PASSKEY');
      const next = await registerPasskey(employee, new SoftAuthenticator());
      expect(next.status, 'after a revocation, a new passkey waits for the GM').toBe('pending');
    });

    it('unpairs the screen with a new pairing code, then archives it', async () => {
      const again = attendanceKioskPairingSchema.parse(
        await ok(await call('POST', `/api/hr/kiosks/${kioskId}/pairing-code`, ops)),
      );
      expect(again).toMatchObject({ id: kioskId, paired: false });
      expect(
        (await client.request('GET', '/api/kiosk/stream', { cookie: kioskCookie, ip: OFFICE_IP }))
          .status,
        'the old cookie stops working',
      ).toBe(401);
      const paired = await call('POST', '/api/kiosk/pair', undefined, { code: again.pairingCode });
      await ok(paired);
      kioskCookie = paired.headers.getSetCookie()[0]?.split(';')[0] ?? '';
      await ok(await call('POST', `/api/hr/kiosks/${kioskId}/archive`, ops));
      expect(
        (await client.request('GET', '/api/kiosk/stream', { cookie: kioskCookie, ip: OFFICE_IP }))
          .status,
      ).toBe(401);
    });
  });
});
