import { POST_LIMITS, weekday } from '@vertex-hub/contracts';
import { describe, expect, it } from 'vitest';
import { calendarRange, daysBetween, sameMonth, shiftCalendar } from './content-dates';

describe('content calendar dates', () => {
  it('shows a month as whole weeks from Saturday to Friday', () => {
    // October 2026 starts on a Thursday and ends on a Saturday.
    const range = calendarRange('month', '2026-10-15');
    expect(range).toEqual({ from: '2026-09-26', to: '2026-11-06' });
    expect(weekday(range.from)).toBe(6);
    expect(weekday(range.to)).toBe(5);
  });

  it('never asks the API for more days than a calendar request covers', () => {
    for (let month = 1; month <= 12; month += 1) {
      for (const year of [2026, 2027, 2028]) {
        const { from, to } = calendarRange('month', `${year}-${String(month).padStart(2, '0')}-10`);
        const days = daysBetween(from, to);
        expect(days.length % 7).toBe(0);
        expect(days.length).toBeLessThanOrEqual(POST_LIMITS.calendarDays);
      }
    }
  });

  it('shows the week holding the day', () => {
    expect(calendarRange('week', '2026-10-01')).toEqual({ from: '2026-09-26', to: '2026-10-02' });
    expect(daysBetween('2026-09-26', '2026-10-02')).toHaveLength(7);
  });

  it('steps by a week or to the first day of the next or previous month', () => {
    expect(shiftCalendar('week', '2026-10-01', 1)).toBe('2026-10-08');
    expect(shiftCalendar('week', '2026-10-01', -1)).toBe('2026-09-24');
    expect(shiftCalendar('month', '2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftCalendar('month', '2026-01-15', -1)).toBe('2025-12-01');
  });

  it('tells days of the same month', () => {
    expect(sameMonth('2026-10-01', '2026-10-31')).toBe(true);
    expect(sameMonth('2026-10-01', '2026-09-30')).toBe(false);
  });
});
