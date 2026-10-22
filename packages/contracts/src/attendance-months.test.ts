import { describe, expect, it } from 'vitest';
import {
  leaveUnitsPay,
  monthEnded,
  monthRange,
  monthsOf,
  monthTotals,
  reopenMonthSchema,
  type TotalsDay,
} from './index.js';

const day = (rest: Partial<TotalsDay> = {}): TotalsDay => ({
  kind: 'work',
  status: 'present',
  place: 'office',
  leave: 'none',
  checkedIn: true,
  workedMinutes: 480,
  field: false,
  ...rest,
});

describe('month ranges', () => {
  it('gives the first and last date of a month', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('lists the months a range touches (edge case 13)', () => {
    expect(monthsOf('2026-10-15', '2026-10-20')).toEqual(['2026-10']);
    expect(monthsOf('2026-12-30', '2027-02-01')).toEqual(['2026-12', '2027-01', '2027-02']);
  });

  it('ends a month once its last day has passed (rule D2)', () => {
    expect(monthEnded('2026-10', '2026-10-31')).toBe(false);
    expect(monthEnded('2026-10', '2026-11-01')).toBe(true);
  });
});

describe('monthTotals (rule D3)', () => {
  it('counts days by kind, presence and place', () => {
    const totals = monthTotals(
      [
        day(),
        day({ place: 'remote' }),
        day({ status: 'partial', workedMinutes: 300 }),
        day({ kind: 'off', status: 'off', place: null, checkedIn: false, workedMinutes: 0 }),
        day({
          kind: 'holiday',
          status: 'holiday',
          place: null,
          checkedIn: false,
          workedMinutes: 0,
        }),
        day({ status: 'absent', checkedIn: false, workedMinutes: 0 }),
        day({ status: 'absent', leave: 'first_half', checkedIn: false, workedMinutes: 0 }),
        day({ field: true }),
      ],
      [],
      [],
    );
    expect(totals).toMatchObject({
      workDays: 6,
      presentDays: 4,
      remoteDays: 1,
      fieldDays: 1,
      absentDays: 1.5,
      holidayDays: 1,
      workedMinutes: 480 * 3 + 300,
    });
  });

  it('sums leave by type and its unpaid part', () => {
    const totals = monthTotals(
      [],
      [
        { leaveType: 'annual', days: 1, unpaidDays: 0 },
        { leaveType: 'annual', days: 0.5, unpaidDays: 0 },
        { leaveType: 'sick', days: 1, unpaidDays: 1 },
        { leaveType: 'unpaid', days: 1, unpaidDays: 1 },
      ],
      [],
    );
    expect(totals.leaveDays).toEqual({ annual: 1.5, sick: 1, emergency: 0, unpaid: 1 });
    expect(totals.unpaidLeaveDays).toBe(2);
  });

  it('sums the decided items and counts live lateness', () => {
    const item = (rest: Partial<Parameters<typeof monthTotals>[2][number]>) => ({
      kind: 'lateness' as const,
      status: 'pending' as const,
      decidedFraction: null,
      decidedMinutes: null,
      ...rest,
    });
    const totals = monthTotals(
      [],
      [],
      [
        item({ status: 'deducted', decidedFraction: 0.25 }),
        item({ status: 'warned' }),
        item({ status: 'void' }),
        item({ kind: 'absence', status: 'deducted', decidedFraction: 1 }),
        item({ kind: 'overtime', status: 'paid', decidedMinutes: 90 }),
        item({ kind: 'overtime', status: 'time_off', decidedMinutes: 240 }),
        item({ kind: 'overtime', status: 'rejected' }),
      ],
    );
    expect(totals).toMatchObject({
      lateCount: 2,
      deductedDays: 1.25,
      overtimePaidMinutes: 90,
      overtimeTimeOffMinutes: 240,
    });
  });
});

describe('leaveUnitsPay', () => {
  it('pays the first days and leaves the overflow unpaid (rule B12)', () => {
    expect(
      leaveUnitsPay(
        [
          { date: '2026-10-29', days: 1 },
          { date: '2026-10-30', days: 1 },
          { date: '2026-11-01', days: 1 },
        ],
        1.5,
      ),
    ).toEqual([
      { date: '2026-10-29', days: 1, unpaidDays: 0 },
      { date: '2026-10-30', days: 1, unpaidDays: 0.5 },
      { date: '2026-11-01', days: 1, unpaidDays: 1 },
    ]);
  });
});

describe('reopenMonthSchema', () => {
  it('needs a reason (rule D4)', () => {
    expect(reopenMonthSchema.safeParse({ reason: '  ' }).success).toBe(false);
    expect(reopenMonthSchema.parse({ reason: ' late correction ' })).toEqual({
      reason: 'late correction',
    });
  });
});
