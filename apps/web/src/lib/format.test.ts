import { describe, expect, it } from 'vitest';
import {
  businessDay,
  businessDayEnd,
  businessDayStart,
  formatDateTime,
  formatFileSize,
  formatLink,
  formatLinkHost,
  formatMonth,
  formatRelativeTime,
  formatWeekday,
  formatWeekdayDate,
  fromBusinessDateTimeInput,
  toBusinessDateTimeInput,
} from './format';

const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/;

describe('formatting', () => {
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

  it('names the weekday of a calendar day, and the day without its year', () => {
    // 3 October 2026 is a Saturday, the first day of the work week (ADR 0016).
    expect(formatWeekday('2026-10-03')).toBe('السبت');
    expect(formatWeekday('2026-10-09')).toBe('الجمعة');
    const formatted = formatWeekdayDate('2026-10-03');
    expect(formatted).not.toMatch(ARABIC_INDIC_DIGITS);
    expect(formatted).toContain('السبت');
    expect(formatted).toContain('3');
    expect(formatted).not.toContain('2026');
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

  it('formats file sizes in 1024 steps with Latin digits', () => {
    expect(formatFileSize(512).replace(/\D/g, '')).toBe('512');
    expect(formatFileSize(1536).replace(/\D/g, '')).toBe('2');
    const mega = formatFileSize(1.25 * 1024 * 1024);
    expect(mega).not.toMatch(ARABIC_INDIC_DIGITS);
    expect(mega).toContain('1.3');
    expect(formatFileSize(3 * 1024 ** 4)).toContain('3,072');
  });
});
