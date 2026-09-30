import { describe, expect, it } from 'vitest';
import {
  businessDate,
  businessInstant,
  businessTimeOfDay,
  isWorkDay,
  nextWorkDay,
  nthWorkDay,
  timeOfDaySchema,
  WORK_WEEK,
  weekday,
  weekOf,
  workDaysBetween,
} from './dates.js';

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

describe('work days (ADR 0017)', () => {
  it('skips Fridays only', () => {
    expect(isWorkDay('2026-10-08')).toBe(true); // Thursday
    expect(isWorkDay('2026-10-09')).toBe(false); // Friday
    expect(isWorkDay('2026-10-10')).toBe(true); // Saturday
  });

  it('counts day 1 as the first work day on or after the start', () => {
    expect(nthWorkDay('2026-10-08', 1)).toBe('2026-10-08');
    expect(nthWorkDay('2026-10-09', 1)).toBe('2026-10-10');
    expect(nthWorkDay('2026-10-08', 2)).toBe('2026-10-10');
    expect(nthWorkDay('2026-10-03', 7)).toBe('2026-10-10');
  });

  it('crosses month and year ends', () => {
    expect(nthWorkDay('2026-10-29', 3)).toBe('2026-11-01'); // Thu, Sat, Sun
    expect(nthWorkDay('2026-12-31', 2)).toBe('2027-01-02'); // Thu, (Fri), Sat
  });

  it('lists the work days of a range', () => {
    expect(workDaysBetween('2026-10-07', '2026-10-11')).toEqual([
      '2026-10-07',
      '2026-10-08',
      '2026-10-10',
      '2026-10-11',
    ]);
    expect(workDaysBetween('2026-10-09', '2026-10-09')).toEqual([]);
    expect(workDaysBetween('2026-10-11', '2026-10-10')).toEqual([]);
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

  it('reads the Damascus calendar day and time of an instant from the time zone database', () => {
    const lateUtc = new Date('2026-10-31T21:30:00.000Z');
    expect(businessDate(lateUtc)).toBe('2026-11-01');
    expect(businessTimeOfDay(lateUtc)).toBe('00:30:00');
    expect(businessDate(new Date('2026-10-31T20:59:59.000Z'))).toBe('2026-10-31');
    // Round trip through the instant of a day and time.
    const instant = businessInstant('2026-11-01', '00:30');
    expect([businessDate(instant), businessTimeOfDay(instant)]).toEqual(['2026-11-01', '00:30:00']);
  });
});

describe('next work day (F14 rule 9)', () => {
  it('skips Friday, so Thursday covers Friday and Saturday', () => {
    expect(nextWorkDay('2026-10-07')).toBe('2026-10-08'); // Wed → Thu
    expect(nextWorkDay('2026-10-08')).toBe('2026-10-10'); // Thu → Sat
    expect(nextWorkDay('2026-10-09')).toBe('2026-10-10'); // Fri → Sat
  });

  it('crosses month and year ends', () => {
    expect(nextWorkDay('2026-10-31')).toBe('2026-11-01');
    expect(nextWorkDay('2026-12-31')).toBe('2027-01-02');
  });
});
