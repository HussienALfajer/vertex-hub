import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  type CancelMeeting,
  type CreateMeeting,
  type Meeting,
  type MeetingDetail,
  permissionScopes,
  type UpdateMeeting,
} from '@vertex-hub/contracts';
import {
  type Database,
  meetingAttendees,
  meetingContacts,
  meetings,
  type Transaction,
} from '@vertex-hub/db';
import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { changedFields, recordAudit } from '../audit/index.js';
import {
  type CurrentUserInfo,
  lockAccessChanges,
  ResponsibilityRegistry,
  UserDirectory,
} from '../auth/index.js';
import { ClientDirectory, type ClientSummary } from '../clients/index.js';
import type { Notice } from '../notifications/index.js';
import { MeetingNotices, type NoticeMeeting } from './meeting-notices.js';
import { bookingKey, ScheduleConflicts } from './schedule-conflicts.js';
import { actorOf, coversClient, holdsAll } from './shoot-access.js';

type Executor = Database | Transaction;

export type MeetingRow = typeof meetings.$inferSelect;

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** The organizer first, then the attendees. */
const peopleOf = (organizerId: string, attendeeIds: readonly string[]) => [
  organizerId,
  ...attendeeIds,
];

/**
 * Meeting scope ("Scopes"): `all`, `own_clients` on the meeting's client, or `assigned` for its
 * organizer.
 */
const coversMeeting = (
  actor: CurrentUserInfo,
  meeting: Pick<MeetingRow, 'organizerId'>,
  client: ClientSummary | null,
) =>
  coversClient(actor, 'meetings.manage', client) ||
  (permissionScopes(actor.access, 'meetings.manage').includes('assigned') &&
    meeting.organizerId === actor.id);

/** Meetings (spec F11 rule 14): detail, create, edits, cancel, archive and restore. */
@Injectable()
export class MeetingsService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
    private readonly conflicts: ScheduleConflicts,
    private readonly notices: MeetingNotices,
    private readonly responsibilities: ResponsibilityRegistry,
  ) {}

  /** A user cannot be archived while they organize a scheduled meeting that starts in the future. */
  onModuleInit(): void {
    this.responsibilities.register({
      find: async (tx, userId) =>
        (
          await tx
            .select({ id: meetings.id, name: meetings.title })
            .from(meetings)
            .where(
              and(
                eq(meetings.organizerId, userId),
                eq(meetings.status, 'scheduled'),
                isNull(meetings.archivedAt),
                gt(meetings.startsAt, new Date()),
              ),
            )
            .orderBy(asc(meetings.startsAt), asc(meetings.id))
        ).map((meeting) => ({ type: 'organizer_of_upcoming_meetings' as const, ...meeting })),
    });
  }

  /** Meetings as the calendar shows them, in the order given. */
  async present(rows: readonly MeetingRow[], executor: Executor = this.db): Promise<Meeting[]> {
    const [attendees, clients, people] = await Promise.all([
      this.attendeesOf(
        executor,
        rows.map((row) => row.id),
      ),
      this.clients.summaries(
        rows.flatMap((row) => (row.clientId ? [row.clientId] : [])),
        executor,
      ),
      this.users.summaries(
        rows.map((row) => row.organizerId),
        executor,
      ),
    ]);
    const conflicts = await this.conflicts.find(
      rows
        .filter((row) => row.status === 'scheduled' && !row.archivedAt)
        .map((row) => ({
          kind: 'meeting' as const,
          id: row.id,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          userIds: peopleOf(row.organizerId, attendees.get(row.id) ?? []),
        })),
      executor,
    );
    return rows.map((row) => {
      const client = row.clientId ? clients.get(row.clientId) : undefined;
      const organizer = people.get(row.organizerId);
      return {
        id: row.id,
        title: row.title,
        status: row.status,
        client: client ? { id: client.id, name: client.name, archived: client.archived } : null,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        location: row.location,
        onlineUrl: row.onlineUrl,
        organizer: {
          id: row.organizerId,
          name: organizer?.name ?? '',
          archived: organizer?.archived ?? false,
        },
        attendeeCount: (attendees.get(row.id) ?? []).length,
        conflict: (conflicts.get(bookingKey({ kind: 'meeting', id: row.id }))?.length ?? 0) > 0,
        archivedAt: row.archivedAt?.toISOString() ?? null,
      };
    });
  }

  async detail(actor: CurrentUserInfo, id: string): Promise<MeetingDetail> {
    const meeting = await this.readable(this.db, actor, id);
    const [[item], attendees, contactIds, client] = await Promise.all([
      this.present([meeting]),
      this.attendeesOf(this.db, [id]),
      this.contactsOf(this.db, id),
      meeting.clientId ? this.clients.summary(meeting.clientId) : null,
    ]);
    if (!item) throw new NotFoundException();
    const attendeeIds = attendees.get(id) ?? [];
    const [people, contacts] = await Promise.all([
      this.users.summaries([...attendeeIds, meeting.createdById]),
      this.clients.contacts(contactIds),
    ]);
    const live = meeting.status === 'scheduled' && !meeting.archivedAt;
    const scope = coversMeeting(actor, meeting, client);
    return {
      ...item,
      agenda: meeting.agenda,
      attendees: attendeeIds.map((userId) => ({
        id: userId,
        name: people.get(userId)?.name ?? '',
        archived: people.get(userId)?.archived ?? false,
      })),
      contacts: contactIds.flatMap((contactId) => {
        const contact = contacts.get(contactId);
        return contact
          ? [
              {
                id: contact.id,
                name: contact.name,
                phone: contact.phone,
                archived: contact.archived,
              },
            ]
          : [];
      }),
      conflicts: live
        ? await this.conflicts.of({
            kind: 'meeting',
            id,
            startsAt: meeting.startsAt,
            endsAt: meeting.endsAt,
            userIds: peopleOf(meeting.organizerId, attendeeIds),
          })
        : [],
      cancelledAt: meeting.cancelledAt?.toISOString() ?? null,
      cancelReason: meeting.cancelReason,
      createdBy: { id: meeting.createdById, name: people.get(meeting.createdById)?.name ?? '' },
      createdAt: meeting.createdAt.toISOString(),
      updatedAt: meeting.updatedAt.toISOString(),
      permissions: {
        canEdit: live && scope,
        canCancel: live && scope,
        canArchive: holdsAll(actor, 'meetings.manage'),
      },
    };
  }

  /** Rule 14: any active user creates a meeting and becomes its organizer. */
  async create(actor: CurrentUserInfo, input: CreateMeeting): Promise<MeetingDetail> {
    const id = await this.db.transaction(async (tx) => {
      // Serialized with archiving users: the attendees must stay active (F01 change).
      await lockAccessChanges(tx);
      const client = input.clientId ? await this.clients.summary(input.clientId, tx) : null;
      if (input.clientId && !client) throw new NotFoundException();
      if (client?.archived) {
        throw new CodedException(409, 'CLIENT_ARCHIVED', 'The client is archived');
      }
      await this.assertAttendees(tx, actor.id, input.attendeeIds, []);
      await this.assertContacts(tx, client, input.contactIds, []);
      const startsAt = new Date(input.startsAt);
      const endsAt = new Date(input.endsAt);
      const accepted = await this.conflicts.check(
        tx,
        {
          kind: 'meeting',
          id: null,
          startsAt,
          endsAt,
          userIds: peopleOf(actor.id, input.attendeeIds),
        },
        input.acceptConflicts,
      );
      const values = {
        title: input.title,
        clientId: client?.id ?? null,
        startsAt,
        endsAt,
        location: input.location,
        onlineUrl: input.onlineUrl,
        agenda: input.agenda,
        organizerId: actor.id,
      };
      const [created] = await tx
        .insert(meetings)
        .values({ ...values, createdById: actor.id })
        .returning();
      if (!created) throw new Error('Meeting insert returned no row');
      await this.replaceLinks(tx, created.id, {
        attendees: { before: [], after: input.attendeeIds },
        contacts: { before: [], after: input.contactIds },
      });
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'meeting.created',
        entityType: 'meeting',
        entityId: created.id,
        after: {
          ...values,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          attendeeIds: input.attendeeIds,
          contactIds: input.contactIds,
          ...(accepted.length > 0 && { acceptedConflicts: accepted }),
        },
      });
      await this.notices.send(tx, [
        this.notices.notice(
          noticeMeeting(created, client),
          'meeting_invited',
          input.attendeeIds,
          actor.id,
        ),
      ]);
      return created.id;
    });
    return this.detail(actor, id);
  }

  /** Rule 14: meeting scope edits a scheduled meeting, its organizer, attendees and contacts. */
  async update(actor: CurrentUserInfo, id: string, input: UpdateMeeting): Promise<MeetingDetail> {
    await this.db.transaction(async (tx) => {
      if (input.attendeeIds || input.organizerId) await lockAccessChanges(tx);
      const meeting = await this.readable(tx, actor, id, { forUpdate: true });
      const clientBefore = meeting.clientId
        ? await this.clients.summary(meeting.clientId, tx)
        : null;
      assertMeetingScope(actor, meeting, clientBefore);
      assertScheduled(meeting);

      const clientChange = input.clientId !== undefined && input.clientId !== meeting.clientId;
      let client = clientBefore;
      if (clientChange) {
        client = input.clientId ? await this.clients.summary(input.clientId, tx) : null;
        if (input.clientId && !client) throw new NotFoundException();
        if (client?.archived) {
          throw new CodedException(409, 'CLIENT_ARCHIVED', 'The client is archived');
        }
      }
      const organizerId = input.organizerId ?? meeting.organizerId;
      const organizerChange = organizerId !== meeting.organizerId;
      if (organizerChange && !(await this.users.activeUser(organizerId, tx))) {
        throw new CodedException(400, 'INVALID_ATTENDEE', 'The organizer is archived or unknown');
      }
      const attendeesBefore = (await this.attendeesOf(tx, [id])).get(id) ?? [];
      const attendeesAfter = input.attendeeIds ?? attendeesBefore;
      const attendeeChange = !sameIds(attendeesBefore, attendeesAfter);
      if (attendeeChange || organizerChange) {
        await this.assertAttendees(tx, organizerId, attendeesAfter, attendeesBefore);
      }
      const contactsBefore = await this.contactsOf(tx, id);
      const contactsAfter = input.contactIds ?? contactsBefore;
      const contactChange = !sameIds(contactsBefore, contactsAfter);
      if (contactChange || clientChange) {
        // A new client keeps none of the old client's contacts.
        await this.assertContacts(tx, client, contactsAfter, clientChange ? [] : contactsBefore);
      }
      const startsAt = input.startsAt ? new Date(input.startsAt) : meeting.startsAt;
      const endsAt = input.endsAt ? new Date(input.endsAt) : meeting.endsAt;
      const timeChange =
        startsAt.getTime() !== meeting.startsAt.getTime() ||
        endsAt.getTime() !== meeting.endsAt.getTime();

      const fields = changedFields(
        {
          title: meeting.title,
          clientId: meeting.clientId,
          startsAt: meeting.startsAt.toISOString(),
          endsAt: meeting.endsAt.toISOString(),
          location: meeting.location,
          onlineUrl: meeting.onlineUrl,
          agenda: meeting.agenda,
          organizerId: meeting.organizerId,
        },
        {
          title: input.title,
          clientId: input.clientId,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          location: input.location,
          onlineUrl: input.onlineUrl,
          agenda: input.agenda,
          organizerId: input.organizerId,
        },
      );
      if (!fields && !attendeeChange && !contactChange) return;
      const accepted =
        timeChange || attendeeChange || organizerChange
          ? await this.conflicts.check(
              tx,
              {
                kind: 'meeting',
                id,
                startsAt,
                endsAt,
                userIds: peopleOf(organizerId, attendeesAfter),
              },
              input.acceptConflicts,
            )
          : [];

      await tx
        .update(meetings)
        .set(fields ? { ...fields.after, startsAt, endsAt } : { updatedAt: new Date() })
        .where(eq(meetings.id, id));
      await this.replaceLinks(tx, id, {
        attendees: { before: attendeesBefore, after: attendeesAfter },
        contacts: { before: contactsBefore, after: contactsAfter },
      });
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'meeting.updated',
        entityType: 'meeting',
        entityId: id,
        before: {
          ...fields?.before,
          ...(attendeeChange && { attendeeIds: attendeesBefore }),
          ...(contactChange && { contactIds: contactsBefore }),
        },
        after: {
          ...fields?.after,
          ...(attendeeChange && { attendeeIds: attendeesAfter }),
          ...(contactChange && { contactIds: contactsAfter }),
          ...(accepted.length > 0 && { acceptedConflicts: accepted }),
        },
      });

      // Who hears: added people and a new organizer are invited, removed ones dropped, the rest
      // told what changed.
      const before = new Set(peopleOf(meeting.organizerId, attendeesBefore));
      const after = new Set(peopleOf(organizerId, attendeesAfter));
      const changes = [
        ...(timeChange ? (['time'] as const) : []),
        ...(input.location !== undefined && input.location !== meeting.location
          ? (['place'] as const)
          : []),
        ...(input.onlineUrl !== undefined && input.onlineUrl !== meeting.onlineUrl
          ? (['link'] as const)
          : []),
      ];
      const updated = noticeMeeting({ ...meeting, ...fields?.after, startsAt, endsAt }, client);
      const notices: Notice[] = [
        this.notices.notice(
          updated,
          'meeting_invited',
          [
            ...[...after].filter((userId) => !before.has(userId)),
            ...(organizerChange ? [organizerId] : []),
          ],
          actor.id,
        ),
        this.notices.notice(
          updated,
          'meeting_dropped',
          [...before].filter((userId) => !after.has(userId)),
          actor.id,
          { cause: 'removed' },
        ),
      ];
      if (changes.length > 0) {
        notices.push(
          this.notices.notice(
            updated,
            'meeting_changed',
            [...after].filter((userId) => before.has(userId)),
            actor.id,
            { changes },
          ),
        );
      }
      await this.notices.send(tx, notices);
    });
    return this.detail(actor, id);
  }

  /** Cancelled is final: a new meeting is created to rebook. */
  async cancel(actor: CurrentUserInfo, id: string, input: CancelMeeting): Promise<MeetingDetail> {
    await this.db.transaction(async (tx) => {
      const meeting = await this.readable(tx, actor, id, { forUpdate: true });
      const client = meeting.clientId ? await this.clients.summary(meeting.clientId, tx) : null;
      assertMeetingScope(actor, meeting, client);
      assertScheduled(meeting);
      await tx
        .update(meetings)
        .set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: input.reason })
        .where(eq(meetings.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'meeting.cancelled',
        entityType: 'meeting',
        entityId: id,
        before: { status: 'scheduled' },
        after: { status: 'cancelled', cancelReason: input.reason },
      });
      const attendeeIds = (await this.attendeesOf(tx, [id])).get(id) ?? [];
      await this.notices.send(tx, [
        this.notices.notice(
          noticeMeeting(meeting, client),
          'meeting_dropped',
          peopleOf(meeting.organizerId, attendeeIds),
          actor.id,
          { cause: 'cancelled' },
        ),
      ]);
    });
    return this.detail(actor, id);
  }

  async archive(actor: CurrentUserInfo, id: string): Promise<MeetingDetail> {
    if (!holdsAll(actor, 'meetings.manage')) throw new ForbiddenException();
    await this.db.transaction(async (tx) => {
      const meeting = await this.readable(tx, actor, id, { forUpdate: true });
      if (meeting.archivedAt) {
        throw new CodedException(409, 'MEETING_ARCHIVED', 'The meeting is already archived');
      }
      await tx.update(meetings).set({ archivedAt: new Date() }).where(eq(meetings.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'meeting.archived',
        entityType: 'meeting',
        entityId: id,
        before: { archived: false },
        after: { archived: true },
      });
    });
    return this.detail(actor, id);
  }

  async restore(actor: CurrentUserInfo, id: string): Promise<MeetingDetail> {
    if (!holdsAll(actor, 'meetings.manage')) throw new ForbiddenException();
    await this.db.transaction(async (tx) => {
      const meeting = await this.readable(tx, actor, id, { forUpdate: true });
      if (!meeting.archivedAt) {
        throw new CodedException(409, 'MEETING_NOT_ARCHIVED', 'The meeting is not archived');
      }
      await tx.update(meetings).set({ archivedAt: null }).where(eq(meetings.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'meeting.restored',
        entityType: 'meeting',
        entityId: id,
        before: { archived: true },
        after: { archived: false },
      });
    });
    return this.detail(actor, id);
  }

  /** The attendees of each meeting, by when they were added; the organizer is not listed. */
  async attendeesOf(
    executor: Executor,
    meetingIds: readonly string[],
  ): Promise<Map<string, string[]>> {
    const byMeeting = new Map<string, string[]>();
    if (meetingIds.length === 0) return byMeeting;
    const rows = await executor
      .select({ meetingId: meetingAttendees.meetingId, userId: meetingAttendees.userId })
      .from(meetingAttendees)
      .where(inArray(meetingAttendees.meetingId, [...new Set(meetingIds)]))
      .orderBy(asc(meetingAttendees.createdAt), asc(meetingAttendees.userId));
    for (const row of rows) {
      byMeeting.set(row.meetingId, [...(byMeeting.get(row.meetingId) ?? []), row.userId]);
    }
    return byMeeting;
  }

  /**
   * Loads a meeting, else 404. An archived meeting is visible to scope-all holders of
   * `meetings.manage` only. `forUpdate` locks the row: the lock every change takes first.
   */
  private async readable(
    executor: Executor,
    actor: CurrentUserInfo,
    id: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<MeetingRow> {
    const query = executor.select().from(meetings).where(eq(meetings.id, id));
    const [row] = options.forUpdate ? await query.for('update') : await query;
    if (!row || (row.archivedAt && !holdsAll(actor, 'meetings.manage'))) {
      throw new NotFoundException();
    }
    return row;
  }

  private async contactsOf(executor: Executor, meetingId: string): Promise<string[]> {
    const rows = await executor
      .select({ contactId: meetingContacts.contactId })
      .from(meetingContacts)
      .where(eq(meetingContacts.meetingId, meetingId))
      .orderBy(asc(meetingContacts.createdAt), asc(meetingContacts.contactId));
    return rows.map((row) => row.contactId);
  }

  /**
   * The organizer attends implicitly and is never listed; people added are non-archived users
   * (`INVALID_ATTENDEE`); attendees already listed may stay after being archived.
   */
  private async assertAttendees(
    tx: Transaction,
    organizerId: string,
    attendeeIds: readonly string[],
    current: readonly string[],
  ): Promise<void> {
    const added = attendeeIds.filter((userId) => !current.includes(userId));
    const people = await this.users.summaries(added, tx);
    if (
      attendeeIds.includes(organizerId) ||
      added.some((userId) => !people.get(userId) || people.get(userId)?.archived)
    ) {
      throw new CodedException(
        400,
        'INVALID_ATTENDEE',
        'An attendee is archived, unknown or the organizer',
      );
    }
  }

  /**
   * Every contact belongs to the meeting's client (`UNKNOWN_CONTACT`); contacts added are not
   * archived, contacts already listed may stay after being archived.
   */
  private async assertContacts(
    tx: Transaction,
    client: ClientSummary | null,
    contactIds: readonly string[],
    current: readonly string[],
  ): Promise<void> {
    const contacts = await this.clients.contacts([...contactIds], tx);
    const known = (contactId: string) => {
      const contact = contacts.get(contactId);
      return (
        !!contact &&
        contact.clientId === client?.id &&
        (!contact.archived || current.includes(contactId))
      );
    };
    if (!contactIds.every(known)) {
      throw new CodedException(
        400,
        'UNKNOWN_CONTACT',
        "A contact is not one of the meeting's client",
      );
    }
  }

  /** Removes and adds attendee and contact rows. */
  private async replaceLinks(
    tx: Transaction,
    meetingId: string,
    links: Record<
      'attendees' | 'contacts',
      { before: readonly string[]; after: readonly string[] }
    >,
  ): Promise<void> {
    const diff = ({ before, after }: (typeof links)['attendees']) => ({
      removed: before.filter((id) => !after.includes(id)),
      added: after.filter((id) => !before.includes(id)),
    });
    const attendees = diff(links.attendees);
    const contacts = diff(links.contacts);
    if (attendees.removed.length > 0) {
      await tx
        .delete(meetingAttendees)
        .where(
          and(
            eq(meetingAttendees.meetingId, meetingId),
            inArray(meetingAttendees.userId, attendees.removed),
          ),
        );
    }
    if (attendees.added.length > 0) {
      await tx
        .insert(meetingAttendees)
        .values(attendees.added.map((userId) => ({ meetingId, userId })));
    }
    if (contacts.removed.length > 0) {
      await tx
        .delete(meetingContacts)
        .where(
          and(
            eq(meetingContacts.meetingId, meetingId),
            inArray(meetingContacts.contactId, contacts.removed),
          ),
        );
    }
    if (contacts.added.length > 0) {
      await tx
        .insert(meetingContacts)
        .values(contacts.added.map((contactId) => ({ meetingId, contactId })));
    }
  }
}

/** 403 unless `meetings.manage` covers the meeting (meeting scope). */
function assertMeetingScope(
  actor: CurrentUserInfo,
  meeting: MeetingRow,
  client: ClientSummary | null,
): void {
  if (!coversMeeting(actor, meeting, client)) throw new ForbiddenException();
}

/** Rule 14: changes only while scheduled and not archived. */
function assertScheduled(meeting: MeetingRow): void {
  if (meeting.archivedAt) {
    throw new CodedException(409, 'MEETING_ARCHIVED', 'The meeting is archived');
  }
  if (meeting.status !== 'scheduled') {
    throw new CodedException(409, 'MEETING_NOT_SCHEDULED', 'The meeting is no longer scheduled');
  }
}

/** The notice snapshot of a meeting. */
export const noticeMeeting = (
  meeting: Pick<MeetingRow, 'id' | 'title' | 'startsAt' | 'endsAt'>,
  client: ClientSummary | null,
): NoticeMeeting => ({
  id: meeting.id,
  title: meeting.title,
  startsAt: meeting.startsAt,
  endsAt: meeting.endsAt,
  client: client?.name ?? null,
});
