import { addDays, addMonths, type CalendarDate, daysInclusive } from './dates.js';

/**
 * Retainer cycles anchored on the start date (spec F05C, ADR 0030). Every function that names a
 * cycle goes through `cyclePeriod` and `cycleAt`; nothing else computes periods.
 */

export interface CyclePeriod {
  periodStart: CalendarDate;
  periodEnd: CalendarDate;
}

/**
 * Cycle `n` (1, 2, 3…) of a retainer starting on `startDate`: from `startDate` + (n − 1) months
 * to the day before `startDate` + n months. Months are always added to the start date, so a day
 * clamped to a month's end returns the month after (31 Jan → 31 Jan–27 Feb, 28 Feb–30 Mar).
 */
export function cyclePeriod(startDate: CalendarDate, n: number): CyclePeriod {
  return {
    periodStart: addMonths(startDate, n - 1),
    periodEnd: addDays(addMonths(startDate, n), -1),
  };
}

/** The number of the cycle whose period holds `date`; null before the start date. */
export function cycleAt(startDate: CalendarDate, date: CalendarDate): number | null {
  if (date < startDate) return null;
  const [startYear, startMonth] = startDate.split('-').map(Number) as [number, number];
  const [year, month] = date.split('-').map(Number) as [number, number];
  // The cycle starting in the month of `date`, or the one before it when that starts later.
  const months = (year - startYear) * 12 + month - startMonth;
  return addMonths(startDate, months) <= date ? months + 1 : months;
}

/** F05C T1': the last day of a term of `cycles` cycles from `startCycle`. */
export function termEndDate(
  startDate: CalendarDate,
  startCycle: number,
  cycles: number,
): CalendarDate {
  return cyclePeriod(startDate, startCycle + cycles - 1).periodEnd;
}

/** The cycle numbers of a term, in order. */
export function termCycles(startCycle: number, cycles: number): number[] {
  return Array.from({ length: cycles }, (_, index) => startCycle + index);
}

/** Days left in a period on `today`, today included; 0 once it has ended. */
export function cycleDaysLeft(period: CyclePeriod, today: CalendarDate): number {
  return daysInclusive(today < period.periodStart ? period.periodStart : today, period.periodEnd);
}

/** F05C Y2: the current cycle of a retainer on `today`; 0 before its start date. */
export function currentCycleNumber(startDate: CalendarDate, today: CalendarDate): number {
  return cycleAt(startDate, today) ?? 0;
}
