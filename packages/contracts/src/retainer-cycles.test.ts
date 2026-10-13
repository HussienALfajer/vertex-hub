import { describe, expect, it } from 'vitest';
import { cycleAt, cycleDaysLeft, cyclePeriod, termCycles, termEndDate } from './retainer-cycles.js';

describe('cyclePeriod (F05C Y1)', () => {
  it('runs from the anchor day to the day before it next month', () => {
    expect(cyclePeriod('2026-09-20', 1)).toEqual({
      periodStart: '2026-09-20',
      periodEnd: '2026-10-19',
    });
    expect(cyclePeriod('2026-09-20', 2)).toEqual({
      periodStart: '2026-10-20',
      periodEnd: '2026-11-19',
    });
    expect(cyclePeriod('2026-09-20', 5)).toEqual({
      periodStart: '2027-01-20',
      periodEnd: '2027-02-19',
    });
  });

  it('follows the calendar month for an anchor on the 1st or the 15th', () => {
    expect(cyclePeriod('2026-10-01', 1)).toEqual({
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
    });
    expect(cyclePeriod('2026-10-01', 5)).toEqual({
      periodStart: '2027-02-01',
      periodEnd: '2027-02-28',
    });
    expect(cyclePeriod('2026-01-15', 2)).toEqual({
      periodStart: '2026-02-15',
      periodEnd: '2026-03-14',
    });
  });

  it('clamps a missing day and returns to the anchor (edge case 1)', () => {
    const start = '2026-01-31';
    expect(cyclePeriod(start, 1)).toEqual({ periodStart: '2026-01-31', periodEnd: '2026-02-27' });
    expect(cyclePeriod(start, 2)).toEqual({ periodStart: '2026-02-28', periodEnd: '2026-03-30' });
    expect(cyclePeriod(start, 3)).toEqual({ periodStart: '2026-03-31', periodEnd: '2026-04-29' });
    expect(cyclePeriod(start, 4)).toEqual({ periodStart: '2026-04-30', periodEnd: '2026-05-30' });
  });

  it('handles anchors on the 28th, 29th and 30th', () => {
    expect(cyclePeriod('2026-01-28', 2)).toEqual({
      periodStart: '2026-02-28',
      periodEnd: '2026-03-27',
    });
    expect(cyclePeriod('2026-01-29', 1)).toEqual({
      periodStart: '2026-01-29',
      periodEnd: '2026-02-27',
    });
    expect(cyclePeriod('2026-01-29', 2)).toEqual({
      periodStart: '2026-02-28',
      periodEnd: '2026-03-28',
    });
    expect(cyclePeriod('2026-01-30', 2)).toEqual({
      periodStart: '2026-02-28',
      periodEnd: '2026-03-29',
    });
  });

  it('starts on 29 February in a leap year and on the 28th otherwise (edge case 2)', () => {
    const start = '2028-02-29';
    expect(cyclePeriod(start, 1)).toEqual({ periodStart: '2028-02-29', periodEnd: '2028-03-28' });
    expect(cyclePeriod(start, 2)).toEqual({ periodStart: '2028-03-29', periodEnd: '2028-04-28' });
    expect(cyclePeriod(start, 13)).toEqual({ periodStart: '2029-02-28', periodEnd: '2029-03-28' });
    expect(cyclePeriod('2028-01-31', 2)).toEqual({
      periodStart: '2028-02-29',
      periodEnd: '2028-03-30',
    });
  });

  it('crosses year ends', () => {
    expect(cyclePeriod('2026-12-20', 1)).toEqual({
      periodStart: '2026-12-20',
      periodEnd: '2027-01-19',
    });
    expect(cyclePeriod('2026-11-30', 3)).toEqual({
      periodStart: '2027-01-30',
      periodEnd: '2027-02-27',
    });
  });
});

describe('cycleAt (F05C Y2)', () => {
  it('is null before the start date', () => {
    expect(cycleAt('2026-09-20', '2026-09-19')).toBeNull();
    expect(cycleAt('2026-09-20', '2025-12-31')).toBeNull();
  });

  it('finds the cycle holding a date, edges included', () => {
    expect(cycleAt('2026-09-20', '2026-09-20')).toBe(1);
    expect(cycleAt('2026-09-20', '2026-10-19')).toBe(1);
    expect(cycleAt('2026-09-20', '2026-10-20')).toBe(2);
    expect(cycleAt('2026-09-20', '2026-10-31')).toBe(2);
    expect(cycleAt('2026-09-20', '2027-09-19')).toBe(12);
    expect(cycleAt('2026-09-20', '2027-09-20')).toBe(13);
  });

  it('agrees with cyclePeriod on every day, for every anchor kind', () => {
    for (const start of [
      '2026-01-01',
      '2026-01-15',
      '2026-01-28',
      '2026-01-29',
      '2026-01-30',
      '2026-01-31',
      '2028-02-29',
    ]) {
      for (let n = 1; n <= 26; n += 1) {
        const { periodStart, periodEnd } = cyclePeriod(start, n);
        expect(cycleAt(start, periodStart)).toBe(n);
        expect(cycleAt(start, periodEnd)).toBe(n);
        expect(periodEnd >= periodStart).toBe(true);
        // Periods follow each other without a gap.
        const next = cyclePeriod(start, n + 1).periodStart;
        expect(cycleAt(start, next)).toBe(n + 1);
      }
    }
  });
});

describe("terms in cycles (F05C T1')", () => {
  it('ends on the last day of its last cycle', () => {
    expect(termEndDate('2026-09-20', 3, 3)).toBe('2027-02-19');
    expect(termEndDate('2026-09-20', 1, 1)).toBe('2026-10-19');
    expect(termEndDate('2026-01-31', 1, 2)).toBe('2026-03-30');
    expect(termEndDate('2026-10-01', 1, 12)).toBe('2027-09-30');
  });

  it('lists its cycle numbers', () => {
    expect(termCycles(3, 3)).toEqual([3, 4, 5]);
    expect(termCycles(1, 1)).toEqual([1]);
  });
});

describe('cycleDaysLeft (F05C Y6)', () => {
  const period = { periodStart: '2026-10-20', periodEnd: '2026-11-19' };

  it('counts today and the days after it', () => {
    expect(cycleDaysLeft(period, '2026-11-14')).toBe(6);
    expect(cycleDaysLeft(period, '2026-11-19')).toBe(1);
    expect(cycleDaysLeft(period, '2026-10-20')).toBe(31);
  });

  it('is 0 once ended and the whole period before it starts', () => {
    expect(cycleDaysLeft(period, '2026-11-20')).toBe(0);
    expect(cycleDaysLeft(period, '2026-10-01')).toBe(31);
  });
});
