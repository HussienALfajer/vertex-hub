import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type AttendanceMonth,
  type AttendanceMonthTotals,
  addDays,
  businessDate,
  businessInstant,
  type CalendarDate,
  calendarMonthSchema,
  leaveUnits,
  leaveUnitsPay,
  type MonthPending,
  type MonthSheet,
  type MonthSheetQuery,
  type MonthSheetRow,
  monthEnded,
  monthRange,
  monthTotals,
  punchDates,
  type ReopenMonth,
  type TotalsLeave,
} from '@vertex-hub/contracts';
import {
  attendanceDays,
  attendanceItems,
  attendanceMonthSummaries,
  attendanceMonths,
  attendancePunches,
  type Database,
  employeeFiles,
  hrRequests,
  type Transaction,
} from '@vertex-hub/db';
import { and, asc, eq, gte, inArray, isNull, lt, lte, ne, notInArray } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { NotificationCenter } from '../notifications/index.js';
import { AttendanceDays, type DayRow } from './attendance-days.js';
import { holdsAll } from './employee-access.js';
import { lockHolidays } from './holidays.service.js';
import { HrScope } from './hr-scope.js';
import { LeaveContext } from './leave-context.js';
import { lockLeave } from './leave-ledger.js';

type Executor = Database | Transaction;

type MonthRow = typeof attendanceMonths.$inferSelect;

type ItemRow = {
  id: string;
  userId: string;
  date: CalendarDate;
  kind: (typeof attendanceItems.$inferSelect)['kind'];
  status: (typeof attendanceItems.$inferSelect)['status'];
  decidedFraction: number | null;
  decidedMinutes: number | null;
};

/** What an employee's month is made of, read in one pass for the sheet and the closing. */
interface MonthData {
  days: Map<string, DayRow[]>;
  /** `userId:date` of the days with a live field or shoot punch. */
  fieldDays: Set<string>;
  leaves: Map<string, TotalsLeave[]>;
  items: Map<string, ItemRow[]>;
  pendingRequests: { id: string; userId: string; startsOn: CalendarDate }[];
}

const dayStart = (date: CalendarDate) => businessInstant(date, '00:00');

const notEnded = () =>
  new CodedException(409, 'MONTH_NOT_ENDED', 'A month is closed once its last day has passed');

/**
 * F17 part D (rules D1–D4): the month sheet of the employees `hr.read` covers, closing a month
 * with the summaries F19 reads, and reopening it. Closing holds the holiday lock and every
 * employee's HR lock, so the `MONTH_CLOSED` checks made under them (`closed-months.ts`) never
 * race it.
 */
@Injectable()
export class AttendanceMonthsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly scope: HrScope,
    private readonly days: AttendanceDays,
    private readonly context: LeaveContext,
    private readonly center: NotificationCenter,
  ) {}

  /**
   * `GET /months/:month` (rule D1): employees with a day in the month, in `hr.read` scope; all of
   * them for `salaries.read` (Finance reads the month it is told is closed, rule D3; owner,
   * 2026-10-22).
   */
  async sheet(actor: CurrentUserInfo, month: string, query: MonthSheetQuery): Promise<MonthSheet> {
    checkMonth(month);
    const reach = holdsAll(actor, 'salaries.read')
      ? ({ all: true } as const)
      : await this.scope.reach(actor);
    if (!reach) throw new ForbiddenException();
    const { from, to } = monthRange(month);
    const withDays = await this.days.usersWithDays(this.db, from, to);
    const profiles = (
      await this.users.profiles({ ids: withDays, departmentId: query.departmentId })
    ).filter((profile) => reach.all || reach.userIds.has(profile.id));
    const row = await this.monthRow(this.db, month);
    const data = await this.collect(
      this.db,
      month,
      profiles.map((profile) => profile.id),
    );
    const frozen = new Map<string, AttendanceMonthTotals>();
    if (row?.status === 'closed') {
      const summaries = await this.db
        .select()
        .from(attendanceMonthSummaries)
        .where(
          and(
            eq(attendanceMonthSummaries.monthId, row.id),
            isNull(attendanceMonthSummaries.archivedAt),
          ),
        );
      for (const summary of summaries) frozen.set(summary.userId, totalsOf(summary));
    }
    const rows: MonthSheetRow[] = profiles.flatMap((profile) => {
      const days = data.days.get(profile.id) ?? [];
      if (days.length === 0) return [];
      const items = data.items.get(profile.id) ?? [];
      const pendingOf = (date: CalendarDate) =>
        items.filter((item) => item.date === date && item.status === 'pending').length;
      return [
        {
          user: { id: profile.id, name: profile.name },
          days: days.map((day) => ({
            date: day.date,
            kind: day.kind,
            status: day.status,
            place: day.place,
            leave: day.leave,
            workedMinutes: day.workedMinutes,
            lateMinutes: day.lateMinutes,
            earlyMinutes: day.earlyMinutes,
            overtimeMinutes: day.overtimeMinutes,
            field: data.fieldDays.has(`${profile.id}:${day.date}`),
            pendingItems: pendingOf(day.date),
          })),
          totals: frozen.get(profile.id) ?? this.totals(data, profile.id),
          pendingRequests: data.pendingRequests.filter((request) => request.userId === profile.id)
            .length,
          pendingItems: items.filter((item) => item.status === 'pending').length,
        },
      ];
    });
    return { month: await this.present(this.db, month, row), from, to, rows };
  }

  /**
   * `POST /months/:month/close` (rules D2 and D3): the month's days are finalized once more, then
   * it closes if nothing in it waits for a decision, with a summary per employee who has a day in
   * it, and Finance is told. Closing a closed month changes nothing.
   */
  async close(actor: CurrentUserInfo, month: string, now = new Date()): Promise<AttendanceMonth> {
    checkMonth(month);
    if (!monthEnded(month, businessDate(now))) throw notEnded();
    const { from, to } = monthRange(month);
    // The recompute commits even when the month stays open, so the items it raises (rule C14) wait
    // in Approvals instead of being raised and rolled back at every attempt.
    const result = await this.db.transaction(async (tx): Promise<MonthRow | MonthPending[]> => {
      await lockHolidays(tx);
      const employees = await tx
        .select({ userId: employeeFiles.userId })
        .from(employeeFiles)
        .orderBy(asc(employeeFiles.userId));
      for (const employee of employees) await lockLeave(tx, employee.userId);
      const current = await this.monthRow(tx, month, true);
      if (current?.status === 'closed') return current;

      const userIds = (await this.days.usersWithDays(tx, from, to)).sort();
      const dates: CalendarDate[] = [];
      for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
      for (const userId of userIds) await this.days.refresh(tx, userId, dates, { now });

      // Every employee, so a pending request of one without days here still holds the month.
      const data = await this.collect(
        tx,
        month,
        employees.map((employee) => employee.userId),
      );
      const pending = await this.pendingList(tx, data);
      if (pending.length > 0) return pending;

      const [closed] = current
        ? await tx
            .update(attendanceMonths)
            .set({ status: 'closed', closedById: actor.id, closedAt: now, updatedAt: now })
            .where(eq(attendanceMonths.id, current.id))
            .returning()
        : await tx
            .insert(attendanceMonths)
            .values({ month, status: 'closed', closedById: actor.id, closedAt: now })
            .returning();
      if (!closed) throw new Error('The month row was not written');

      const summarized = userIds.filter((userId) => (data.days.get(userId) ?? []).length > 0);
      for (const userId of summarized) {
        const totals = this.totals(data, userId);
        const values = { ...totals, updatedAt: now, archivedAt: null };
        await tx
          .insert(attendanceMonthSummaries)
          .values({ monthId: closed.id, userId, ...values })
          .onConflictDoUpdate({
            target: [attendanceMonthSummaries.monthId, attendanceMonthSummaries.userId],
            set: values,
          });
      }
      // Rule D4: a later closing rewrites the summaries; one without days there keeps none.
      await tx
        .update(attendanceMonthSummaries)
        .set({ archivedAt: now })
        .where(
          and(
            eq(attendanceMonthSummaries.monthId, closed.id),
            isNull(attendanceMonthSummaries.archivedAt),
            summarized.length > 0
              ? notInArray(attendanceMonthSummaries.userId, summarized)
              : undefined,
          ),
        );
      await recordAudit(tx, {
        actor: { id: actor.id, name: actor.name },
        action: 'attendance_month.closed',
        entityType: 'attendance_month',
        entityId: closed.id,
        before: { status: current?.status ?? 'open' },
        after: { status: 'closed', month, employees: summarized.length },
      });
      await this.center.notify(tx, {
        type: 'attendance_month_closed',
        data: { month },
        recipients: await this.users.withRole('finance', tx),
        actorId: actor.id,
        subjectId: closed.id,
      });
      return closed;
    });
    if (Array.isArray(result)) {
      throw new CodedException(
        409,
        'MONTH_HAS_PENDING',
        'Requests or items of this month still wait for a decision',
        { pending: result },
      );
    }
    return this.present(this.db, month, result);
  }

  /** `POST /months/:month/reopen` (rule D4): with a reason; the summaries stay until the next close. */
  async reopen(
    actor: CurrentUserInfo,
    month: string,
    input: ReopenMonth,
    now = new Date(),
  ): Promise<AttendanceMonth> {
    checkMonth(month);
    const row = await this.db.transaction(async (tx) => {
      const current = await this.monthRow(tx, month, true);
      if (current?.status !== 'closed') {
        throw new CodedException(409, 'NOT_CLOSED', 'This month is not closed');
      }
      const [reopened] = await tx
        .update(attendanceMonths)
        .set({
          status: 'open',
          reopenedById: actor.id,
          reopenedAt: now,
          reopenReason: input.reason,
          updatedAt: now,
        })
        .where(eq(attendanceMonths.id, current.id))
        .returning();
      if (!reopened) throw new NotFoundException();
      await recordAudit(tx, {
        actor: { id: actor.id, name: actor.name },
        action: 'attendance_month.reopened',
        entityType: 'attendance_month',
        entityId: current.id,
        before: { status: 'closed' },
        after: { status: 'open', month, reason: input.reason },
      });
      return reopened;
    });
    return this.present(this.db, month, row);
  }

  /** An employee's items of a month, for their Excel file (rule D5). */
  async itemsOf(userId: string, month: string): Promise<ItemRow[]> {
    checkMonth(month);
    const data = await this.collect(this.db, month, [userId]);
    return data.items.get(userId) ?? [];
  }

  private totals(data: MonthData, userId: string): AttendanceMonthTotals {
    return monthTotals(
      (data.days.get(userId) ?? []).map((day) => ({
        kind: day.kind,
        status: day.status,
        place: day.place,
        leave: day.leave,
        checkedIn: day.firstInAt !== null,
        workedMinutes: day.workedMinutes,
        field: data.fieldDays.has(`${userId}:${day.date}`),
      })),
      data.leaves.get(userId) ?? [],
      data.items.get(userId) ?? [],
    );
  }

  /** The live days, field punches, approved leave, items and pending requests of the month. */
  private async collect(
    executor: Executor,
    month: string,
    userIds: readonly string[],
  ): Promise<MonthData> {
    const { from, to } = monthRange(month);
    const data: MonthData = {
      days: new Map(),
      fieldDays: new Set(),
      leaves: new Map(),
      items: new Map(),
      pendingRequests: [],
    };
    if (userIds.length === 0) return data;
    const ids = [...userIds];
    const [dayRows, punches, leaves, items, pendingRequests] = await Promise.all([
      executor
        .select()
        .from(attendanceDays)
        .where(
          and(
            inArray(attendanceDays.userId, ids),
            isNull(attendanceDays.archivedAt),
            gte(attendanceDays.date, from),
            lte(attendanceDays.date, to),
          ),
        )
        .orderBy(asc(attendanceDays.date)),
      executor
        .select({
          id: attendancePunches.id,
          userId: attendancePunches.userId,
          direction: attendancePunches.direction,
          at: attendancePunches.at,
          method: attendancePunches.method,
        })
        .from(attendancePunches)
        .where(
          and(
            inArray(attendancePunches.userId, ids),
            isNull(attendancePunches.archivedAt),
            gte(attendancePunches.at, dayStart(addDays(from, -1))),
            lt(attendancePunches.at, dayStart(addDays(to, 2))),
          ),
        )
        .orderBy(asc(attendancePunches.at), asc(attendancePunches.id)),
      executor
        .select()
        .from(hrRequests)
        .where(
          and(
            inArray(hrRequests.userId, ids),
            eq(hrRequests.kind, 'leave'),
            eq(hrRequests.status, 'approved'),
            isNull(hrRequests.archivedAt),
            lte(hrRequests.startsOn, to),
            gte(hrRequests.endsOn, from),
          ),
        ),
      executor
        .select({
          id: attendanceItems.id,
          userId: attendanceItems.userId,
          date: attendanceDays.date,
          kind: attendanceItems.kind,
          status: attendanceItems.status,
          decidedFraction: attendanceItems.decidedFraction,
          decidedMinutes: attendanceItems.decidedMinutes,
        })
        .from(attendanceItems)
        .innerJoin(attendanceDays, eq(attendanceDays.id, attendanceItems.dayId))
        .where(
          and(
            inArray(attendanceItems.userId, ids),
            isNull(attendanceItems.archivedAt),
            gte(attendanceDays.date, from),
            lte(attendanceDays.date, to),
          ),
        )
        .orderBy(asc(attendanceDays.date), asc(attendanceItems.kind)),
      executor
        .select({ id: hrRequests.id, userId: hrRequests.userId, startsOn: hrRequests.startsOn })
        .from(hrRequests)
        .where(
          and(
            inArray(hrRequests.userId, ids),
            eq(hrRequests.status, 'pending'),
            ne(hrRequests.kind, 'passkey_replacement'),
            isNull(hrRequests.archivedAt),
            lte(hrRequests.startsOn, to),
            gte(hrRequests.endsOn, from),
          ),
        )
        .orderBy(asc(hrRequests.startsOn), asc(hrRequests.id)),
    ]);
    for (const day of dayRows) push(data.days, day.userId, day);
    for (const userId of ids) {
      const own = punches.filter((punch) => punch.userId === userId);
      const dates = punchDates(own);
      for (const punch of own) {
        const date = dates.get(punch) ?? businessDate(punch.at);
        if ((punch.method === 'field' || punch.method === 'shoot') && from <= date && date <= to) {
          data.fieldDays.add(`${userId}:${date}`);
        }
      }
    }
    if (leaves.length > 0) {
      const subjects = await this.context.subjects(
        leaves.map((leave) => leave.userId),
        executor,
      );
      const earliest = leaves.map((leave) => leave.startsOn).sort()[0] ?? from;
      const holidays = await this.context.holidaysFrom(earliest, executor);
      for (const leave of leaves) {
        const subject = subjects.get(leave.userId);
        if (!subject || !leave.leaveType) continue;
        const units = leaveUnits(leave, subject.workWeekdays, holidays);
        for (const unit of leaveUnitsPay(units, leave.paidDays ?? leave.days ?? 0)) {
          if (unit.date < from || unit.date > to) continue;
          push(data.leaves, leave.userId, {
            leaveType: leave.leaveType,
            days: unit.days,
            unpaidDays: unit.unpaidDays,
          });
        }
      }
    }
    for (const item of items) push(data.items, item.userId, item);
    data.pendingRequests = pendingRequests;
    return data;
  }

  /** Rule D2: what keeps the month from closing, oldest first. */
  private async pendingList(executor: Executor, data: MonthData): Promise<MonthPending[]> {
    const items = [...data.items.values()].flat().filter((item) => item.status === 'pending');
    const names = await this.users.summaries(
      [...data.pendingRequests.map((request) => request.userId), ...items.map((i) => i.userId)],
      executor,
    );
    const person = (id: string) => ({ id, name: names.get(id)?.name ?? '' });
    return [
      ...data.pendingRequests.map(
        (request): MonthPending => ({
          kind: 'request',
          id: request.id,
          user: person(request.userId),
          date: request.startsOn,
        }),
      ),
      ...items.map(
        (item): MonthPending => ({
          kind: 'item',
          id: item.id,
          user: person(item.userId),
          date: item.date,
        }),
      ),
    ].sort((a, b) => a.date.localeCompare(b.date));
  }

  private async monthRow(
    executor: Executor,
    month: string,
    forUpdate = false,
  ): Promise<MonthRow | null> {
    const query = executor
      .select()
      .from(attendanceMonths)
      .where(and(eq(attendanceMonths.month, month), isNull(attendanceMonths.archivedAt)));
    const [row] = forUpdate ? await query.for('update') : await query;
    return row ?? null;
  }

  private async present(
    executor: Executor,
    month: string,
    row: MonthRow | null,
  ): Promise<AttendanceMonth> {
    const names = await this.users.summaries(
      [row?.closedById, row?.reopenedById].filter((id): id is string => !!id),
      executor,
    );
    const person = (id: string | null | undefined) =>
      id ? { id, name: names.get(id)?.name ?? '' } : null;
    return {
      month,
      status: row?.status ?? 'open',
      closedBy: person(row?.closedById),
      closedAt: row?.closedAt?.toISOString() ?? null,
      reopenedBy: person(row?.reopenedById),
      reopenedAt: row?.reopenedAt?.toISOString() ?? null,
      reopenReason: row?.reopenReason ?? null,
    };
  }
}

function checkMonth(month: string): void {
  if (!calendarMonthSchema.safeParse(month).success) {
    throw new BadRequestException('The month is `YYYY-MM`');
  }
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function totalsOf(row: typeof attendanceMonthSummaries.$inferSelect): AttendanceMonthTotals {
  return {
    workDays: row.workDays,
    presentDays: row.presentDays,
    remoteDays: row.remoteDays,
    fieldDays: row.fieldDays,
    absentDays: row.absentDays,
    leaveDays: { annual: 0, sick: 0, emergency: 0, unpaid: 0, ...row.leaveDays },
    unpaidLeaveDays: row.unpaidLeaveDays,
    holidayDays: row.holidayDays,
    lateCount: row.lateCount,
    deductedDays: row.deductedDays,
    overtimePaidMinutes: row.overtimePaidMinutes,
    overtimeTimeOffMinutes: row.overtimeTimeOffMinutes,
    workedMinutes: row.workedMinutes,
  };
}
