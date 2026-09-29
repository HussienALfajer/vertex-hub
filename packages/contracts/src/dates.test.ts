import { describe, expect, it } from 'vitest';
import { businessInstant, timeOfDaySchema, WORK_WEEK, weekday, weekOf } from './dates.js';

describe('work week (ADR 0016)', () => {
  it('starts on Saturday and rests on Friday', () => {
    expect(weekday('2026-10-03')).toBe(WORK_WEEK.startsOn); // a Saturday
    expect(weekday('2026-10-09')).toBe(5); // a Friday
    expect(WORK_WEEK.weekend).toEqual([5]);
  });

  it('runs each week from Saturday to Friday', () => {
    const week = { from: '2026-10-03', to: '2026-10-09' };
    expect(weekOf('2026-10-03')).toEqual(week);
    expect(weekOf('2026-10-06')).toEqual(week);
    expect(weekOf('2026-10-09')).toEqual(week);
    expect(weekOf('2026-10-10')).toEqual({ from: '2026-10-10', to: '2026-10-16' });
  });

  it('crosses months and years', () => {
    expect(weekOf('2027-01-01')).toEqual({ from: '2026-12-26', to: '2027-01-01' });
  });
});

describe('time of day', () => {
  it('accepts HH:MM only', () => {
    expect(timeOfDaySchema.safeParse('09:30').success).toBe(true);
    expect(timeOfDaySchema.safeParse('23:59').success).toBe(true);
    for (const time of ['24:00', '9:30', '09:30:00', '09:60']) {
      expect(timeOfDaySchema.safeParse(time).success, time).toBe(false);
    }
  });

  it('turns a Damascus day and time into an instant (UTC+3)', () => {
    expect(businessInstant('2026-10-03', '14:00').toISOString()).toBe('2026-10-03T11:00:00.000Z');
    expect(businessInstant('2026-10-03', '01:00').toISOString()).toBe('2026-10-02T22:00:00.000Z');
  });
});
