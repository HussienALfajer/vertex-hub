import { Injectable } from '@nestjs/common';
import {
  addDays,
  businessDate,
  businessInstant,
  type CalendarDate,
  computeDay,
  type DayLeave,
  type DayPhase,
  type HolidayRange,
  lastOfMonth,
  punchDates,
  type TimeOfDay,
  weekdayOf,
} from '@vertex-hub/contracts';
import {
  attendanceDays,
  attendancePunches,
  type Database,
  employeeFiles,
  hrRequests,
  hrSettings,
  type Transaction,
  workScheduleDays,
  workSchedules,
} from '@vertex-hub/db';
import { and, asc, eq, gte, inArray, isNull, lt, lte } from 'drizzle-orm';
import { AttendanceItems } from './attendance-items.js';
import { closedMonths } from './closed-months.js';
import { HolidayCalendar } from './holiday-calendar.js';
import { lockLeave } from './leave-ledger.js';

type Executor = Database | Transaction;

export type DayRow = typeof attendanceDays.$inferSelect;

type FileRow = typeof employeeFiles.$inferSelect;

const toTime = (value: string): TimeOfDay => value.slice(0, 5);

const minutesLater = (at: Date, minutes: number) => new Date(at.getTime() + minutes * 60_000);

/**
 * Rule C2: attendance applies to a file whose service covers the date. Being live and not exempt
 * counts from `today` on: a day already passed keeps its record (rule A3, edge cases 17 and 18).
 */
export function attendanceApplies(
  file: Pick<FileRow, 'archivedAt' | 'attendanceExempt' | 'startDate' | 'endedOn'> | undefined,
  date: CalendarDate,
  today: CalendarDate,
): boolean {
  return (
    !!file &&
    (date < today || (!file.archivedAt && !file.attendanceExempt)) &&
    !!file.startDate &&
    file.startDate <= date &&
    (!file.endedOn || date <= file.endedOn)
  );
}

/**
 * The attendance days (rules C1, C2, C14–C16): one row per user and date, created by the daily
 * job, a punch or the user's own screen. Its expectations are frozen from the schedule when it is
 * created (edge case 10: a schedule change reaches only days without punches from today on); its
 * figures are recomputed from punches, approved leave and permissions, holidays and the HR
 * settings whenever one of them changes, and its items follow (`AttendanceItems`, rules C14 and
 * C17). Callers hold the user's HR lock (`lockLeave`).
 */
@Injectable()
export class AttendanceDays {
  constructor(
    private readonly holidays: HolidayCalendar,
    private readonly items: AttendanceItems,
  ) {}

  /**
   * Recomputes the user's days on `dates`. `create` adds the missing rows where attendance
   * applies; `refreeze` takes the schedule again for days from today on without punches.
   * Returns the rows that exist afterwards, archived ones (attendance no longer applies) left out.
   */
  async refresh(
    executor: Transaction,
    userId: string,
    dates: readonly CalendarDate[],
    options: { create?: boolean; refreeze?: boolean; now?: Date } = {},
  ): Promise<Map<CalendarDate, DayRow>> {
    const result = new Map<CalendarDate, DayRow>();
    const requested = [...new Set(dates)].sort();
    if (requested.length === 0) return result;
    // Rule D2: the days of a closed month keep what its summary froze.
    const closed = await closedMonths(
      executor,
      requested[0] as CalendarDate,
      requested.at(-1) as CalendarDate,
    );
    const unique = requested.filter((date) => !closed.has(date.slice(0, 7)));
    const first = unique[0];
    const last = unique.at(-1);
    if (!first || !last) return result;
    const now = options.now ?? new Date();
    const today = businessDate(now);
    const [file] = await executor
      .select()
      .from(employeeFiles)
      .where(eq(employeeFiles.userId, userId));
    const existing = await executor
      .select()
      .from(attendanceDays)
      .where(
        and(
          eq(attendanceDays.userId, userId),
          gte(attendanceDays.date, first),
          lte(attendanceDays.date, last),
        ),
      );
    const rows = new Map(existing.map((row) => [row.date, row]));
    if (!file) return result;
    const [settings, holidays, schedule, requests, punches] = await Promise.all([
      executor
        .select()
        .from(hrSettings)
        .then(([row]) => {
          if (!row) throw new Error('The HR settings row is missing; run the migrations');
          return row;
        }),
      this.holidays.from(first, executor),
      this.scheduleDays(executor, file.scheduleId),
      this.approvedRequests(executor, userId, first, last),
      this.punchesAround(executor, userId, first, last),
    ]);
    const datesOfPunches = punchDates(punches);
    for (const date of unique) {
      let row = rows.get(date);
      if (!attendanceApplies(file, date, today)) {
        if (row && !row.archivedAt) {
          await executor
            .update(attendanceDays)
            .set({ archivedAt: now })
            .where(eq(attendanceDays.id, row.id));
          await this.items.dropDay(executor, row.id, now);
        }
        continue;
      }
      const dayPunches = punches.filter(
        (punch) => datesOfPunches.get(punch) === date && !punch.archivedAt,
      );
      const frozen = expectations(date, schedule);
      if (!row) {
        if (!options.create) continue;
        const [inserted] = await executor
          .insert(attendanceDays)
          .values({ userId, date, kind: 'work', status: 'upcoming', ...frozen })
          .onConflictDoNothing()
          .returning();
        row =
          inserted ??
          (
            await executor
              .select()
              .from(attendanceDays)
              .where(and(eq(attendanceDays.userId, userId), eq(attendanceDays.date, date)))
          )[0];
        if (!row) continue;
      } else if (row.archivedAt || (options.refreeze && date >= today && dayPunches.length === 0)) {
        row = { ...row, ...frozen };
      }
      const updated = await this.compute(executor, row, now, {
        file,
        holidays,
        requests,
        punches: dayPunches,
        settings,
        phase: phaseOf(date, row.expectedStart, dayPunches.length > 0, now, today),
      });
      result.set(date, updated);
    }
    return result;
  }

  /** The user's live days in a month, by date. */
  async month(executor: Executor, userId: string, month: string): Promise<DayRow[]> {
    const from = `${month}-01`;
    return executor
      .select()
      .from(attendanceDays)
      .where(
        and(
          eq(attendanceDays.userId, userId),
          isNull(attendanceDays.archivedAt),
          gte(attendanceDays.date, from),
          lte(attendanceDays.date, lastOfMonth(from)),
        ),
      )
      .orderBy(asc(attendanceDays.date));
  }

  /**
   * `hr.daily` (rules C2, C14): the users whose yesterday is finalized and today created: those
   * attendance applies to today, and those with a day yesterday (an account archived at its end
   * of service still has its last day finalized).
   */
  async dailyUsers(executor: Executor, today: CalendarDate): Promise<string[]> {
    const yesterday = addDays(today, -1);
    const files = await executor
      .select({
        userId: employeeFiles.userId,
        archivedAt: employeeFiles.archivedAt,
        attendanceExempt: employeeFiles.attendanceExempt,
        startDate: employeeFiles.startDate,
        endedOn: employeeFiles.endedOn,
      })
      .from(employeeFiles)
      .where(and(isNull(employeeFiles.archivedAt), eq(employeeFiles.attendanceExempt, false)))
      .orderBy(asc(employeeFiles.userId));
    const applying = files
      .filter((file) => attendanceApplies(file, today, today))
      .map((file) => file.userId);
    const withYesterday = await this.usersWithDays(executor, yesterday, yesterday);
    return [...new Set([...applying, ...withYesterday])].sort();
  }

  /**
   * Recomputes the user's existing days from `from` to today, and today itself (rule C2: a start
   * date moved; edge case 10: today follows the file while it has no punch).
   */
  async refreshExisting(
    tx: Transaction,
    userId: string,
    from: CalendarDate,
    now = new Date(),
  ): Promise<void> {
    const today = businessDate(now);
    const rows = await tx
      .select({ date: attendanceDays.date })
      .from(attendanceDays)
      .where(
        and(
          eq(attendanceDays.userId, userId),
          gte(attendanceDays.date, from),
          lte(attendanceDays.date, today),
        ),
      );
    await this.refresh(tx, userId, [...rows.map((row) => row.date), today], {
      refreeze: true,
      now,
    });
  }

  /**
   * Recomputes every existing day from `from` to today (rule C1: the start date moved), each user
   * under their lock.
   */
  async refreshFrom(tx: Transaction, from: CalendarDate, now = new Date()): Promise<void> {
    const today = businessDate(now);
    if (from > today) return;
    const dates: CalendarDate[] = [];
    for (let date = from; date <= today; date = addDays(date, 1)) dates.push(date);
    for (const userId of (await this.usersWithDays(tx, from, today)).sort()) {
      await lockLeave(tx, userId);
      await this.refresh(tx, userId, dates, { now });
    }
  }

  /** The users with a day row on one of the dates, for changes that touch everyone (holidays). */
  async usersWithDays(executor: Executor, from: CalendarDate, to: CalendarDate): Promise<string[]> {
    const rows = await executor
      .selectDistinct({ userId: attendanceDays.userId })
      .from(attendanceDays)
      .where(and(gte(attendanceDays.date, from), lte(attendanceDays.date, to)));
    return rows.map((row) => row.userId);
  }

  /** Rule C2: whether attendance applies to the user on `date` (a correction's day, rule C19). */
  async appliesOn(executor: Executor, userId: string, date: CalendarDate): Promise<boolean> {
    const [file] = await executor
      .select()
      .from(employeeFiles)
      .where(eq(employeeFiles.userId, userId));
    return attendanceApplies(file, date, businessDate());
  }

  /**
   * Rule C8: whether the user works remotely on `date`: a standing remote weekday of the file, or
   * an approved remote day (rule C19).
   */
  async remoteOn(
    executor: Executor,
    file: Pick<FileRow, 'userId' | 'remoteWeekdays'>,
    date: CalendarDate,
  ): Promise<boolean> {
    if (file.remoteWeekdays.includes(weekdayOf(date))) return true;
    const requests = await this.approvedRequests(executor, file.userId, date, date);
    return requests.some((request) => request.kind === 'remote_day');
  }

  private async compute(
    executor: Transaction,
    row: DayRow,
    now: Date,
    context: {
      file: FileRow;
      holidays: readonly HolidayRange[];
      requests: readonly RequestRow[];
      punches: readonly { direction: 'in' | 'out'; at: Date }[];
      settings: typeof hrSettings.$inferSelect;
      phase: DayPhase;
    },
  ): Promise<DayRow> {
    const { date } = row;
    const holiday = context.holidays.some((h) => h.startsOn <= date && date <= h.endsOn);
    const kind = holiday ? 'holiday' : row.expectedStart ? 'work' : 'off';
    const covering = context.requests.filter((r) => r.startsOn <= date && date <= r.endsOn);
    const leave: DayLeave = (() => {
      const halves = new Set(covering.filter((r) => r.kind === 'leave').map((r) => r.half));
      if (halves.size === 0) return 'none';
      // A whole day, or both halves of it (rule B8).
      if (halves.has(null) || halves.size === 2) return 'full';
      return [...halves][0] ?? 'full';
    })();
    const permissions = covering
      .filter((r) => r.kind === 'permission' && r.fromTime && r.toTime)
      .map((r) => ({
        from: businessInstant(date, toTime(r.fromTime ?? '')),
        to: businessInstant(date, toTime(r.toTime ?? '')),
      }));
    const trial =
      !context.settings.attendanceStartsOn || date < context.settings.attendanceStartsOn;
    const computed = computeDay({
      kind,
      expectedStart: row.expectedStart,
      latestStart: row.latestStart,
      expectedEnd: row.expectedEnd,
      requiredMinutes: row.requiredMinutes,
      leave,
      permissions,
      punches: context.punches,
      graceMinutes: context.settings.graceMinutes,
      overtimeMinMinutes: context.settings.overtimeMinMinutes,
      phase: context.phase,
      trial,
    });
    const remote =
      context.file.remoteWeekdays.includes(weekdayOf(date)) ||
      covering.some((r) => r.kind === 'remote_day');
    const [updated] = await executor
      .update(attendanceDays)
      .set({
        kind,
        expectedStart: row.expectedStart,
        latestStart: row.latestStart,
        expectedEnd: row.expectedEnd,
        requiredMinutes: row.requiredMinutes,
        place: kind === 'work' ? (remote ? 'remote' : 'office') : null,
        leave,
        firstInAt: computed.firstInAt,
        lastOutAt: computed.lastOutAt,
        workedMinutes: computed.workedMinutes,
        lateMinutes: computed.lateMinutes,
        earlyMinutes: computed.earlyMinutes,
        overtimeMinutes: computed.overtimeMinutes,
        status: computed.status,
        archivedAt: null,
      })
      .where(eq(attendanceDays.id, row.id))
      .returning();
    if (!updated) return row;
    await this.items.reconcile(
      executor,
      { row: updated, computed, phase: context.phase, trial, settings: context.settings },
      now,
    );
    return updated;
  }

  private async scheduleDays(executor: Executor, scheduleId: string) {
    return executor
      .select({
        kind: workSchedules.kind,
        weekday: workScheduleDays.weekday,
        startTime: workScheduleDays.startTime,
        latestStartTime: workScheduleDays.latestStartTime,
        requiredMinutes: workScheduleDays.requiredMinutes,
      })
      .from(workScheduleDays)
      .innerJoin(workSchedules, eq(workSchedules.id, workScheduleDays.scheduleId))
      .where(eq(workScheduleDays.scheduleId, scheduleId));
  }

  private async approvedRequests(
    executor: Executor,
    userId: string,
    from: CalendarDate,
    to: CalendarDate,
  ) {
    return executor
      .select({
        kind: hrRequests.kind,
        startsOn: hrRequests.startsOn,
        endsOn: hrRequests.endsOn,
        half: hrRequests.half,
        fromTime: hrRequests.fromTime,
        toTime: hrRequests.toTime,
      })
      .from(hrRequests)
      .where(
        and(
          eq(hrRequests.userId, userId),
          eq(hrRequests.status, 'approved'),
          inArray(hrRequests.kind, ['leave', 'permission', 'remote_day']),
          isNull(hrRequests.archivedAt),
          lte(hrRequests.startsOn, to),
          gte(hrRequests.endsOn, from),
        ),
      );
  }

  /** The punches from the day before `from` to the day after `to`, for rule C15's midnight. */
  private async punchesAround(
    executor: Executor,
    userId: string,
    from: CalendarDate,
    to: CalendarDate,
  ) {
    return executor
      .select({
        direction: attendancePunches.direction,
        at: attendancePunches.at,
        archivedAt: attendancePunches.archivedAt,
      })
      .from(attendancePunches)
      .where(
        and(
          eq(attendancePunches.userId, userId),
          isNull(attendancePunches.archivedAt),
          gte(attendancePunches.at, businessInstant(addDays(from, -1), '00:00')),
          lt(attendancePunches.at, businessInstant(addDays(to, 2), '00:00')),
        ),
      )
      .orderBy(asc(attendancePunches.at), asc(attendancePunches.id));
  }
}

type RequestRow = Awaited<ReturnType<AttendanceDays['approvedRequests']>>[number];

/** The expectations a date takes from its schedule; none on a weekday it leaves out. */
function expectations(
  date: CalendarDate,
  schedule: Awaited<ReturnType<AttendanceDays['scheduleDays']>>,
): Pick<DayRow, 'expectedStart' | 'latestStart' | 'expectedEnd' | 'requiredMinutes'> {
  const day = schedule.find((d) => d.weekday === weekdayOf(date));
  if (!day) {
    return { expectedStart: null, latestStart: null, expectedEnd: null, requiredMinutes: null };
  }
  const expectedStart = businessInstant(date, toTime(day.startTime));
  const latestStart =
    day.kind === 'flexible' && day.latestStartTime
      ? businessInstant(date, toTime(day.latestStartTime))
      : null;
  return {
    expectedStart,
    latestStart,
    expectedEnd: minutesLater(latestStart ?? expectedStart, day.requiredMinutes),
    requiredMinutes: day.requiredMinutes,
  };
}

/** Before the date, or today before its start without a punch; during today; after it. */
function phaseOf(
  date: CalendarDate,
  expectedStart: Date | null,
  punched: boolean,
  now: Date,
  today: CalendarDate,
): DayPhase {
  if (date > today) return 'before';
  if (date < today) return 'after';
  return !punched && expectedStart && now < expectedStart ? 'before' : 'during';
}
