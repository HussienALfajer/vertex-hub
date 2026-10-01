import {
  addDays,
  type CalendarDate,
  firstOfMonth,
  lastOfMonth,
  weekOf,
} from '@vertex-hub/contracts';

/** The calendar shows a month as rows of weeks, or one week (spec F08, screen 1). */
export const CALENDAR_VIEWS = ['month', 'week'] as const;

export type CalendarView = (typeof CALENDAR_VIEWS)[number];

/**
 * The days a view shows around `date`: the week holding it, or every week touching its month, so
 * the grid starts on a Saturday and ends on a Friday (ADR 0016). At most 42 days.
 */
export function calendarRange(
  view: CalendarView,
  date: CalendarDate,
): { from: CalendarDate; to: CalendarDate } {
  if (view === 'week') return weekOf(date);
  return { from: weekOf(firstOfMonth(date)).from, to: weekOf(lastOfMonth(date)).to };
}

/** Every day from `from` to `to`, in order. */
export function daysBetween(from: CalendarDate, to: CalendarDate): CalendarDate[] {
  const days: CalendarDate[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

/** The day the view shows after one step back or forward: the same weekday, or the month's first. */
export function shiftCalendar(view: CalendarView, date: CalendarDate, step: 1 | -1): CalendarDate {
  if (view === 'week') return addDays(date, 7 * step);
  return step === 1 ? addDays(lastOfMonth(date), 1) : firstOfMonth(addDays(firstOfMonth(date), -1));
}

/** Whether two days fall in the same calendar month. */
export const sameMonth = (a: CalendarDate, b: CalendarDate): boolean =>
  a.slice(0, 7) === b.slice(0, 7);
