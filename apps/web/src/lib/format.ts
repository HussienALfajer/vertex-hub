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
