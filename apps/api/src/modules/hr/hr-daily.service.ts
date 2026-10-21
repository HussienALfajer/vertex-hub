import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  addDays,
  businessDate,
  businessInstant,
  type CalendarDate,
  CONTRACT_REMINDER_DAYS,
  endReminderDue,
  HR_DAILY_JOB,
  type NotificationReminderKind,
  PROBATION_REMINDER_DAYS,
} from '@vertex-hub/contracts';
import { type Database, employeeFiles } from '@vertex-hub/db';
import { and, asc, eq, isNotNull, isNull, lt } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { JobQueue, runEach } from '../../core/jobs/index.js';
import { AccountArchiver, UserDirectory } from '../auth/index.js';
import { DailyReminders } from '../notifications/index.js';
import { AttendanceDays } from './attendance-days.js';
import { EmployeeFiles } from './employee-files.js';
import { LeaveJobs } from './leave-jobs.js';
import { lockLeave } from './leave-ledger.js';

/** One reminder the day owes: its kind, type and end date. */
interface DueReminder {
  kind: NotificationReminderKind;
  type: 'contract_ending' | 'probation_ending';
  endsOn: CalendarDate;
}

/**
 * The `hr.daily` job, part A: the contract and probation reminders to GMs and Ops (rule A7) and
 * the archiving of accounts whose last working day has passed (rule A8). Part B: the leave
 * grants, accruals and year rollover (rules B4 and B5) and `colleague_on_leave` (rule B18).
 * Part C: yesterday's attendance days finalized and today's created (rules C2, C14).
 * Idempotent: reminders are keyed in `notification_reminders`, ledger rows by its unique keys,
 * and an archived account is left alone. `apps/worker`
 * schedules it; this process works it.
 */
@Injectable()
export class HrDailyService implements OnModuleInit {
  private readonly logger = new Logger(HrDailyService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly jobs: JobQueue,
    private readonly reminders: DailyReminders,
    private readonly users: UserDirectory,
    private readonly accounts: AccountArchiver,
    private readonly files: EmployeeFiles,
    private readonly leave: LeaveJobs,
    private readonly days: AttendanceDays,
  ) {}

  onModuleInit(): void {
    this.jobs.work(HR_DAILY_JOB.queue, async () => {
      const result = await this.runDaily();
      this.logger.log(
        `Daily HR: ${result.reminded} reminders sent, ${result.archived} accounts archived, ${result.ledgerRows} leave ledger rows, ${result.leaveNotices} leave notices, ${result.attendanceUsers} attendance users`,
      );
    });
  }

  async runDaily(today: CalendarDate = businessDate()): Promise<{
    reminded: number;
    archived: number;
    ledgerRows: number;
    leaveNotices: number;
    attendanceUsers: number;
  }> {
    await this.files.ensureAll();
    let reminded = 0;
    let archived = 0;
    let ledgerRows = 0;
    let leaveNotices = 0;
    let attendanceUsers = 0;
    // One step failing holds back neither the other; the run fails at the end.
    const steps: [string, () => Promise<void>][] = [
      [
        'HR reminders',
        async () => {
          reminded = await this.remind(today);
        },
      ],
      [
        'Ended services',
        async () => {
          archived = await this.archiveEnded(today);
        },
      ],
      [
        'Leave balances',
        async () => {
          ledgerRows = await this.leave.balances(today);
        },
      ],
      [
        'Colleague leave',
        async () => {
          leaveNotices = await this.leave.colleagueNotices(today);
        },
      ],
      [
        'Attendance days',
        async () => {
          attendanceUsers = await this.attendanceDays(today);
        },
      ],
    ];
    await runEach(
      steps,
      this.logger,
      ([name]) => name,
      ([, step]) => step(),
    );
    return { reminded, archived, ledgerRows, leaveNotices, attendanceUsers };
  }

  /**
   * Rules C2 and C14: yesterday's days are finalized and today's created. A run for another
   * date (the development command) runs as at 00:10 of it.
   */
  private async attendanceDays(today: CalendarDate): Promise<number> {
    const now = today === businessDate() ? new Date() : businessInstant(today, '00:10');
    const userIds = await this.days.dailyUsers(this.db, today);
    let done = 0;
    await runEach(
      userIds,
      this.logger,
      (userId) => `Attendance days ${userId}`,
      async (userId) => {
        await this.db.transaction(async (tx) => {
          await lockLeave(tx, userId);
          await this.days.refresh(tx, userId, [addDays(today, -1), today], { create: true, now });
        });
        done += 1;
      },
    );
    return done;
  }

  /** Rule A7: live files without an end of service; once per employee, date and threshold. */
  private async remind(today: CalendarDate): Promise<number> {
    const files = await this.db
      .select({
        userId: employeeFiles.userId,
        contractEndDate: employeeFiles.contractEndDate,
        probationEndDate: employeeFiles.probationEndDate,
      })
      .from(employeeFiles)
      .where(and(isNull(employeeFiles.archivedAt), isNull(employeeFiles.endedOn)))
      .orderBy(asc(employeeFiles.userId));
    const due = files.flatMap((file) => {
      const reminders: (DueReminder & { userId: string })[] = [];
      if (file.contractEndDate) {
        const days = endReminderDue(file.contractEndDate, today, CONTRACT_REMINDER_DAYS);
        if (days !== null) {
          reminders.push({
            userId: file.userId,
            kind: days === 7 ? 'contract_ending_7' : 'contract_ending_30',
            type: 'contract_ending',
            endsOn: file.contractEndDate,
          });
        }
      }
      if (
        file.probationEndDate &&
        endReminderDue(file.probationEndDate, today, [PROBATION_REMINDER_DAYS]) !== null
      ) {
        reminders.push({
          userId: file.userId,
          kind: 'probation_ending',
          type: 'probation_ending',
          endsOn: file.probationEndDate,
        });
      }
      return reminders;
    });
    let sent = 0;
    await runEach(
      due,
      this.logger,
      (reminder) => `HR ${reminder.kind} reminder ${reminder.userId}`,
      async (reminder) => {
        const recorded = await this.db.transaction(async (tx) => {
          // Checked again under the lock: a date changed or a service ended since the read.
          const [file] = await tx
            .select()
            .from(employeeFiles)
            .where(eq(employeeFiles.userId, reminder.userId))
            .for('update');
          const endsOn =
            reminder.type === 'contract_ending' ? file?.contractEndDate : file?.probationEndDate;
          if (!file || file.archivedAt || file.endedOn || endsOn !== reminder.endsOn) return false;
          const [profile] = await this.users.profiles({ ids: [reminder.userId] }, tx);
          const managers = await this.users.departmentManagers(['internal_operations'], tx);
          return this.reminders.remindOnce(
            tx,
            { kind: reminder.kind, subjectId: reminder.userId, occurrence: reminder.endsOn },
            today,
            {
              type: reminder.type,
              data: { employee: profile?.name ?? '', endsOn: reminder.endsOn },
              recipients: [
                ...(await this.users.withRole('general_manager', tx)),
                ...[...managers.values()].flat(),
              ].filter((id) => id !== reminder.userId),
              actorId: null,
              subjectId: reminder.userId,
            },
          );
        });
        if (recorded) sent += 1;
      },
    );
    return sent;
  }

  /** Rule A8: on the day after the last working day, the account is archived (F01 rules). */
  private async archiveEnded(today: CalendarDate): Promise<number> {
    const ended = await this.db
      .select({ userId: employeeFiles.userId })
      .from(employeeFiles)
      .where(
        and(
          isNull(employeeFiles.archivedAt),
          isNotNull(employeeFiles.endedOn),
          lt(employeeFiles.endedOn, today),
        ),
      )
      .orderBy(asc(employeeFiles.userId));
    let archived = 0;
    await runEach(
      ended,
      this.logger,
      ({ userId }) => `End of service ${userId}`,
      async ({ userId }) => {
        if (await this.db.transaction((tx) => this.accounts.archive(tx, userId))) archived += 1;
      },
    );
    return archived;
  }
}
