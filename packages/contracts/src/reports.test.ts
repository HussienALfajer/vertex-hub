import { describe, expect, it } from 'vitest';
import { conversionRate, isApprovalWaiting, reportMonths } from './reports.js';

describe('reportMonths (F15 rule 6)', () => {
  it('runs this month to today and last month whole', () => {
    expect(reportMonths('2026-10-04')).toEqual({
      thisMonth: { from: '2026-10-01', to: '2026-10-04' },
      lastMonth: { from: '2026-09-01', to: '2026-09-30' },
    });
  });

  it('crosses the year and handles short months', () => {
    expect(reportMonths('2027-01-31').lastMonth).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(reportMonths('2028-03-31').lastMonth).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});

describe('conversionRate (F15 rule 1)', () => {
  it('is won over won plus lost, whole percent', () => {
    expect(conversionRate(1, 2)).toBe(33);
    expect(conversionRate(2, 1)).toBe(67);
    expect(conversionRate(3, 0)).toBe(100);
    expect(conversionRate(0, 4)).toBe(0);
  });

  it('is null when no lead closed', () => {
    expect(conversionRate(0, 0)).toBeNull();
  });
});

describe('isApprovalWaiting (F15 rule 1)', () => {
  const now = new Date('2026-10-04T12:00:00Z');

  it('counts links issued more than 48 hours ago', () => {
    expect(isApprovalWaiting(new Date('2026-10-02T11:59:59Z'), now)).toBe(true);
    expect(isApprovalWaiting(new Date('2026-10-02T12:00:00Z'), now)).toBe(false);
    expect(isApprovalWaiting(new Date('2026-10-04T08:00:00Z'), now)).toBe(false);
  });
});
