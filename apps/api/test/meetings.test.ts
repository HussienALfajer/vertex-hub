import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  type CreateMeetingInput,
  conflictListSchema,
  type ErrorResponse,
  type MeetingDetail,
  meetingDetailSchema,
} from '@vertex-hub/contracts';
import { createDatabase } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError } from './client-cast.js';
import { api } from './helpers.js';
import { seedShootCast } from './shoot-cast.js';
import { startApp } from './start-app.js';

/*
 * F11 PR 2: meetings (rule 14): create, read, edit, cancel, archive and restore, with their
 * conflicts (rule 5), notifications and the organizer's responsibility.
 */
describe('meetings (F11 rule 14)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedShootCast>>;
  let clientId: string;
  let otherClientId: string;

  /** Tomorrow 12:00–13:00; tests share people, so conflicts are accepted unless a test says. */
  const fields = (input: Partial<CreateMeetingInput> = {}): CreateMeetingInput => ({
    title: `اجتماع ${cast.run}`,
    startsAt: cast.at(1, '12:00'),
    endsAt: cast.at(1, '13:00'),
    acceptConflicts: true,
    ...input,
  });
  const create = (cookie: string | undefined, input: Partial<CreateMeetingInput> = {}) =>
    client.post('/api/meetings', cookie, fields(input));
  const patch = (id: string, cookie: string | undefined, body: unknown) =>
    client.request('PATCH', `/api/meetings/${id}`, { cookie, body });
  const action = (id: string, name: string, cookie: string | undefined, body: unknown = {}) =>
    client.post(`/api/meetings/${id}/${name}`, cookie, body);

  async function ok(response: Response): Promise<MeetingDetail> {
    expect(response.status, await response.clone().text()).toBeLessThan(300);
    return meetingDetailSchema.parse(await response.json());
  }

  const createOk = async (cookie: string, input: Partial<CreateMeetingInput> = {}) =>
    ok(await create(cookie, input));

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedShootCast(db, client);
    clientId = (await cast.createClient()).id;
    otherClientId = (await cast.createClient({ accountManagerId: cast.otherAm.id })).id;
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    await connection.close();
  });

  it('requires a session on every route', async () => {
    const id = randomUUID();
    const responses = await Promise.all([
      client.get(`/api/meetings/${id}`),
      create(undefined),
      patch(id, undefined, { title: 'x' }),
      action(id, 'cancel', undefined),
      action(id, 'archive', undefined),
      action(id, 'restore', undefined),
    ]);
    expect(responses.map((response) => response.status)).toEqual(responses.map(() => 401));
  });

  describe('creating', () => {
    it('lets any user create a meeting and makes them its organizer', async () => {
      const contactId = await cast.contactOf(clientId);
      const meeting = await createOk(cast.designer.cookie, {
        clientId,
        location: 'قاعة الاجتماعات',
        onlineUrl: 'https://meet.example.com/abc',
        agenda: 'خطة الشهر',
        attendeeIds: [cast.videographer.id, cast.am.id],
        contactIds: [contactId],
      });
      expect(meeting).toMatchObject({
        status: 'scheduled',
        client: { id: clientId, archived: false },
        organizer: { id: cast.designer.id, archived: false },
        attendeeCount: 2,
        location: 'قاعة الاجتماعات',
        agenda: 'خطة الشهر',
        createdBy: { id: cast.designer.id },
        permissions: { canEdit: true, canCancel: true, canArchive: false },
      });
      expect(meeting.attendees.map((person) => person.id).sort()).toEqual(
        [cast.videographer.id, cast.am.id].sort(),
      );
      expect(meeting.contacts).toMatchObject([{ id: contactId, archived: false }]);
      expect(await cast.typesOf(cast.videographer.id, meeting.id)).toEqual(['meeting_invited']);
      expect(await cast.typesOf(cast.am.id, meeting.id)).toEqual(['meeting_invited']);
      expect(await cast.typesOf(cast.designer.id, meeting.id)).toEqual([]);
      const [created] = await cast.auditOf(meeting.id);
      expect(created).toMatchObject({
        action: 'meeting.created',
        entityType: 'meeting',
        actorId: cast.designer.id,
        after: { clientId, organizerId: cast.designer.id, contactIds: [contactId] },
      });

      // Everyone reads it (rule 16); the caller's scope shapes what they may do.
      const read = async (cookie: string) =>
        (await ok(await client.get(`/api/meetings/${meeting.id}`, cookie))).permissions;
      expect(await read(cast.photographer.cookie)).toEqual({
        canEdit: false,
        canCancel: false,
        canArchive: false,
      });
      expect(await read(cast.am.cookie)).toMatchObject({ canEdit: true, canArchive: false });
      expect(await read(cast.otherAm.cookie)).toMatchObject({ canEdit: false });
      expect(await read(cast.operations.cookie)).toMatchObject({ canEdit: true, canArchive: true });
      expect((await client.get(`/api/meetings/${randomUUID()}`, cast.gm.cookie)).status).toBe(404);
    });

    it('creates an internal meeting without a client, attendees or contacts', async () => {
      const meeting = await createOk(cast.employee.cookie);
      expect(meeting).toMatchObject({ client: null, attendeeCount: 0, contacts: [] });
    });

    it('checks the attendees, the contacts, the client and the length', async () => {
      const contactId = await cast.contactOf(clientId);
      const leaver = await cast.signedIn();
      expect((await client.post(`/api/users/${leaver.id}/archive`, cast.gm.cookie)).status).toBe(
        200,
      );
      const cookie = cast.designer.cookie;
      await expectError(
        await create(cookie, { attendeeIds: [cast.designer.id] }),
        400,
        'INVALID_ATTENDEE',
      );
      await expectError(
        await create(cookie, { attendeeIds: [leaver.id] }),
        400,
        'INVALID_ATTENDEE',
      );
      await expectError(
        await create(cookie, { attendeeIds: [randomUUID()] }),
        400,
        'INVALID_ATTENDEE',
      );
      await expectError(await create(cookie, { contactIds: [contactId] }), 400, 'UNKNOWN_CONTACT');
      await expectError(
        await create(cookie, { clientId: otherClientId, contactIds: [contactId] }),
        400,
        'UNKNOWN_CONTACT',
      );
      expect((await create(cookie, { clientId: randomUUID() })).status).toBe(404);
      // Longer than 12 hours, an empty time range, more than 20 attendees.
      expect(
        (await create(cookie, { startsAt: cast.at(1, '08:00'), endsAt: cast.at(1, '20:30') }))
          .status,
      ).toBe(400);
      expect(
        (await create(cookie, { startsAt: cast.at(1, '10:00'), endsAt: cast.at(1, '10:00') }))
          .status,
      ).toBe(400);
      expect(
        (
          await create(cookie, {
            attendeeIds: Array.from({ length: 21 }, () => randomUUID()),
          })
        ).status,
      ).toBe(400);
    });
  });

  describe('conflicts (rule 5)', () => {
    it('warns when an attendee is on a shoot or the organizer in another meeting', async () => {
      const shoot = await cast.bookOk(cast.gm.cookie, {
        taskId: (await cast.photoTask(clientId)).id,
        startsAt: cast.at(40, '10:00'),
        endsAt: cast.at(40, '13:00'),
        crew: [{ userId: cast.videographer.id, role: 'videographer', isLead: true }],
        acceptConflicts: false,
      });
      const overlapping = {
        startsAt: cast.at(40, '12:00'),
        endsAt: cast.at(40, '13:00'),
        attendeeIds: [cast.videographer.id],
        acceptConflicts: false,
      };
      const refused = await create(cast.photographyManager.cookie, overlapping);
      const body = (await expectError(refused, 409, 'SCHEDULE_CONFLICT')) as ErrorResponse;
      expect(body.details).toEqual([
        expect.objectContaining({
          user: { id: cast.videographer.id, name: cast.videographer.name },
          kind: 'shoot',
          id: shoot.id,
        }),
      ]);

      const meeting = await createOk(cast.photographyManager.cookie, {
        ...overlapping,
        acceptConflicts: true,
      });
      expect(meeting.conflict).toBe(true);
      expect(meeting.conflicts.map((conflict) => conflict.id)).toEqual([shoot.id]);
      expect((await cast.detail(shoot.id)).conflicts).toEqual([
        expect.objectContaining({ kind: 'meeting', id: meeting.id }),
      ]);
      const [created] = await cast.auditOf(meeting.id);
      expect(created?.after).toMatchObject({
        acceptedConflicts: [expect.objectContaining({ id: shoot.id })],
      });

      // The organizer is checked like an attendee; touching times are free.
      await expectError(
        await create(cast.photographyManager.cookie, {
          startsAt: cast.at(40, '12:30'),
          endsAt: cast.at(40, '14:00'),
          acceptConflicts: false,
        }),
        409,
        'SCHEDULE_CONFLICT',
      );
      const after = await createOk(cast.photographyManager.cookie, {
        startsAt: cast.at(40, '13:00'),
        endsAt: cast.at(40, '14:00'),
        acceptConflicts: false,
      });
      expect(after.conflict).toBe(false);

      // The live check of the dialog, without the meeting being edited.
      const query = new URLSearchParams({
        userIds: cast.videographer.id,
        startsAt: cast.at(40, '12:15'),
        endsAt: cast.at(40, '12:45'),
        excludeMeetingId: meeting.id,
      });
      const response = await client.get(`/api/calendar/conflicts?${query}`, cast.designer.cookie);
      expect(conflictListSchema.parse(await response.json()).items.map((c) => c.id)).toEqual([
        shoot.id,
      ]);

      // Moving the meeting off the shoot clears the warning; a cancelled meeting never conflicts.
      const moved = await ok(
        await patch(meeting.id, cast.photographyManager.cookie, {
          startsAt: cast.at(40, '14:00'),
          endsAt: cast.at(40, '15:00'),
        }),
      );
      expect(moved.conflict).toBe(false);
      await expectError(
        await patch(meeting.id, cast.photographyManager.cookie, {
          startsAt: cast.at(40, '13:30'),
          endsAt: cast.at(40, '14:30'),
        }),
        409,
        'SCHEDULE_CONFLICT',
      );
      await ok(await action(after.id, 'cancel', cast.photographyManager.cookie));
      const back = await ok(
        await patch(meeting.id, cast.photographyManager.cookie, {
          startsAt: cast.at(40, '13:30'),
          endsAt: cast.at(40, '14:30'),
        }),
      );
      expect(back.conflict).toBe(false);
    });
  });

  describe('editing', () => {
    it('tells the people what changed, who was added and who was removed', async () => {
      const meeting = await createOk(cast.designer.cookie, {
        clientId,
        attendeeIds: [cast.videographer.id, cast.photographer.id],
      });
      const edited = await ok(
        await patch(meeting.id, cast.designer.cookie, {
          title: 'اجتماع المراجعة',
          startsAt: cast.at(2, '09:00'),
          endsAt: cast.at(2, '10:00'),
          location: 'المكتب',
          onlineUrl: 'https://meet.example.com/new',
          attendeeIds: [cast.videographer.id, cast.writer.id],
        }),
      );
      expect(edited).toMatchObject({ title: 'اجتماع المراجعة', location: 'المكتب' });
      expect(edited.attendees.map((person) => person.id).sort()).toEqual(
        [cast.videographer.id, cast.writer.id].sort(),
      );
      expect(await cast.typesOf(cast.videographer.id, meeting.id)).toEqual([
        'meeting_invited',
        'meeting_changed',
      ]);
      expect(await cast.typesOf(cast.writer.id, meeting.id)).toEqual(['meeting_invited']);
      expect(await cast.typesOf(cast.photographer.id, meeting.id)).toEqual([
        'meeting_invited',
        'meeting_dropped',
      ]);
      expect(await cast.typesOf(cast.designer.id, meeting.id)).toEqual([]);
      const audit = await cast.auditOf(meeting.id);
      expect(audit.at(-1)).toMatchObject({
        action: 'meeting.updated',
        before: { title: meeting.title, location: null },
        after: { title: 'اجتماع المراجعة', location: 'المكتب' },
      });
      expect(audit.at(-1)?.after).toMatchObject({
        attendeeIds: expect.arrayContaining([cast.videographer.id, cast.writer.id]),
      });

      // Nothing changed: no audit entry, no notification.
      await ok(await patch(meeting.id, cast.designer.cookie, { title: 'اجتماع المراجعة' }));
      expect(await cast.auditOf(meeting.id)).toHaveLength(audit.length);
    });

    it('lets meeting scope hand the meeting to another organizer', async () => {
      const meeting = await createOk(cast.designer.cookie, {
        clientId,
        attendeeIds: [cast.writer.id],
      });
      // The new organizer is no longer listed as an attendee.
      await expectError(
        await patch(meeting.id, cast.am.cookie, { organizerId: cast.writer.id }),
        400,
        'INVALID_ATTENDEE',
      );
      await expectError(
        await patch(meeting.id, cast.am.cookie, { organizerId: randomUUID(), attendeeIds: [] }),
        400,
        'INVALID_ATTENDEE',
      );
      const handed = await ok(
        await patch(meeting.id, cast.am.cookie, {
          organizerId: cast.writer.id,
          attendeeIds: [cast.photographer.id],
        }),
      );
      expect(handed.organizer.id).toBe(cast.writer.id);
      expect(await cast.typesOf(cast.photographer.id, meeting.id)).toEqual(['meeting_invited']);
      expect(await cast.typesOf(cast.designer.id, meeting.id)).toEqual(['meeting_dropped']);
      // The first organizer lost meeting scope with the meeting; the new one holds it.
      expect((await patch(meeting.id, cast.designer.cookie, { title: 'x' })).status).toBe(403);
      await ok(await patch(meeting.id, cast.writer.cookie, { title: 'بعنوان جديد' }));

      // An attendee who becomes the organizer is told too.
      const promoted = await ok(
        await patch(meeting.id, cast.am.cookie, {
          organizerId: cast.photographer.id,
          attendeeIds: [],
        }),
      );
      expect(promoted).toMatchObject({ organizer: { id: cast.photographer.id }, attendeeCount: 0 });
      expect(await cast.typesOf(cast.photographer.id, meeting.id)).toEqual([
        'meeting_invited',
        'meeting_invited',
      ]);
      expect(await cast.typesOf(cast.writer.id, meeting.id)).toContain('meeting_dropped');
    });

    it('drops the contacts of the old client when the client changes', async () => {
      const contactId = await cast.contactOf(clientId);
      const otherContactId = await cast.contactOf(otherClientId);
      const meeting = await createOk(cast.designer.cookie, { clientId, contactIds: [contactId] });
      await expectError(
        await patch(meeting.id, cast.designer.cookie, { clientId: otherClientId }),
        400,
        'UNKNOWN_CONTACT',
      );
      await expectError(
        await patch(meeting.id, cast.designer.cookie, { clientId: null }),
        400,
        'UNKNOWN_CONTACT',
      );
      const moved = await ok(
        await patch(meeting.id, cast.designer.cookie, {
          clientId: otherClientId,
          contactIds: [otherContactId],
        }),
      );
      expect(moved).toMatchObject({
        client: { id: otherClientId },
        contacts: [{ id: otherContactId }],
      });
    });

    it('takes no archived client, and keeps a meeting whose client was archived (edge case 9)', async () => {
      const archived = await cast.createClient();
      const kept = await createOk(cast.designer.cookie, { clientId: archived.id });
      const other = await createOk(cast.designer.cookie);
      const response = await client.post(`/api/clients/${archived.id}/archive`, cast.gm.cookie);
      expect(response.status, await response.clone().text()).toBe(200);
      await expectError(
        await create(cast.designer.cookie, { clientId: archived.id }),
        409,
        'CLIENT_ARCHIVED',
      );
      await expectError(
        await patch(other.id, cast.designer.cookie, { clientId: archived.id }),
        409,
        'CLIENT_ARCHIVED',
      );
      const edited = await ok(
        await patch(kept.id, cast.designer.cookie, { agenda: 'ما زال قائماً' }),
      );
      expect(edited.client).toMatchObject({ id: archived.id, archived: true });
    });

    it('keeps everyone outside meeting scope out (Roles and access)', async () => {
      const meeting = await createOk(cast.designer.cookie, { clientId });
      for (const cookie of [cast.photographer.cookie, cast.otherAm.cookie]) {
        expect((await patch(meeting.id, cookie, { title: 'x' })).status).toBe(403);
        expect((await action(meeting.id, 'cancel', cookie)).status).toBe(403);
      }
      for (const cookie of [cast.am.cookie, cast.operations.cookie, cast.gm.cookie]) {
        await ok(await patch(meeting.id, cookie, { agenda: randomUUID() }));
      }
      // An internal meeting is covered by its organizer and scope all only.
      const internal = await createOk(cast.designer.cookie);
      expect((await patch(internal.id, cast.am.cookie, { title: 'x' })).status).toBe(403);
      await ok(await patch(internal.id, cast.operations.cookie, { title: 'داخلي' }));
      expect((await patch(randomUUID(), cast.gm.cookie, { title: 'x' })).status).toBe(404);
    });
  });

  describe('cancel, archive and restore', () => {
    it('cancels for good and tells the people', async () => {
      const meeting = await createOk(cast.designer.cookie, {
        attendeeIds: [cast.videographer.id],
      });
      const cancelled = await ok(
        await action(meeting.id, 'cancel', cast.designer.cookie, { reason: 'تأجل' }),
      );
      expect(cancelled).toMatchObject({
        status: 'cancelled',
        cancelReason: 'تأجل',
        conflicts: [],
        permissions: { canEdit: false, canCancel: false },
      });
      expect(cancelled.cancelledAt).not.toBeNull();
      expect(await cast.typesOf(cast.videographer.id, meeting.id)).toEqual([
        'meeting_invited',
        'meeting_dropped',
      ]);
      expect((await cast.auditOf(meeting.id)).at(-1)).toMatchObject({
        action: 'meeting.cancelled',
        after: { status: 'cancelled', cancelReason: 'تأجل' },
      });
      await expectError(
        await patch(meeting.id, cast.designer.cookie, { title: 'x' }),
        409,
        'MEETING_NOT_SCHEDULED',
      );
      await expectError(
        await action(meeting.id, 'cancel', cast.designer.cookie),
        409,
        'MEETING_NOT_SCHEDULED',
      );
      // The reason is optional.
      const other = await createOk(cast.designer.cookie);
      expect(await ok(await action(other.id, 'cancel', cast.designer.cookie))).toMatchObject({
        status: 'cancelled',
        cancelReason: null,
      });
    });

    it('archives and restores for scope all only, hiding the meeting from the others', async () => {
      const meeting = await createOk(cast.designer.cookie, { clientId });
      for (const cookie of [cast.designer.cookie, cast.am.cookie]) {
        expect((await action(meeting.id, 'archive', cookie)).status).toBe(403);
        expect((await action(meeting.id, 'restore', cookie)).status).toBe(403);
      }
      await expectError(
        await action(meeting.id, 'restore', cast.gm.cookie),
        409,
        'MEETING_NOT_ARCHIVED',
      );
      const archived = await ok(await action(meeting.id, 'archive', cast.operations.cookie));
      expect(archived.archivedAt).not.toBeNull();
      expect(archived.permissions).toMatchObject({ canEdit: false, canArchive: true });
      await expectError(
        await action(meeting.id, 'archive', cast.gm.cookie),
        409,
        'MEETING_ARCHIVED',
      );
      await expectError(
        await patch(meeting.id, cast.gm.cookie, { title: 'x' }),
        409,
        'MEETING_ARCHIVED',
      );
      expect((await client.get(`/api/meetings/${meeting.id}`, cast.designer.cookie)).status).toBe(
        404,
      );
      expect((await patch(meeting.id, cast.designer.cookie, { title: 'x' })).status).toBe(404);
      const restored = await ok(await action(meeting.id, 'restore', cast.gm.cookie));
      expect(restored).toMatchObject({ status: 'scheduled', archivedAt: null });
      expect((await cast.auditOf(meeting.id)).slice(-2).map((entry) => entry.action)).toEqual([
        'meeting.archived',
        'meeting.restored',
      ]);
    });
  });

  describe('the organizer (changes to F01)', () => {
    it('cannot be archived while organizing a scheduled meeting in the future', async () => {
      const person = await cast.signedIn({ name: `منظم ${cast.run}` });
      const meeting = await createOk(person.cookie, { attendeeIds: [cast.designer.id] });
      const cancelled = await createOk(person.cookie);
      await ok(await action(cancelled.id, 'cancel', person.cookie));
      const archive = () => client.post(`/api/users/${person.id}/archive`, cast.gm.cookie);
      const body = (await expectError(
        await archive(),
        409,
        'USER_HAS_RESPONSIBILITIES',
      )) as ErrorResponse;
      expect(body.details).toEqual([
        { type: 'organizer_of_upcoming_meetings', id: meeting.id, name: meeting.title },
      ]);
      await ok(
        await patch(meeting.id, cast.gm.cookie, {
          organizerId: cast.employee.id,
          acceptConflicts: true,
        }),
      );
      expect((await archive()).status).toBe(200);
    });
  });
});
