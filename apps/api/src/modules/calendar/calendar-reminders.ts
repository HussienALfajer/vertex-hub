import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  addDays,
  businessInstant,
  type CalendarDate,
  calendarDay,
  isWorkDay,
  nextWorkDay,
} from '@vertex-hub/contracts';
import { type Database, meetings, shoots, type Transaction } from '@vertex-hub/db';
import { and, asc, eq, gte, isNull, lt, type SQL } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { runEach } from '../../core/jobs/index.js';
import { UserDirectory } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { DailyReminders } from '../notifications/index.js';
import { MeetingNotices } from './meeting-notices.js';
import { MeetingsService, noticeMeeting } from './meetings.service.js';
import { crewOf } from './shoot-access.js';
import { ShootNotices } from './shoot-notices.js';
import { noticeShoot } from './shoots.service.js';

/**
 * The calendar's sources of the `notifications.daily` job (spec F11, "Jobs"): shoots and meetings
 * coming up, on the last work day before their day, and shoots still scheduled after their end
 * day. Each is sent once per item and day; an item moved to a new day starts again. Archived
 * users are left out. Shoots and meetings are sources of their own, so a failing reminder of one
 * kind does not hold back the other.
 */
@Injectable()
export class CalendarReminders implements OnModuleInit {
  private readonly logger = new Logger(CalendarReminders.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
    private readonly meetingsService: MeetingsService,
    private readonly shootNotices: ShootNotices,
    private readonly meetingNotices: MeetingNotices,
    private readonly reminders: DailyReminders,
  ) {}

  onModuleInit(): void {
    this.reminders.register('shoots-upcoming', (today) => this.upcomingShoots(today));
    this.reminders.register('meetings-upcoming', (today) => this.upcomingMeetings(today));
    this.reminders.register('shoots-not-closed', (today) => this.notClosed(today));
  }

  /**
   * Scheduled shoots whose day is after `today` and on or before the next work day: `today` is
   * the last work day before them (Thursday covers Friday and Saturday).
   */
  async upcomingShoots(today: CalendarDate): Promise<number> {
    if (!isWorkDay(today)) return 0;
    const { from, to } = upcomingWindow(today);
    return this.remindShoots(
      today,
      'upcoming',
      and(gte(shoots.startsAt, from), lt(shoots.startsAt, to)) as SQL,
    );
  }

  /** Scheduled meetings in the same window, to the organizer and the attendees. */
  async upcomingMeetings(today: CalendarDate): Promise<number> {
    if (!isWorkDay(today)) return 0;
    const { from, to } = upcomingWindow(today);
    const live = and(
      eq(meetings.status, 'scheduled'),
      isNull(meetings.archivedAt),
      gte(meetings.startsAt, from),
      lt(meetings.startsAt, to),
    );
    const candidates = await this.db
      .select({ id: meetings.id })
      .from(meetings)
      .where(live)
      .orderBy(asc(meetings.id));
    let sent = 0;
    await runEach(
      candidates,
      this.logger,
      ({ id }) => `Meeting upcoming reminder ${id}`,
      async ({ id }) => {
        // Read again under the meeting lock, so an edit since the candidates were read counts.
        const recorded = await this.db.transaction(async (tx) => {
          const [meeting] = await tx
            .select()
            .from(meetings)
            .where(and(eq(meetings.id, id), live))
            .for('update');
          if (!meeting) return false;
          const attendeeIds = (await this.meetingsService.attendeesOf(tx, [id])).get(id) ?? [];
          const recipients = await this.active(tx, [meeting.organizerId, ...attendeeIds]);
          if (recipients.length === 0) return false;
          const client = meeting.clientId ? await this.clients.summary(meeting.clientId, tx) : null;
          return this.reminders.remindOnce(
            tx,
            {
              kind: 'meeting_upcoming',
              subjectId: id,
              occurrence: calendarDay(meeting.startsAt),
            },
            today,
            this.meetingNotices.notice(
              noticeMeeting(meeting, client),
              'meeting_upcoming',
              recipients,
              null,
            ),
          );
        });
        if (recorded) sent += 1;
      },
    );
    return sent;
  }

  /**
   * Shoots still scheduled whose end day is before `today`, to the lead and the booker: sent on
   * the first work day after the end day, once per end day.
   */
  async notClosed(today: CalendarDate): Promise<number> {
    if (!isWorkDay(today)) return 0;
    return this.remindShoots(
      today,
      'not_closed',
      lt(shoots.endsAt, businessInstant(today, '00:00')),
    );
  }

  /** One transaction per reminder: the shoot is locked and checked again inside it. */
  private async remindShoots(
    today: CalendarDate,
    reminder: 'upcoming' | 'not_closed',
    filter: SQL,
  ): Promise<number> {
    const live = and(eq(shoots.status, 'scheduled'), isNull(shoots.archivedAt), filter);
    const candidates = await this.db
      .select({ id: shoots.id })
      .from(shoots)
      .where(live)
      .orderBy(asc(shoots.id));
    let sent = 0;
    await runEach(
      candidates,
      this.logger,
      ({ id }) => `Shoot ${reminder} reminder ${id}`,
      async ({ id }) => {
        const recorded = await this.db.transaction(async (tx) => {
          const [shoot] = await tx
            .select()
            .from(shoots)
            .where(and(eq(shoots.id, id), live))
            .for('update');
          if (!shoot) return false;
          const crew = (await crewOf(tx, [id])).get(id) ?? [];
          const lead = crew.find((member) => member.isLead);
          const recipients = await this.active(
            tx,
            reminder === 'upcoming'
              ? crew.map((member) => member.userId)
              : [...(lead ? [lead.userId] : []), shoot.createdById],
          );
          if (recipients.length === 0) return false;
          const client = shoot.clientId ? await this.clients.summary(shoot.clientId, tx) : null;
          const type = reminder === 'upcoming' ? 'shoot_upcoming' : 'shoot_not_closed';
          return this.reminders.remindOnce(
            tx,
            {
              kind: type,
              subjectId: id,
              occurrence: calendarDay(reminder === 'upcoming' ? shoot.startsAt : shoot.endsAt),
            },
            today,
            this.shootNotices.notice(noticeShoot(shoot, client), type, recipients, null),
          );
        });
        if (recorded) sent += 1;
      },
    );
    return sent;
  }

  /** The non-archived users among `userIds`, once each. */
  private async active(tx: Transaction, userIds: string[]): Promise<string[]> {
    const people = await this.users.summaries(userIds, tx);
    return [...new Set(userIds)].filter((userId) => people.get(userId)?.archived === false);
  }
}

/** The instants of the days after `today` up to and including the next work day. */
const upcomingWindow = (today: CalendarDate) => ({
  from: businessInstant(addDays(today, 1), '00:00'),
  to: businessInstant(addDays(nextWorkDay(today), 1), '00:00'),
});
