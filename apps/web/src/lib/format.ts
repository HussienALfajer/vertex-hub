import {
  addDays,
  BUSINESS_TIME_ZONE,
  businessDate,
  businessInstant,
  businessTimeOfDay,
} from '@vertex-hub/contracts';

/**
 * Arabic as read in Damascus (Levantine month names: أيلول، تشرين الأول) with Latin digits (open
 * question Q3, resolved: Latin digits in the UI; month names: owner decision 2026-09-30).
 */
export const APP_LOCALE = 'ar-SY-u-nu-latn';

/** Timestamps are stored in UTC and displayed in the business timezone. */
export { BUSINESS_TIME_ZONE };

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(APP_LOCALE, options).format(value);
}

/** A moment, in the same day-month-year style as calendar dates: "20 أيلول 2026 في 1:00 م". */
export function formatDateTime(value: Date | string): string {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: BUSINESS_TIME_ZONE,
  }).format(new Date(value));
}

/**
 * Left-to-right text (a phone number) inside an Arabic sentence that cannot carry `dir="ltr"`, as
 * in a select option: Unicode isolates keep its "+" in front.
 */
export function isolateLtr(text: string): string {
  return `${String.fromCodePoint(0x2066)}${text}${String.fromCodePoint(0x2069)}`;
}

/** Names joined as Arabic lists them: "أ وب وج". */
export function formatList(items: readonly string[]): string {
  return new Intl.ListFormat(APP_LOCALE, { type: 'conjunction' }).format(items);
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

const RELATIVE_STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['minute', 60],
  ['hour', 60 * 60],
  ['day', 24 * 60 * 60],
];

/**
 * How long ago an instant was, e.g. "الآن", "قبل 5 دقائق", "أمس"; after a week, the date and
 * time instead.
 */
export function formatRelativeTime(value: Date | string, now: Date = new Date()): string {
  const seconds = Math.max(0, (now.getTime() - new Date(value).getTime()) / 1000);
  if (seconds >= 7 * 24 * 60 * 60) return formatDateTime(value);
  const format = new Intl.RelativeTimeFormat(APP_LOCALE, { numeric: 'auto' });
  if (seconds < 60) return format.format(0, 'second');
  const [unit, size] = RELATIVE_STEPS.findLast(([, step]) => seconds >= step) ?? ['minute', 60];
  return format.format(-Math.floor(seconds / size), unit);
}

/** A time of day stored without a date (`HH:MM`, already business-timezone time), e.g. "4:00 م". */
export function formatTimeOfDay(time: string): string {
  return new Intl.DateTimeFormat(APP_LOCALE, { timeStyle: 'short', timeZone: 'UTC' }).format(
    new Date(`1970-01-01T${time}:00Z`),
  );
}

/**
 * A calendar day stored without a time (`YYYY-MM-DD`, already a business-timezone day), e.g.
 * "5 أكتوبر 2026". Read as UTC so no timezone shift can move it to another day.
 */
export function formatCalendarDate(day: string): string {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}

/** A calendar month from any of its days (`YYYY-MM-DD`), e.g. "أكتوبر 2026". */
export function formatMonth(day: string): string {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}

/** The weekday of a calendar day (`YYYY-MM-DD`), e.g. "السبت". */
export function formatWeekday(day: string, style: 'long' | 'short' = 'long'): string {
  return new Intl.DateTimeFormat(APP_LOCALE, { weekday: style, timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  );
}

/** A calendar day with its weekday, without the year, e.g. "السبت، 3 تشرين الأول". */
export function formatWeekdayDate(day: string): string {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}

/** The calendar day of an instant in the business timezone, as `YYYY-MM-DD` (for grouping). */
export function businessDay(value: Date | string): string {
  return toBusinessDateTimeInput(value).slice(0, 10);
}

const SIZE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;

/** A file size in the largest unit that keeps it at 1 or more (1024 steps), e.g. "1.2 ميغابايت". */
export function formatFileSize(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return formatNumber(value, {
    style: 'unit',
    unit: SIZE_UNITS[unit],
    unitDisplay: 'long',
    maximumFractionDigits: unit < 2 ? 0 : 1,
  });
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

/** The first instant of a business day given as `YYYY-MM-DD`, as an ISO timestamp. */
export function businessDayStart(day: string): string {
  return businessInstant(day, '00:00').toISOString();
}

/** The last instant of a business day given as `YYYY-MM-DD`, as an ISO timestamp. */
export function businessDayEnd(day: string): string {
  return new Date(businessInstant(addDays(day, 1), '00:00').getTime() - 1).toISOString();
}

/** An instant as the value of a `datetime-local` input in the business timezone (`YYYY-MM-DDTHH:mm`). */
export function toBusinessDateTimeInput(value: Date | string): string {
  const instant = new Date(value);
  return `${businessDate(instant)}T${businessTimeOfDay(instant).slice(0, 5)}`;
}

/** A `datetime-local` value entered in the business timezone, as an ISO timestamp. */
export function fromBusinessDateTimeInput(value: string): string {
  return businessInstant(value.slice(0, 10), value.slice(11, 16)).toISOString();
}
