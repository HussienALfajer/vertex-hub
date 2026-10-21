import { Inject, Injectable } from '@nestjs/common';
import type { CalendarDate, HolidayRange, Weekday } from '@vertex-hub/contracts';
import { type Database, employeeFiles, type Transaction, workScheduleDays } from '@vertex-hub/db';
import { asc, inArray } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { UserDirectory } from '../auth/index.js';
import { EmployeeFiles } from './employee-files.js';
import { HolidayCalendar } from './holiday-calendar.js';

type Executor = Database | Transaction;

/** What the leave rules read of an employee file. */
export interface LeaveSubject {
  userId: string;
  startDate: CalendarDate | null;
  probationEndDate: CalendarDate | null;
  endedOn: CalendarDate | null;
  archived: boolean;
  /** Rule B1: the weekdays of their schedule. */
  workWeekdays: Weekday[];
}

/** The employee files and holidays the leave rules count days with (rules B1 and B11). */
@Injectable()
export class LeaveContext {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly files: EmployeeFiles,
    private readonly holidays: HolidayCalendar,
  ) {}

  /** The files of these users, created when missing; unknown users are left out. */
  async subjects(
    userIds: readonly string[],
    executor: Executor = this.db,
  ): Promise<Map<string, LeaveSubject>> {
    const unique = [...new Set(userIds)];
    const result = new Map<string, LeaveSubject>();
    if (unique.length === 0) return result;
    await this.files.ensure(executor, await this.users.profiles({ ids: unique }, executor));
    const rows = await executor
      .select({
        userId: employeeFiles.userId,
        startDate: employeeFiles.startDate,
        probationEndDate: employeeFiles.probationEndDate,
        endedOn: employeeFiles.endedOn,
        archivedAt: employeeFiles.archivedAt,
        scheduleId: employeeFiles.scheduleId,
      })
      .from(employeeFiles)
      .where(inArray(employeeFiles.userId, unique));
    const days = await executor
      .select({ scheduleId: workScheduleDays.scheduleId, weekday: workScheduleDays.weekday })
      .from(workScheduleDays)
      .where(inArray(workScheduleDays.scheduleId, [...new Set(rows.map((row) => row.scheduleId))]))
      .orderBy(asc(workScheduleDays.weekday));
    for (const row of rows) {
      result.set(row.userId, {
        userId: row.userId,
        startDate: row.startDate,
        probationEndDate: row.probationEndDate,
        endedOn: row.endedOn,
        archived: !!row.archivedAt,
        workWeekdays: days
          .filter((day) => day.scheduleId === row.scheduleId)
          .map((day) => day.weekday),
      });
    }
    return result;
  }

  async subject(userId: string, executor: Executor = this.db): Promise<LeaveSubject | null> {
    return (await this.subjects([userId], executor)).get(userId) ?? null;
  }

  /** The non-archived holidays ending on or after `from`. */
  holidaysFrom(from: CalendarDate, executor: Executor = this.db): Promise<HolidayRange[]> {
    return this.holidays.from(from, executor);
  }
}
