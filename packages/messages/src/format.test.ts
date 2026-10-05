import { describe, expect, it } from 'vitest';
import {
  formatAmount,
  formatCalendarDate,
  formatDateTime,
  formatList,
  formatNumber,
  formatTimeOfDay,
} from './format.js';
import { fill, plural } from './text.js';

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

  it('formats a calendar day as that same day, with Latin digits', () => {
    const formatted = formatCalendarDate('2026-10-01');
    expect(formatted).not.toMatch(ARABIC_INDIC_DIGITS);
    expect(formatted).toMatch(/^1 .+ 2026$/);
  });

  it('writes moments like calendar dates, with the month names read in Damascus', () => {
    // 10:00 UTC is 13:00 in Damascus.
    expect(formatDateTime('2026-09-20T10:00:00Z')).toBe('20 أيلول 2026 في 1:00 م');
    expect(formatCalendarDate('2026-10-05')).toContain('تشرين الأول');
  });

  it('joins names as Arabic lists them', () => {
    expect(formatList(['أ', 'ب', 'ج'])).toBe('أ وب وج');
  });

  it('formats a bare amount in major units', () => {
    expect(formatAmount(150_000)).toBe('1,500.00');
    expect(formatAmount(7)).toBe('0.07');
  });
});

describe('texts', () => {
  it('fills placeholders and leaves unknown ones empty', () => {
    expect(fill('«{{task}}» من {{actor}}', { task: 'تصميم', actor: 'رنا' })).toBe('«تصميم» من رنا');
    expect(fill('{{missing}}!')).toBe('!');
  });

  it('picks the Arabic plural form of a count', () => {
    const forms = { zero: '0', one: '1', two: '2', few: 'few', many: 'many', other: 'other' };
    expect([0, 1, 2, 3, 10, 11, 99, 100].map((count) => plural(forms, count))).toEqual([
      '0',
      '1',
      '2',
      'few',
      'few',
      'many',
      'many',
      'other',
    ]);
  });
});
