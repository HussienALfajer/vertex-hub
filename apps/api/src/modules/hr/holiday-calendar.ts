import { Inject, Injectable } from '@nestjs/common';
import type { CalendarDate, HolidayRange } from '@vertex-hub/contracts';
import { type Database, publicHolidays, type Transaction } from '@vertex-hub/db';
import { and, asc, gte, isNull, lte } from 'drizzle-orm';
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

  /** Rule B16: the non-archived holidays with a day in `[from, to]`, by start date. */
  async overlapping(
    from: CalendarDate,
    to: CalendarDate,
  ): Promise<{ id: string; name: string; startsOn: CalendarDate; endsOn: CalendarDate }[]> {
    return this.db
      .select({
        id: publicHolidays.id,
        name: publicHolidays.name,
        startsOn: publicHolidays.startsOn,
        endsOn: publicHolidays.endsOn,
      })
      .from(publicHolidays)
      .where(
        and(
          isNull(publicHolidays.archivedAt),
          lte(publicHolidays.startsOn, to),
          gte(publicHolidays.endsOn, from),
        ),
      )
      .orderBy(asc(publicHolidays.startsOn));
  }
}
