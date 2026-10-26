import { Inject, Injectable } from '@nestjs/common';
import { addDays, type CalendarDate, isScheduleWorkDay, weekdayOf } from '@vertex-hub/contracts';
import { type Database, employeeFiles, workScheduleDays } from '@vertex-hub/db';
import { and, inArray, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { HolidayCalendar } from './holiday-calendar.js';
import { LeaveDirectory } from './leave-directory.js';

/**
 * F06B rules C5 and C8: the work minutes of each person's schedule (rule A1) over a range of
 * days, after public holidays and approved leave (a half day counts half), for the readiness
 * check and Workload in `tasks`.
 */
@Injectable()
export class WorkCapacity {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly holidays: HolidayCalendar,
    private readonly leave: LeaveDirectory,
  ) {}

  /** Minutes per user in `[from, to]`; null for a user without an employee file (edge case 21). */
  async minutes(
    userIds: readonly string[],
    from: CalendarDate,
    to: CalendarDate,
  ): Promise<Map<string, number | null>> {
    const result = new Map<string, number | null>(userIds.map((id) => [id, null]));
    if (userIds.length === 0 || from > to) return result;
    const files = await this.db
      .select({ userId: employeeFiles.userId, scheduleId: employeeFiles.scheduleId })
      .from(employeeFiles)
      .where(and(inArray(employeeFiles.userId, [...userIds]), isNull(employeeFiles.archivedAt)));
    if (files.length === 0) return result;
    const [days, holidays, leaves] = await Promise.all([
      this.db
        .select({
          scheduleId: workScheduleDays.scheduleId,
          weekday: workScheduleDays.weekday,
          requiredMinutes: workScheduleDays.requiredMinutes,
        })
        .from(workScheduleDays)
        .where(
          inArray(workScheduleDays.scheduleId, [...new Set(files.map((file) => file.scheduleId))]),
        ),
      this.holidays.from(from),
      this.leave.approved({ from, to, userIds: files.map((file) => file.userId) }),
    ]);
    for (const file of files) {
      const schedule = days.filter((day) => day.scheduleId === file.scheduleId);
      const weekdays = schedule.map((day) => day.weekday);
      let minutes = 0;
      for (let date = from; date <= to; date = addDays(date, 1)) {
        if (!isScheduleWorkDay(date, weekdays, holidays)) continue;
        const required = schedule.find((day) => day.weekday === weekdayOf(date))?.requiredMinutes;
        const away = leaves.find(
          (leave) => leave.userId === file.userId && leave.startsOn <= date && date <= leave.endsOn,
        );
        minutes += !away ? (required ?? 0) : away.half ? Math.floor((required ?? 0) / 2) : 0;
      }
      result.set(file.userId, minutes);
    }
    return result;
  }
}
