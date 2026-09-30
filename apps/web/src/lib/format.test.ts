import { describe, expect, it } from 'vitest';
import {
  businessDay,
  businessDayEnd,
  businessDayStart,
  formatCalendarDate,
  formatDateTime,
  formatLink,
  formatLinkHost,
  formatList,
  formatMonth,
  formatNumber,
  formatRelativeTime,
  formatTimeOfDay,
  fromBusinessDateTimeInput,
  toBusinessDateTimeInput,
} from './format';

const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/;

describe('formatting', () => {
  it('formats numbers with Latin digits', () => {
    const formatted = formatNumber(1234567.5);
    expect(formatted).not.toMatch(ARABIC_INDIC_DIGITS);
    expect(formatted.replace(/\D/g, '')).toBe('12345675');
  });

  it('formats a stored time of day as it is, with Latin digits', () => {
    const formatted = formatTimeOfDay('16:05');
    expect(formatted).not.toMatch(ARABIC_INDIC_DIGITS);
    expect(formatted).toContain('4:05');
  });

  it('formats date-times with Latin digits in the business timezone', () => {
    // 21:30 UTC is 00:30 the next day in Damascus (UTC+3).
    const formatted = formatDateTime('2026-09-28T21:30:00.000Z');
    expect(formatted).not.toMatch(ARABIC_INDIC_DIGITS);
    expect(formatted).toContain('29');
    expect(formatted).toContain('12:30');
  });

  it('turns a business day into its UTC bounds', () => {
    expect(businessDayStart('2026-09-28')).toBe('2026-09-27T21:00:00.000Z');
    expect(businessDayEnd('2026-09-28')).toBe('2026-09-28T20:59:59.999Z');
  });

  it('round-trips a datetime-local value through the business timezone', () => {
    expect(toBusinessDateTimeInput('2026-09-28T21:30:00.000Z')).toBe('2026-09-29T00:30');
    expect(fromBusinessDateTimeInput('2026-09-29T00:30')).toBe('2026-09-28T21:30:00.000Z');
    expect(businessDay('2026-09-28T21:30:00.000Z')).toBe('2026-09-29');
  });

  it('shows a link by its host', () => {
    expect(formatLinkHost('https://www.instagram.com/vertex')).toBe('instagram.com');
    expect(formatLinkHost('not a url')).toBe('not a url');
    expect(formatLink('https://www.instagram.com/vertex/')).toBe('instagram.com/vertex');
    expect(formatLink('https://vertex.example')).toBe('vertex.example');
  });

  it('formats a calendar day as that same day, with Latin digits', () => {
    const formatted = formatCalendarDate('2026-10-01');
    expect(formatted).not.toMatch(ARABIC_INDIC_DIGITS);
    expect(formatted).toMatch(/^1 .+ 2026$/);
  });

  it('formats a month from its first day without moving it to the month before', () => {
    const formatted = formatMonth('2026-10-01');
    expect(formatted).not.toMatch(ARABIC_INDIC_DIGITS);
    expect(formatted).toBe(formatMonth('2026-10-31'));
    expect(formatted).not.toBe(formatMonth('2026-09-30'));
    expect(formatted).toMatch(/2026$/);
  });

  it('says how long ago an instant was, then the date after a week', () => {
    const now = new Date('2026-10-10T12:00:00Z');
    const ago = (seconds: number) =>
      formatRelativeTime(new Date(now.getTime() - seconds * 1000), now);
    expect(ago(20)).toBe(formatRelativeTime(now, now));
    expect(ago(5 * 60)).toMatch(/5/);
    expect(ago(3 * 60 * 60)).toMatch(/3/);
    expect(ago(3 * 60 * 60)).not.toBe(ago(3 * 60));
    expect(ago(8 * 24 * 60 * 60)).toBe(formatDateTime('2026-10-02T12:00:00Z'));
    expect(ago(5 * 60)).not.toMatch(ARABIC_INDIC_DIGITS);
  });

  it('writes moments like calendar dates, with the month names read in Damascus', () => {
    // 10:00 UTC is 13:00 in Damascus.
    expect(formatDateTime('2026-09-20T10:00:00Z')).toBe('20 أيلول 2026 في 1:00 م');
    expect(formatCalendarDate('2026-10-05')).toContain('تشرين الأول');
  });

  it('joins names as Arabic lists them', () => {
    expect(formatList(['أ', 'ب', 'ج'])).toBe('أ وب وج');
  });
});
