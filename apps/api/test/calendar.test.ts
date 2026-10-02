import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  type Calendar,
  type CalendarDate,
  type CreateMeetingInput,
  calendarSchema,
  type ErrorResponse,
  isWorkDay,
  meetingDetailSchema,
  nextWorkDay,
  upcomingReminderDay,
} from '@vertex-hub/contracts';
import { createDatabase } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CalendarReminders } from '../src/modules/calendar/calendar-reminders.js';
import { expectError } from './client-cast.js';
import { api } from './helpers.js';
import { seedShootCast } from './shoot-cast.js';
import { startApp } from './start-app.js';

/*
 * F11 PR 2: the company calendar (rules 15 and 16), the lead's responsibility and the two daily
 * reminder sources.
 */
describe('company calendar (F11 rules 15–16)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedShootCast>>;
  let clientId: string;

  async function meet(cookie: string, input: Partial<CreateMeetingInput>) {
    const response = await client.post('/api/meetings', cookie, {
      title: `اجتماع ${cast.run}`,
      acceptConflicts: true,
      ...input,
    });
    expect(response.status, await response.clone().text()).toBe(201);
    return meetingDetailSchema.parse(await response.json());
  }

  async function calendar(cookie: string, query: Record<string, string | string[]>) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      for (const item of [value].flat()) params.append(key, item);
    }
    const response = await client.get(`/api/calendar?${params}`, cookie);
    expect(response.status, await response.clone().text()).toBe(200);
    return calendarSchema.parse(await response.json());
  }

  const ids = (result: Calendar) => ({
    shoots: result.shoots.map((shoot) => shoot.id),
    meetings: result.meetings.map((meeting) => meeting.id),
    keyDates: result.keyDates.map((keyDate) => keyDate.kind),
  });

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedShootCast(db, client);
    clientId = (await cast.createClient()).id;
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    await connection.close();
  });

  it('requires a session and a range of at most 45 days', async () => {
    const from = cast.inDays(300);
    expect((await client.get(`/api/calendar?from=${from}&to=${from}`)).status).toBe(401);
    const get = (to: CalendarDate) =>
      client.get(`/api/calendar?from=${from}&to=${to}`, cast.designer.cookie);
    expect((await get(addDays(from, 44))).status).toBe(200);
    expect((await get(addDays(from, 45))).status).toBe(400);
    expect((await get(addDays(from, -1))).status).toBe(400);
  });

  describe('the range', () => {
    const from = () => cast.inDays(300);
    const to = () => cast.inDays(310);
    let shootId: string;
    let videoShootId: string;
    let meetingId: string;
    let cancelledMeetingId: string;
    let projectId: string;
    let retainerId: string;

    beforeAll(async () => {
      const shoot = await cast.bookOk(cast.am.cookie, {
        taskId: (await cast.photoTask(clientId)).id,
        startsAt: cast.at(302, '10:00'),
        endsAt: cast.at(302, '13:00'),
      });
      shootId = shoot.id;
      // Starts the evening before the range and ends inside it: it overlaps.
      const video = await cast.bookOk(cast.gm.cookie, {
        newTask: {},
        clientId,
        type: 'video',
        startsAt: cast.at(299, '22:00'),
        endsAt: cast.at(300, '02:00'),
        crew: [{ userId: cast.videographer.id, role: 'videographer', isLead: true }],
      });
      videoShootId = video.id;
      const archived = await cast.bookOk(cast.gm.cookie, {
        newTask: {},
        clientId,
        startsAt: cast.at(303, '10:00'),
        endsAt: cast.at(303, '11:00'),
      });
      expect((await client.post(`/api/shoots/${archived.id}/archive`, cast.gm.cookie)).status).toBe(
        200,
      );
      // Outside the range.
      await cast.bookOk(cast.gm.cookie, {
        newTask: {},
        clientId,
        startsAt: cast.at(311, '10:00'),
        endsAt: cast.at(311, '11:00'),
      });

      const meeting = await meet(cast.designer.cookie, {
        clientId,
        startsAt: cast.at(302, '12:00'),
        endsAt: cast.at(302, '13:00'),
        attendeeIds: [cast.photographer.id],
      });
      meetingId = meeting.id;
      const cancelled = await meet(cast.designer.cookie, {
        clientId,
        startsAt: cast.at(304, '09:00'),
        endsAt: cast.at(304, '10:00'),
      });
      cancelledMeetingId = cancelled.id;
      expect(
        (await client.post(`/api/meetings/${cancelled.id}/cancel`, cast.designer.cookie, {}))
          .status,
      ).toBe(200);
      const hidden = await meet(cast.designer.cookie, {
        clientId,
        startsAt: cast.at(305, '09:00'),
        endsAt: cast.at(305, '10:00'),
      });
      expect((await client.post(`/api/meetings/${hidden.id}/archive`, cast.gm.cookie)).status).toBe(
        200,
      );

      const project = await cast.createProject(clientId, {
        dueDate: cast.inDays(305),
        milestones: [
          { name: 'المرحلة الأولى', dueDate: cast.inDays(303) },
          { name: 'بلا موعد' },
          { name: 'خارج الفترة', dueDate: cast.inDays(299) },
        ],
      });
      projectId = project.id;
      // A cancelled project and an ended retainer have no key dates.
      const closed = await cast.createProject(clientId, { dueDate: cast.inDays(306) });
      const cancel = await client.post(`/api/projects/${closed.id}/status`, cast.gm.cookie, {
        status: 'cancelled',
        reason: 'ألغي',
      });
      expect(cancel.status, await cancel.clone().text()).toBe(200);
      retainerId = (await cast.createRetainer(clientId, { renewalDate: cast.inDays(307) })).id;
    });

    it('shows every user the shoots, meetings and key dates of the days', async () => {
      const result = await calendar(cast.designer.cookie, {
        from: from(),
        to: to(),
        clientId,
      });
      expect(ids(result)).toEqual({
        shoots: [videoShootId, shootId],
        meetings: [meetingId, cancelledMeetingId],
        keyDates: ['milestone_due', 'project_due', 'renewal'],
      });
      expect(result.shoots[1]).toMatchObject({
        status: 'scheduled',
        client: { id: clientId },
        lead: { id: cast.photographer.id },
        // The photographer is on the shoot and in the meeting at 12:00.
        conflict: true,
      });
      expect(result.meetings).toMatchObject([
        {
          status: 'scheduled',
          organizer: { id: cast.designer.id },
          attendeeCount: 1,
          conflict: true,
        },
        { status: 'cancelled', conflict: false },
      ]);
      expect(result.keyDates).toMatchObject([
        {
          kind: 'milestone_due',
          date: cast.inDays(303),
          title: 'المرحلة الأولى',
          targetId: projectId,
        },
        { kind: 'project_due', date: cast.inDays(305), targetId: projectId },
        {
          kind: 'renewal',
          date: cast.inDays(307),
          targetId: retainerId,
          client: { id: clientId, archived: false },
        },
      ]);
    });

    it('filters by kind, shoot type and person', async () => {
      const range = { from: from(), to: to(), clientId };
      expect(
        ids(await calendar(cast.designer.cookie, { ...range, kinds: ['meeting', 'renewal'] })),
      ).toEqual({ shoots: [], meetings: [meetingId, cancelledMeetingId], keyDates: ['renewal'] });
      expect(
        ids(await calendar(cast.designer.cookie, { ...range, kinds: 'shoot', shootType: 'video' })),
      ).toEqual({ shoots: [videoShootId], meetings: [], keyDates: [] });

      // "Mine": crew of shoots, organizer or attendee of meetings.
      expect(ids(await calendar(cast.photographer.cookie, { ...range, userId: 'me' }))).toEqual({
        shoots: [shootId],
        meetings: [meetingId],
        keyDates: [],
      });
      expect(
        ids(await calendar(cast.gm.cookie, { ...range, userId: cast.designer.id })),
      ).toMatchObject({ shoots: [], meetings: [meetingId, cancelledMeetingId] });
      // The project manager sees the project's dates, the account manager also the renewal.
      expect(
        ids(await calendar(cast.gm.cookie, { ...range, userId: cast.employee.id })).keyDates,
      ).toEqual(['milestone_due', 'project_due']);
      expect(ids(await calendar(cast.am.cookie, { ...range, userId: 'me' })).keyDates).toEqual([
        'milestone_due',
        'project_due',
        'renewal',
      ]);
      expect(
        ids(await calendar(cast.gm.cookie, { ...range, userId: cast.otherAm.id })).keyDates,
      ).toEqual([]);
    });
  });

  it('keeps the key dates of an archived client, marked (edge case 9)', async () => {
    const archived = await cast.createClient();
    const project = await cast.createProject(archived.id, { dueDate: cast.inDays(305) });
    const response = await client.post(`/api/clients/${archived.id}/archive`, cast.gm.cookie);
    expect(response.status, await response.clone().text()).toBe(200);
    const result = await calendar(cast.designer.cookie, {
      from: cast.inDays(300),
      to: cast.inDays(310),
      clientId: archived.id,
    });
    expect(result.keyDates).toMatchObject([
      { kind: 'project_due', targetId: project.id, client: { id: archived.id, archived: true } },
    ]);
  });

  describe('the lead (edge case 8)', () => {
    it('cannot be archived while leading a scheduled shoot in the future', async () => {
      // Outside Photography, so the new shoot task waits in the queue and is not theirs (F06).
      const lead = await cast.signedIn({ name: `قائد ${cast.run}` });
      const shoot = await cast.bookOk(cast.gm.cookie, {
        newTask: {},
        clientId: null,
        crew: [
          { userId: lead.id, role: 'director', isLead: true },
          { userId: cast.videographer.id, role: 'videographer', isLead: false },
        ],
      });
      const archive = () => client.post(`/api/users/${lead.id}/archive`, cast.gm.cookie);
      const body = (await expectError(
        await archive(),
        409,
        'USER_HAS_RESPONSIBILITIES',
      )) as ErrorResponse;
      expect(body.details).toEqual([
        { type: 'lead_of_scheduled_shoots', id: shoot.id, name: shoot.title },
      ]);
      const edited = await client.request('PATCH', `/api/shoots/${shoot.id}`, {
        cookie: cast.gm.cookie,
        body: {
          crew: [
            { userId: lead.id, role: 'director', isLead: false },
            { userId: cast.videographer.id, role: 'videographer', isLead: true },
          ],
        },
      });
      expect(edited.status, await edited.clone().text()).toBe(200);
      expect((await archive()).status).toBe(200);
    });
  });

  describe('daily reminders (Jobs)', () => {
    let reminders: CalendarReminders;

    /** The shoot and meeting sources of one day. */
    const upcoming = async (today: CalendarDate) =>
      (await reminders.upcomingShoots(today)) + (await reminders.upcomingMeetings(today));

    beforeAll(() => {
      reminders = app.get(CalendarReminders);
    });

    it('reminds the crew and the meeting people on the last work day before, once', async () => {
      const day = cast.inDays(60);
      const shoot = await cast.bookOk(cast.am.cookie, {
        taskId: (await cast.photoTask(clientId)).id,
        startsAt: cast.at(60, '10:00'),
        endsAt: cast.at(60, '12:00'),
        crew: [
          { userId: cast.photographer.id, role: 'photographer', isLead: true },
          { userId: cast.videographer.id, role: 'videographer', isLead: false },
        ],
      });
      const meeting = await meet(cast.designer.cookie, {
        startsAt: cast.at(60, '14:00'),
        endsAt: cast.at(60, '15:00'),
        attendeeIds: [cast.writer.id],
      });
      const cancelled = await meet(cast.designer.cookie, {
        startsAt: cast.at(60, '16:00'),
        endsAt: cast.at(60, '17:00'),
        attendeeIds: [cast.writer.id],
      });
      await client.post(`/api/meetings/${cancelled.id}/cancel`, cast.designer.cookie, {});
      const reminderDay = upcomingReminderDay(day);

      // Too early, and never on a Friday.
      await upcoming(upcomingReminderDay(reminderDay));
      let friday = cast.inDays(1);
      while (isWorkDay(friday)) friday = addDays(friday, 1);
      expect(await upcoming(friday)).toBe(0);
      expect(await cast.typesOf(cast.photographer.id, shoot.id)).toEqual(['shoot_booked']);

      expect(await upcoming(reminderDay)).toBeGreaterThanOrEqual(2);
      await upcoming(reminderDay);
      expect(await cast.typesOf(cast.photographer.id, shoot.id)).toEqual([
        'shoot_booked',
        'shoot_upcoming',
      ]);
      expect(await cast.typesOf(cast.videographer.id, shoot.id)).toEqual([
        'shoot_booked',
        'shoot_upcoming',
      ]);
      expect(await cast.typesOf(cast.am.id, shoot.id)).toEqual([]);
      expect(await cast.typesOf(cast.designer.id, meeting.id)).toEqual(['meeting_upcoming']);
      expect(await cast.typesOf(cast.writer.id, meeting.id)).toEqual([
        'meeting_invited',
        'meeting_upcoming',
      ]);
      expect(await cast.typesOf(cast.writer.id, cancelled.id)).not.toContain('meeting_upcoming');

      // Moved to a new day: reminded again for that day.
      const moved = await client.request('PATCH', `/api/shoots/${shoot.id}`, {
        cookie: cast.am.cookie,
        body: { startsAt: cast.at(70, '10:00'), endsAt: cast.at(70, '12:00') },
      });
      expect(moved.status, await moved.clone().text()).toBe(200);
      await upcoming(upcomingReminderDay(cast.inDays(70)));
      expect(await cast.typesOf(cast.videographer.id, shoot.id)).toEqual([
        'shoot_booked',
        'shoot_upcoming',
        'shoot_changed',
        'shoot_upcoming',
      ]);
    });

    it('tells the lead and the booker once about a shoot not closed after its day', async () => {
      const shoot = await cast.bookOk(cast.am.cookie, {
        taskId: (await cast.photoTask(clientId)).id,
        startsAt: cast.at(80, '10:00'),
        endsAt: cast.at(80, '12:00'),
        crew: [
          { userId: cast.photographer.id, role: 'photographer', isLead: true },
          { userId: cast.videographer.id, role: 'videographer', isLead: false },
        ],
      });
      const cancelled = await cast.bookOk(cast.am.cookie, {
        taskId: (await cast.photoTask(clientId)).id,
        startsAt: cast.at(80, '14:00'),
        endsAt: cast.at(80, '15:00'),
      });
      await client.post(`/api/shoots/${cancelled.id}/cancel`, cast.am.cookie, { reason: 'ألغي' });
      const after = nextWorkDay(cast.inDays(80));

      // Not on its own day.
      await reminders.notClosed(cast.inDays(80));
      expect(await cast.typesOf(cast.am.id, shoot.id)).toEqual([]);

      expect(await reminders.notClosed(after)).toBeGreaterThanOrEqual(1);
      await reminders.notClosed(after);
      await reminders.notClosed(nextWorkDay(after));
      expect(await cast.typesOf(cast.am.id, shoot.id)).toEqual(['shoot_not_closed']);
      expect(await cast.typesOf(cast.photographer.id, shoot.id)).toEqual([
        'shoot_booked',
        'shoot_not_closed',
      ]);
      expect(await cast.typesOf(cast.videographer.id, shoot.id)).toEqual(['shoot_booked']);
      expect(await cast.typesOf(cast.am.id, cancelled.id)).toEqual([]);
    });
  });
});
