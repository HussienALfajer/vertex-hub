import { describe, expect, it } from 'vitest';
import {
  businessDay,
  businessDayEnd,
  businessDayStart,
  formatCalendarDate,
  formatDateTime,
  formatLink,
  formatLinkHost,
  formatNumber,
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
});
