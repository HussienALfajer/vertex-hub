import { Inject, Injectable } from '@nestjs/common';
import {
  type CalendarItemKind,
  intervalsOverlap,
  type ScheduleConflict,
} from '@vertex-hub/contracts';
import {
  type Database,
  meetingAttendees,
  meetings,
  shootCrew,
  shoots,
  type Transaction,
} from '@vertex-hub/db';
import { and, eq, gt, inArray, isNull, lt } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { UserDirectory } from '../auth/index.js';

type Executor = Database | Transaction;

/** A shoot or meeting checked for conflicts: who is booked, and when. */
export interface Booking {
  kind: CalendarItemKind;
  /** Null for a booking not saved yet. */
  id: string | null;
  startsAt: Date;
  endsAt: Date;
  /** The team crew, or the organizer and the attendees. */
  userIds: readonly string[];
}

interface Booked {
  kind: CalendarItemKind;
  id: string;
  title: string;
  userId: string;
  startsAt: Date;
  endsAt: Date;
}

/** The key of a booking in the result of `ScheduleConflicts.find`. */
export const bookingKey = (booking: Pick<Booking, 'kind' | 'id'>) =>
  `${booking.kind}:${booking.id}`;

/**
 * Rule 5: a person is in conflict when another non-archived scheduled shoot where they are team
 * crew, or a scheduled meeting they organize or attend, overlaps `[starts_at, ends_at)`. Archived
 * users are never checked.
 */
@Injectable()
export class ScheduleConflicts {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
  ) {}

  /** The conflicts of each booking, by `kind:id`, by user name then start time. */
  async find(
    bookings: readonly Booking[],
    executor: Executor = this.db,
  ): Promise<Map<string, ScheduleConflict[]>> {
    const result = new Map<string, ScheduleConflict[]>();
    const people = await this.users.summaries(
      bookings.flatMap((booking) => [...booking.userIds]),
      executor,
    );
    const active = [...people.values()].filter((user) => !user.archived).map((user) => user.id);
    if (bookings.length === 0 || active.length === 0) return result;
    const from = new Date(Math.min(...bookings.map((booking) => booking.startsAt.getTime())));
    const to = new Date(Math.max(...bookings.map((booking) => booking.endsAt.getTime())));
    const booked = await this.booked(executor, active, from, to);
    for (const booking of bookings) {
      const conflicts = booking.userIds.flatMap((userId) =>
        booked
          .filter(
            (item) =>
              item.userId === userId &&
              bookingKey(item) !== bookingKey(booking) &&
              intervalsOverlap(item, booking),
          )
          .map(
            (item): ScheduleConflict => ({
              user: { id: userId, name: people.get(userId)?.name ?? '' },
              kind: item.kind,
              id: item.id,
              title: item.title,
              startsAt: item.startsAt.toISOString(),
              endsAt: item.endsAt.toISOString(),
            }),
          ),
      );
      conflicts.sort(
        (a, b) =>
          a.user.name.localeCompare(b.user.name, 'ar') ||
          a.user.id.localeCompare(b.user.id) ||
          a.startsAt.localeCompare(b.startsAt),
      );
      result.set(bookingKey(booking), conflicts);
    }
    return result;
  }

  /** The conflicts of one booking. */
  async of(booking: Booking, executor: Executor = this.db): Promise<ScheduleConflict[]> {
    return (await this.find([booking], executor)).get(bookingKey(booking)) ?? [];
  }

  /**
   * Rule 5: `409 SCHEDULE_CONFLICT` with the conflicts unless the request accepts them; returns
   * the accepted ones for the audit entry.
   */
  async check(
    executor: Executor,
    booking: Booking,
    acceptConflicts: boolean,
  ): Promise<ScheduleConflict[]> {
    const conflicts = await this.of(booking, executor);
    if (conflicts.length > 0 && !acceptConflicts) {
      throw new CodedException(
        409,
        'SCHEDULE_CONFLICT',
        'Some people are booked at an overlapping time',
        conflicts,
      );
    }
    return conflicts;
  }

  /** The scheduled shoots and meetings of the users overlapping `[from, to)`. */
  private async booked(executor: Executor, userIds: string[], from: Date, to: Date) {
    const overlapping = <T extends typeof shoots | typeof meetings>(table: T) =>
      and(
        eq(table.status, 'scheduled'),
        isNull(table.archivedAt),
        lt(table.startsAt, to),
        gt(table.endsAt, from),
      );
    const meetingColumns = {
      id: meetings.id,
      title: meetings.title,
      startsAt: meetings.startsAt,
      endsAt: meetings.endsAt,
    };
    const [crew, organized, attended] = await Promise.all([
      executor
        .select({
          id: shoots.id,
          title: shoots.title,
          startsAt: shoots.startsAt,
          endsAt: shoots.endsAt,
          userId: shootCrew.userId,
        })
        .from(shootCrew)
        .innerJoin(shoots, eq(shoots.id, shootCrew.shootId))
        .where(and(inArray(shootCrew.userId, userIds), overlapping(shoots))),
      executor
        .select({ ...meetingColumns, userId: meetings.organizerId })
        .from(meetings)
        .where(and(inArray(meetings.organizerId, userIds), overlapping(meetings))),
      executor
        .select({ ...meetingColumns, userId: meetingAttendees.userId })
        .from(meetingAttendees)
        .innerJoin(meetings, eq(meetings.id, meetingAttendees.meetingId))
        .where(and(inArray(meetingAttendees.userId, userIds), overlapping(meetings))),
    ]);
    return [
      ...crew.map((row): Booked => ({ ...row, kind: 'shoot' })),
      ...[...organized, ...attended].map((row): Booked => ({ ...row, kind: 'meeting' })),
    ];
  }
}
