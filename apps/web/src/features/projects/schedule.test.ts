import { describe, expect, it } from 'vitest';
import { scheduleOf } from './schedule';

describe('scheduleOf', () => {
  it('has not begun before the start date', () => {
    expect(scheduleOf('2026-10-10', '2026-10-19', '2026-10-01')).toEqual({
      totalDays: 10,
      elapsed: 0,
      daysLeft: 18,
    });
  });

  it('counts the start day as begun and the due day as left', () => {
    expect(scheduleOf('2026-10-01', '2026-10-10', '2026-10-01')).toEqual({
      totalDays: 10,
      elapsed: 0.1,
      daysLeft: 9,
    });
    expect(scheduleOf('2026-10-01', '2026-10-10', '2026-10-10')).toEqual({
      totalDays: 10,
      elapsed: 1,
      daysLeft: 0,
    });
  });

  it('counts the days past the due date as negative', () => {
    expect(scheduleOf('2026-10-01', '2026-10-10', '2026-10-13')).toMatchObject({
      elapsed: 1,
      daysLeft: -3,
    });
  });

  it('handles a one-day project', () => {
    expect(scheduleOf('2026-10-01', '2026-10-01', '2026-10-01')).toEqual({
      totalDays: 1,
      elapsed: 1,
      daysLeft: 0,
    });
  });
});
