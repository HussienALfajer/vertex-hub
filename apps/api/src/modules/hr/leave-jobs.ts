import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  accrualDays,
  addDays,
  type CalendarDate,
  type DepartmentCode,
  firstOfMonth,
  nextWorkDay,
  rollover,
  sumDays,
} from '@vertex-hub/contracts';
import { type Database, employeeFiles, hrRequests, hrSettings, leaveLedger } from '@vertex-hub/db';
import { and, asc, eq, gt, isNotNull, isNull, lte, or } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { runEach } from '../../core/jobs/index.js';
import { UserDirectory } from '../auth/index.js';
import { DailyReminders } from '../notifications/index.js';
import { HolidayCalendar } from './holiday-calendar.js';
import { LeaveLedger, type LedgerInsert } from './leave-ledger.js';

/** The month before the one holding `date`, as `YYYY-MM`. */
const previousMonth = (date: CalendarDate) => addDays(firstOfMonth(date), -1).slice(0, 7);

/**
 * The leave steps of `hr.daily` (rules B4, B5 and B18). Each is idempotent by the ledger's unique
 * keys or the reminder keys, so a run after missed days catches up once.
 */
@Injectable()
export class LeaveJobs {
  private readonly logger = new Logger(LeaveJobs.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly ledger: LeaveLedger,
    private readonly reminders: DailyReminders,
    private readonly holidays: HolidayCalendar,
  ) {}

  /**
   * Rules B4 and B5 for every live file with a start date that has not ended: the sick and
   * emergency grants of the year, last month's annual accrual, then the rollover of last year.
   * Returns the ledger rows written.
   */
  async balances(today: CalendarDate): Promise<number> {
    const [settings] = await this.db.select().from(hrSettings);
    if (!settings) throw new Error('No HR settings');
    const files = await this.db
      .select({
        userId: employeeFiles.userId,
        startDate: employeeFiles.startDate,
        annualLeaveDays: employeeFiles.annualLeaveDays,
      })
      .from(employeeFiles)
      .where(
        and(
          isNull(employeeFiles.archivedAt),
          isNotNull(employeeFiles.startDate),
          lte(employeeFiles.startDate, today),
          or(isNull(employeeFiles.endedOn), gt(employeeFiles.endedOn, addDays(today, -1))),
        ),
      )
      .orderBy(asc(employeeFiles.userId));
    const year = Number(today.slice(0, 4));
    const period = previousMonth(today);
    let written = 0;
    await runEach(
      files,
      this.logger,
      (file) => `Leave balances ${file.userId}`,
      async (file) => {
        const startDate = file.startDate as CalendarDate;
        written += await this.db.transaction(async (tx) => {
          // Rule B4: sick and emergency in full, on 1 January or the start date.
          const rows: LedgerInsert[] = [
            { leaveType: 'sick' as const, days: settings.sickDaysPerYear },
            { leaveType: 'emergency' as const, days: settings.emergencyDaysPerYear },
          ].map((grant) => ({
            ...grant,
            userId: file.userId,
            year,
            entry: 'grant' as const,
          }));
          // Rule B4: last month's accrual, once its first day 1 after the start date has come.
          const periodYear = Number(period.slice(0, 4));
          if (startDate < firstOfMonth(today)) {
            const accrued = await tx
              .select({ days: leaveLedger.days })
              .from(leaveLedger)
              .where(
                and(
                  eq(leaveLedger.userId, file.userId),
                  eq(leaveLedger.leaveType, 'annual'),
                  eq(leaveLedger.year, periodYear),
                  eq(leaveLedger.entry, 'accrual'),
                  isNull(leaveLedger.archivedAt),
                ),
              );
            const owed = await tx
              .select({ id: leaveLedger.id })
              .from(leaveLedger)
              .where(
                and(
                  eq(leaveLedger.userId, file.userId),
                  eq(leaveLedger.entry, 'accrual'),
                  eq(leaveLedger.period, period),
                  isNull(leaveLedger.archivedAt),
                ),
              );
            const days = accrualDays({
              annualDays: file.annualLeaveDays,
              startDate,
              period,
              accruedBefore: sumDays(accrued.map((row) => row.days)),
            });
            if (owed.length === 0 && days > 0) {
              rows.push({
                userId: file.userId,
                leaveType: 'annual',
                year: periodYear,
                days,
                entry: 'accrual',
                period,
              });
            }
          }
          let count = await this.ledger.insert(tx, rows);
          // Rule B5: last year's unused annual balance, after its December accrual.
          if (startDate < `${year}-01-01`) {
            const balance = (await this.ledger.balances(tx, file.userId, year - 1)).annual;
            const { carried, expired } = rollover(balance, settings.carryOverMaxDays);
            const [carry] = await tx
              .insert(leaveLedger)
              .values({
                userId: file.userId,
                leaveType: 'annual',
                year,
                days: carried,
                entry: 'carry_over',
              })
              .onConflictDoNothing()
              .returning({ id: leaveLedger.id });
            if (carry) {
              count += 1;
              if (expired > 0) {
                count += await this.ledger.insert(tx, [
                  {
                    userId: file.userId,
                    leaveType: 'annual',
                    year: year - 1,
                    days: -expired,
                    entry: 'expiry',
                  },
                ]);
              }
            }
          }
          return count;
        });
      },
    );
    return written;
  }

  /**
   * Rule B18: the managers of the employee's departments hear of an approved leave on the work
   * day before it starts (a leave after a weekend or holiday, on the last work day before it).
   */
  async colleagueNotices(today: CalendarDate): Promise<number> {
    const holidays = await this.holidays.from(today);
    const until = nextWorkDay(today, holidays);
    const leaves = await this.db
      .select({
        id: hrRequests.id,
        userId: hrRequests.userId,
        startsOn: hrRequests.startsOn,
        endsOn: hrRequests.endsOn,
      })
      .from(hrRequests)
      .where(
        and(
          eq(hrRequests.kind, 'leave'),
          eq(hrRequests.status, 'approved'),
          isNull(hrRequests.archivedAt),
          gt(hrRequests.startsOn, today),
          lte(hrRequests.startsOn, until),
        ),
      )
      .orderBy(asc(hrRequests.id));
    let sent = 0;
    await runEach(
      leaves,
      this.logger,
      (leave) => `Colleague on leave ${leave.id}`,
      async (leave) => {
        const recorded = await this.db.transaction(async (tx) => {
          const [profile] = await this.users.profiles({ ids: [leave.userId] }, tx);
          if (!profile || profile.archived) return false;
          const codes = [
            ...((await this.users.memberships([leave.userId], tx)).get(leave.userId) ?? []),
          ] as DepartmentCode[];
          const managers = await this.users.departmentManagers(codes, tx);
          const recipients = [...new Set([...managers.values()].flat())].filter(
            (id) => id !== leave.userId,
          );
          if (recipients.length === 0) return false;
          return this.reminders.remindOnce(
            tx,
            { kind: 'colleague_on_leave', subjectId: leave.id, occurrence: leave.startsOn },
            today,
            {
              type: 'colleague_on_leave',
              data: { employee: profile.name, startsOn: leave.startsOn, endsOn: leave.endsOn },
              recipients,
              actorId: null,
              subjectId: leave.userId,
            },
          );
        });
        if (recorded) sent += 1;
      },
    );
    return sent;
  }
}
