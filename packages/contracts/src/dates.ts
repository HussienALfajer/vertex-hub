import { z } from 'zod';

/** A calendar day without a time, as `YYYY-MM-DD`, in the business timezone (Asia/Damascus). */
export const calendarDateSchema = z.iso.date();

export type CalendarDate = z.infer<typeof calendarDateSchema>;

/** Syria keeps UTC+3 all year (no daylight saving since 2022). */
const BUSINESS_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;

/** The calendar day of an instant in Asia/Damascus, as `YYYY-MM-DD` (spec F05 edge case 16). */
export function businessDate(now: Date = new Date()): CalendarDate {
  return new Date(now.getTime() + BUSINESS_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

const DAY_MS = 24 * 60 * 60 * 1000;

const dayNumber = (date: CalendarDate) => Math.floor(Date.parse(date) / DAY_MS);

/** Days from `from` to `to`, both included; 0 when `to` is before `from`. */
export function daysInclusive(from: CalendarDate, to: CalendarDate): number {
  return Math.max(0, dayNumber(to) - dayNumber(from) + 1);
}

/** `date` moved by `days` (negative moves back). */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  return new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10);
}

/** The first day of the calendar month of `date`. */
export function firstOfMonth(date: CalendarDate): CalendarDate {
  return `${date.slice(0, 7)}-01`;
}

/** The last day of the calendar month of `date`. */
export function lastOfMonth(date: CalendarDate): CalendarDate {
  const [year, month] = date.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/**
 * The agency's work week (ADR 0016): Saturday to Thursday, Friday off; a week starts on
 * Saturday. Days are numbered like `Date.getUTCDay()` (0 = Sunday).
 */
export const WORK_WEEK = { startsOn: 6, weekend: [5] } as const;

/** The day of the week of `date`, 0 = Sunday. */
export function weekday(date: CalendarDate): number {
  return new Date(dayNumber(date) * DAY_MS).getUTCDay();
}

/** The first day (a Saturday) and the last day (a Friday) of the week holding `date`. */
export function weekOf(date: CalendarDate): { from: CalendarDate; to: CalendarDate } {
  const from = addDays(date, -((weekday(date) - WORK_WEEK.startsOn + 7) % 7));
  return { from, to: addDays(from, 6) };
}

/** A time of day without seconds, as `HH:MM`, in Asia/Damascus. */
export const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');

export type TimeOfDay = z.infer<typeof timeOfDaySchema>;

/** The instant a calendar day and time of day in Asia/Damascus stand for. */
export function businessInstant(date: CalendarDate, time: TimeOfDay): Date {
  return new Date(Date.parse(`${date}T${time}:00Z`) - BUSINESS_UTC_OFFSET_MS);
}
