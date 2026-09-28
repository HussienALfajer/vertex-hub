/** Arabic locale with Latin digits (open question Q3, resolved: Latin digits in the UI). */
export const APP_LOCALE = 'ar-u-nu-latn';

/** Timestamps are stored in UTC and displayed in the business timezone. */
export const BUSINESS_TIME_ZONE = 'Asia/Damascus';

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(APP_LOCALE, options).format(value);
}

export function formatDateTime(value: Date | string): string {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: BUSINESS_TIME_ZONE,
  }).format(new Date(value));
}

/**
 * Syria keeps UTC+3 all year (no daylight saving since 2022), so a calendar day in the business
 * timezone starts and ends at these instants.
 */
const BUSINESS_UTC_OFFSET = '+03:00';

/** The first instant of a business day given as `YYYY-MM-DD`, as an ISO timestamp. */
export function businessDayStart(day: string): string {
  return new Date(`${day}T00:00:00${BUSINESS_UTC_OFFSET}`).toISOString();
}

/** The last instant of a business day given as `YYYY-MM-DD`, as an ISO timestamp. */
export function businessDayEnd(day: string): string {
  return new Date(`${day}T23:59:59.999${BUSINESS_UTC_OFFSET}`).toISOString();
}
