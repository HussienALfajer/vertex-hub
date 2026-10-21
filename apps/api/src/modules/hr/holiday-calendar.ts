import { Inject, Injectable } from '@nestjs/common';
import type { CalendarDate, HolidayRange } from '@vertex-hub/contracts';
import { type Database, publicHolidays, type Transaction } from '@vertex-hub/db';
import { and, asc, gte, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';

/**
 * Rule B1 (ADR 0039): the public holidays as work-day input for other modules, through
 * `isWorkDay(date, holidays)` and the work-day functions of `@vertex-hub/contracts`.
 */
@Injectable()
export class HolidayCalendar {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** The non-archived holidays ending on or after `from`, by start date. */
  async from(
    from: CalendarDate,
    executor: Database | Transaction = this.db,
  ): Promise<HolidayRange[]> {
    return executor
      .select({ startsOn: publicHolidays.startsOn, endsOn: publicHolidays.endsOn })
      .from(publicHolidays)
      .where(and(isNull(publicHolidays.archivedAt), gte(publicHolidays.endsOn, from)))
      .orderBy(asc(publicHolidays.startsOn));
  }
}
