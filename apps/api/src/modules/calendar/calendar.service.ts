import { Inject, Injectable } from '@nestjs/common';
import {
  addDays,
  businessInstant,
  type Calendar,
  type CalendarKind,
  type CalendarQuery,
  type ConflictList,
  type ConflictQuery,
  daysInclusive,
  KEY_DATE_KINDS,
  type KeyDate,
} from '@vertex-hub/contracts';
import { type Database, meetingAttendees, meetings, shootCrew, shoots } from '@vertex-hub/db';
import { and, asc, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { HolidayCalendar, LeaveDirectory } from '../hr/index.js';
import { InvoiceDueDates } from '../invoices/index.js';
import { EngagementDirectory } from '../projects/index.js';
import { MeetingsService } from './meetings.service.js';
import { ScheduleConflicts } from './schedule-conflicts.js';
import { ShootsService } from './shoots.service.js';

/** The company calendar's read model (spec F11 rule 15) and the live conflict check (rule 5). */
@Injectable()
export class CalendarService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly conflicts: ScheduleConflicts,
    private readonly shootsService: ShootsService,
    private readonly meetingsService: MeetingsService,
    private readonly engagements: EngagementDirectory,
    private readonly clients: ClientDirectory,
    private readonly invoiceDueDates: InvoiceDueDates,
    private readonly holidays: HolidayCalendar,
    private readonly leave: LeaveDirectory,
  ) {}

  /**
   * Rules 15 and 16: every non-archived shoot and meeting overlapping the Damascus days
   * `[from, to]`, cancelled ones included, and the key dates in the range. `shootType` narrows
   * the shoots only. Approved leave (F17 rule B16) follows the person filter; the client and shoot
   * type filters, which leave has none of, hide it.
   */
  async calendar(actor: CurrentUserInfo, query: CalendarQuery): Promise<Calendar> {
    const start = businessInstant(query.from, '00:00');
    const end = businessInstant(addDays(query.to, 1), '00:00');
    const wanted = (kind: CalendarKind) => !query.kinds || query.kinds.includes(kind);
    const userId = query.userId === 'me' ? actor.id : query.userId;
    const [shootRows, meetingRows, keyDates, leaves] = await Promise.all([
      wanted('shoot')
        ? this.db
            .select()
            .from(shoots)
            .where(
              and(
                isNull(shoots.archivedAt),
                lt(shoots.startsAt, end),
                gt(shoots.endsAt, start),
                query.clientId ? eq(shoots.clientId, query.clientId) : undefined,
                query.shootType ? eq(shoots.type, query.shootType) : undefined,
                userId
                  ? inArray(
                      shoots.id,
                      this.db
                        .select({ id: shootCrew.shootId })
                        .from(shootCrew)
                        .where(eq(shootCrew.userId, userId)),
                    )
                  : undefined,
              ),
            )
            .orderBy(asc(shoots.startsAt), asc(shoots.id))
        : [],
      wanted('meeting')
        ? this.db
            .select()
            .from(meetings)
            .where(
              and(
                isNull(meetings.archivedAt),
                lt(meetings.startsAt, end),
                gt(meetings.endsAt, start),
                query.clientId ? eq(meetings.clientId, query.clientId) : undefined,
                userId
                  ? or(
                      eq(meetings.organizerId, userId),
                      inArray(
                        meetings.id,
                        this.db
                          .select({ id: meetingAttendees.meetingId })
                          .from(meetingAttendees)
                          .where(eq(meetingAttendees.userId, userId)),
                      ),
                    )
                  : undefined,
              ),
            )
            .orderBy(asc(meetings.startsAt), asc(meetings.id))
        : [],
      this.keyDates(actor, query, wanted, userId),
      wanted('leave') && !query.clientId && !query.shootType
        ? this.leave.calendar(actor, { from: query.from, to: query.to, userId })
        : [],
    ]);
    const [shootItems, meetingItems, clients] = await Promise.all([
      this.shootsService.present(shootRows),
      this.meetingsService.present(meetingRows),
      this.clients.summaries(keyDates.flatMap((keyDate) => keyDate.clientId ?? [])),
    ]);
    return {
      from: query.from,
      to: query.to,
      shoots: shootItems,
      meetings: meetingItems,
      leaves,
      keyDates: keyDates.map(({ clientId, ...keyDate }) => ({
        ...keyDate,
        client: clientId
          ? {
              id: clientId,
              name: clients.get(clientId)?.name ?? '',
              imageId: clients.get(clientId)?.imageId ?? null,
              archived: clients.get(clientId)?.archived ?? false,
            }
          : null,
      })),
    };
  }

  /**
   * Rule 15's key dates by date: those of projects and retainers, the due dates of the open
   * invoices the actor may read (F13), and each day of a public holiday (F17 rule B16), which
   * reaches everyone whatever the client and person filters.
   */
  private async keyDates(
    actor: CurrentUserInfo,
    query: CalendarQuery,
    wanted: (kind: CalendarKind) => boolean,
    userId: string | undefined,
  ): Promise<(Omit<KeyDate, 'client'> & { clientId: string | null })[]> {
    const range = { from: query.from, to: query.to, clientId: query.clientId, userId };
    const [engagementDates, invoiceDates, holidays] = await Promise.all([
      this.engagements.keyDates({ ...range, kinds: KEY_DATE_KINDS.filter(wanted) }),
      wanted('invoice_due') ? this.invoiceDueDates.keyDates(actor, range) : [],
      wanted('holiday') ? this.holidays.overlapping(query.from, query.to) : [],
    ]);
    const holidayDates = holidays.flatMap((holiday) => {
      const first = holiday.startsOn < query.from ? query.from : holiday.startsOn;
      const last = holiday.endsOn > query.to ? query.to : holiday.endsOn;
      return Array.from({ length: daysInclusive(first, last) }, (_, day) => ({
        kind: 'holiday' as const,
        date: addDays(first, day),
        title: holiday.name,
        targetId: holiday.id,
        clientId: null,
        invoiceStatus: null,
      }));
    });
    return [
      ...engagementDates.map((keyDate) => ({ ...keyDate, invoiceStatus: null })),
      ...invoiceDates,
      ...holidayDates,
    ].sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.kind.localeCompare(b.kind) ||
        a.title.localeCompare(b.title, 'ar') ||
        a.targetId.localeCompare(b.targetId),
    );
  }

  /** Rule 5 for a booking being edited; the shoot or meeting itself never conflicts. */
  async conflictList(query: ConflictQuery): Promise<ConflictList> {
    const items = await this.conflicts.of({
      kind: query.excludeMeetingId ? 'meeting' : 'shoot',
      id: query.excludeMeetingId ?? query.excludeShootId ?? null,
      startsAt: new Date(query.startsAt),
      endsAt: new Date(query.endsAt),
      userIds: query.userIds,
    });
    return { items };
  }
}
