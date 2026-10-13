import { BUSINESS_TIME_ZONE, type Currency } from '@vertex-hub/contracts';

/*
 * The formatters the notification texts use, shared by the web app and the emails (ADR 0028). The
 * web app re-exports them from `src/lib/format.ts` and `src/lib/money.ts`.
 */

/**
 * Arabic as read in Damascus (Levantine month names: أيلول، تشرين الأول) with Latin digits (open
 * question Q3, resolved: Latin digits in the UI; month names: owner decision 2026-09-30).
 */
export const APP_LOCALE = 'ar-SY-u-nu-latn';

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

/** Names joined as Arabic lists them: "أ وب وج". */
export function formatList(items: readonly string[]): string {
  return new Intl.ListFormat(APP_LOCALE, { type: 'conjunction' }).format(items);
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

/** Both V1 currencies use 2 decimal places, so amounts are kept in hundredths (ADR 0006). */
const MINOR_PER_UNIT = 100;

/** An amount in minor units without its currency, e.g. `1,500.00`, where the code is not at hand. */
export function formatAmount(minor: number): string {
  return new Intl.NumberFormat(APP_LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / MINOR_PER_UNIT);
}

/** An amount in minor units with its currency code, e.g. `1,500.00 USD`. */
export function formatMoney(minor: number, currency: Currency): string {
  return new Intl.NumberFormat(APP_LOCALE, {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / MINOR_PER_UNIT);
}

/** A `YYYY-MM` month, e.g. "تشرين الأول 2026". */
export function formatMonth(month: string): string {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));
}

const dayAndMonth = new Intl.DateTimeFormat(APP_LOCALE, {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

/**
 * A period of calendar days, the year once when both ends share it: "20 تشرين الأول – 19 تشرين
 * الثاني 2026", "20 كانون الأول 2026 – 19 كانون الثاني 2027" (spec F05C, Screens).
 */
export function formatPeriod(start: string, end: string): string {
  if (start.slice(0, 4) !== end.slice(0, 4)) {
    return `${formatCalendarDate(start)} – ${formatCalendarDate(end)}`;
  }
  return `${dayAndMonth.format(new Date(`${start}T00:00:00Z`))} – ${formatCalendarDate(end)}`;
}

/**
 * F05C J3: a retainer cycle as invoice lines name it, "الدورة 7 (20 تشرين الأول – 19 تشرين
 * الثاني 2026)", with " (3 من 6)" for a term cycle.
 */
export function formatRetainerCycle(
  cycle: { number: number; periodStart: string; periodEnd: string },
  term?: { position: number; cycles: number } | null,
): string {
  const label = `الدورة ${formatNumber(cycle.number)} (${formatPeriod(cycle.periodStart, cycle.periodEnd)})`;
  return term ? `${label} (${formatNumber(term.position)} من ${formatNumber(term.cycles)})` : label;
}

/** F05C B3: the settle note of a backdated cycle's charge billed outside the system. */
export const RETAINER_BILLED_OUTSIDE_NOTE = 'فوترت خارج النظام';
