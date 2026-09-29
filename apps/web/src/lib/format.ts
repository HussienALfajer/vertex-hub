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

export function formatDate(value: Date | string): string {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: BUSINESS_TIME_ZONE,
  }).format(new Date(value));
}

export function formatTime(value: Date | string): string {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeStyle: 'short',
    timeZone: BUSINESS_TIME_ZONE,
  }).format(new Date(value));
}

/** The calendar day of an instant in the business timezone, as `YYYY-MM-DD` (for grouping). */
export function businessDay(value: Date | string): string {
  return toBusinessDateTimeInput(value).slice(0, 10);
}

/** A web link's host without `www.`, for showing a link compactly (`instagram.com`). */
export function formatLinkHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** A web link without its scheme, `www.` or trailing slash (`instagram.com/vertex`). */
export function formatLink(url: string): string {
  try {
    const { host, pathname } = new URL(url);
    return `${host.replace(/^www\./, '')}${pathname.replace(/\/$/, '')}`;
  } catch {
    return url;
  }
}

/**
 * Syria keeps UTC+3 all year (no daylight saving since 2022), so a calendar day in the business
 * timezone starts and ends at these instants.
 */
const BUSINESS_UTC_OFFSET = '+03:00';
const BUSINESS_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;

/** The first instant of a business day given as `YYYY-MM-DD`, as an ISO timestamp. */
export function businessDayStart(day: string): string {
  return new Date(`${day}T00:00:00${BUSINESS_UTC_OFFSET}`).toISOString();
}

/** The last instant of a business day given as `YYYY-MM-DD`, as an ISO timestamp. */
export function businessDayEnd(day: string): string {
  return new Date(`${day}T23:59:59.999${BUSINESS_UTC_OFFSET}`).toISOString();
}

/** An instant as the value of a `datetime-local` input in the business timezone (`YYYY-MM-DDTHH:mm`). */
export function toBusinessDateTimeInput(value: Date | string): string {
  const shifted = new Date(new Date(value).getTime() + BUSINESS_UTC_OFFSET_MS);
  return shifted.toISOString().slice(0, 16);
}

/** A `datetime-local` value entered in the business timezone, as an ISO timestamp. */
export function fromBusinessDateTimeInput(value: string): string {
  return new Date(`${value}:00${BUSINESS_UTC_OFFSET}`).toISOString();
}
