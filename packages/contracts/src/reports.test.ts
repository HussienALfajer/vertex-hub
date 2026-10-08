import { describe, expect, it } from 'vitest';
import { responseTimeText } from './report-labels.js';
import {
  agingBucket,
  averageOf,
  conversionRate,
  daysOverdue,
  deliveredOnTime,
  isApprovalWaiting,
  isFutureMonth,
  isPreliminaryMonth,
  isValidReportPeriod,
  monthPeriod,
  onTimeRate,
  reportMonths,
  responseTime,
  splitLargestRemainder,
  splitRevenue,
  updateClientReportSummarySchema,
} from './reports.js';

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

describe('report periods and months (F15 rules 8, 11 and 17)', () => {
  it('accepts up to 366 days with to on or after from', () => {
    expect(isValidReportPeriod({ from: '2026-01-01', to: '2026-01-01' })).toBe(true);
    expect(isValidReportPeriod({ from: '2026-01-01', to: '2027-01-01' })).toBe(true);
    expect(isValidReportPeriod({ from: '2026-01-01', to: '2027-01-02' })).toBe(false);
    expect(isValidReportPeriod({ from: '2026-02-02', to: '2026-02-01' })).toBe(false);
  });

  it('turns a month into its days, a leap February included', () => {
    expect(monthPeriod('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthPeriod('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('refuses months after the current one and marks the current one preliminary', () => {
    expect(isFutureMonth('2026-11', '2026-10-31')).toBe(true);
    expect(isFutureMonth('2026-10', '2026-10-31')).toBe(false);
    expect(isFutureMonth('2025-12', '2026-10-31')).toBe(false);
    expect(isPreliminaryMonth('2026-10', '2026-10-01')).toBe(true);
    expect(isPreliminaryMonth('2026-09', '2026-10-01')).toBe(false);
  });

  it('trims the summary and keeps it within 4000 characters', () => {
    const parsed = updateClientReportSummarySchema.parse({ month: '2026-09', summary: '  نص  ' });
    expect(parsed.summary).toBe('نص');
    expect(
      updateClientReportSummarySchema.safeParse({ month: '2026-09', summary: 'a'.repeat(4001) })
        .success,
    ).toBe(false);
    expect(
      updateClientReportSummarySchema.safeParse({ month: '2026-13', summary: '' }).success,
    ).toBe(false);
  });
});

describe('productivity measures (F15 rule 10)', () => {
  it('is on time up to the end of the due date in Damascus without a due time', () => {
    const task = { dueDate: '2026-09-10', dueTime: null };
    // 23:30 in Damascus (UTC+3) on the due date.
    expect(deliveredOnTime(new Date('2026-09-10T20:30:00Z'), task)).toBe(true);
    // 00:30 the next day in Damascus.
    expect(deliveredOnTime(new Date('2026-09-10T21:30:00Z'), task)).toBe(false);
  });

  it('is on time up to the due time when set', () => {
    const task = { dueDate: '2026-09-10', dueTime: '14:00:00' };
    expect(deliveredOnTime(new Date('2026-09-10T11:00:00Z'), task)).toBe(true);
    expect(deliveredOnTime(new Date('2026-09-10T11:00:01Z'), task)).toBe(false);
  });

  it('gives whole percents and one-decimal averages, empty as null', () => {
    expect(onTimeRate(2, 3)).toBe(67);
    expect(onTimeRate(0, 0)).toBeNull();
    expect(averageOf(5, 3)).toBe(1.7);
    expect(averageOf(0, 4)).toBe(0);
    expect(averageOf(3, 0)).toBeNull();
  });
});

describe('splitLargestRemainder (F15 money split)', () => {
  it('always adds up to the whole', () => {
    expect(splitLargestRemainder(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(splitLargestRemainder(10_001, [3, 7])).toEqual([3000, 7001]);
    expect(splitLargestRemainder(5, [0, 2])).toEqual([0, 5]);
  });

  it('gives ties to the earlier weight and refuses all-zero weights', () => {
    expect(splitLargestRemainder(1, [1, 1])).toEqual([1, 0]);
    expect(splitLargestRemainder(10, [0, 0])).toBeNull();
    expect(splitLargestRemainder(10, [])).toBeNull();
  });
});

describe('splitRevenue (F15 rule 14)', () => {
  it('splits by line totals, then by quote lines in proportion to their totals', () => {
    const result = splitRevenue(10_000, [
      { totalMinor: 600, targets: [{ key: 'service:a', weight: 1 }] },
      {
        totalMinor: 400,
        targets: [
          { key: 'service:b', weight: 300 },
          { key: 'package:p', weight: 100 },
        ],
      },
    ]);
    expect(Object.fromEntries(result)).toEqual({
      'service:a': 6000,
      'service:b': 3000,
      'package:p': 1000,
    });
  });

  it('sends lines without targets, or with zero-priced quotes, to Unclassified', () => {
    const result = splitRevenue(999, [
      { totalMinor: 1, targets: [] },
      { totalMinor: 1, targets: [{ key: 'service:a', weight: 0 }] },
      { totalMinor: 1, targets: [{ key: 'service:a', weight: 5 }] },
    ]);
    expect(result.get(null)).toBe(666);
    expect(result.get('service:a')).toBe(333);
    expect([...result.values()].reduce((a, b) => a + b, 0)).toBe(999);
  });

  it('keeps an amount without line totals whole, as Unclassified', () => {
    expect(splitRevenue(50, [{ totalMinor: 0, targets: [] }]).get(null)).toBe(50);
  });
});

describe('overdue aging (F15 rule 16)', () => {
  it('counts days past the due date', () => {
    expect(daysOverdue('2026-09-30', '2026-10-01')).toBe(1);
    expect(daysOverdue('2026-10-01', '2026-10-01')).toBe(0);
  });

  it('puts days in buckets', () => {
    expect(agingBucket(1)).toBe('1_30');
    expect(agingBucket(30)).toBe('1_30');
    expect(agingBucket(31)).toBe('31_60');
    expect(agingBucket(60)).toBe('31_60');
    expect(agingBucket(61)).toBe('61_90');
    expect(agingBucket(90)).toBe('61_90');
    expect(agingBucket(91)).toBe('over_90');
  });
});

describe('responseTime (F15 rule 18.7)', () => {
  it('shows hours under two days, else days', () => {
    expect(responseTime(5.04)).toEqual({ unit: 'hours', value: 5 });
    expect(responseTime(47.9)).toEqual({ unit: 'hours', value: 47.9 });
    expect(responseTime(48)).toEqual({ unit: 'days', value: 2 });
    expect(responseTime(90)).toEqual({ unit: 'days', value: 3.8 });
  });
});

describe('responseTimeText (F15 rule 18.7, report files)', () => {
  it('prints Arabic plurals, and under an hour when it rounds to none', () => {
    expect(responseTimeText(0.01)).toBe('أقل من ساعة');
    expect(responseTimeText(1)).toBe('ساعة واحدة');
    expect(responseTimeText(2)).toBe('ساعتان');
    expect(responseTimeText(3)).toBe('3 ساعات');
    expect(responseTimeText(11)).toBe('11 ساعة');
    expect(responseTimeText(5.4)).toBe('5.4 ساعة');
    expect(responseTimeText(48)).toBe('يومان');
    expect(responseTimeText(72)).toBe('3 أيام');
    expect(responseTimeText(90)).toBe('3.8 يوم');
  });
});
