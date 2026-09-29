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
