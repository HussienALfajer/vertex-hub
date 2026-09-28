import { describe, expect, it } from 'vitest';
import { formatDateTime, formatNumber } from './format';

const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/;

describe('formatting', () => {
  it('formats numbers with Latin digits', () => {
    const formatted = formatNumber(1234567.5);
    expect(formatted).not.toMatch(ARABIC_INDIC_DIGITS);
    expect(formatted.replace(/\D/g, '')).toBe('12345675');
  });

  it('formats date-times with Latin digits in the business timezone', () => {
    // 21:30 UTC is 00:30 the next day in Damascus (UTC+3).
    const formatted = formatDateTime('2026-09-28T21:30:00.000Z');
    expect(formatted).not.toMatch(ARABIC_INDIC_DIGITS);
    expect(formatted).toContain('29');
    expect(formatted).toContain('12:30');
  });
});
