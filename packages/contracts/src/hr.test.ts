import { describe, expect, it } from 'vitest';
import {
  CONTRACT_REMINDER_DAYS,
  createHolidaySchema,
  createWorkScheduleSchema,
  currentSalary,
  employeeStatus,
  endReminderDue,
  fileDatesValid,
  holidayRangeValid,
  hrSettingsSchema,
  latenessTiersValid,
  PROBATION_REMINDER_DAYS,
  payoutSchema,
  scheduleTimesValid,
  shiftedHoliday,
  shiftYears,
  updateEmployeeFileSchema,
  updateWorkScheduleSchema,
} from './hr.js';

describe('employee status', () => {
  it('is ended once archived, leaving while an end of service is set, else active', () => {
    expect(employeeStatus({ archived: true, endedOn: '2026-10-01' })).toBe('ended');
    expect(employeeStatus({ archived: false, endedOn: '2026-11-01' })).toBe('leaving');
    expect(employeeStatus({ archived: false, endedOn: null })).toBe('active');
  });
});

describe('file dates (rule A1)', () => {
  it('keeps probation and contract ends on or after the start date', () => {
    const startDate = '2026-01-10';
    expect(
      fileDatesValid({ startDate, probationEndDate: '2026-04-10', contractEndDate: null }),
    ).toBe(true);
    expect(
      fileDatesValid({ startDate, probationEndDate: startDate, contractEndDate: startDate }),
    ).toBe(true);
    expect(
      fileDatesValid({ startDate, probationEndDate: '2026-01-09', contractEndDate: null }),
    ).toBe(false);
    expect(
      fileDatesValid({ startDate, probationEndDate: null, contractEndDate: '2025-12-31' }),
    ).toBe(false);
  });

  it('checks nothing before a start date is set', () => {
    expect(
      fileDatesValid({ startDate: null, probationEndDate: '2020-01-01', contractEndDate: null }),
    ).toBe(true);
  });

  it('keeps remote weekdays once each, in week order', () => {
    const parsed = updateEmployeeFileSchema.parse({
      remoteWeekdays: ['thursday', 'saturday', 'thursday'],
    });
    expect(parsed.remoteWeekdays).toEqual(['saturday', 'thursday']);
  });

  it('takes annual leave in whole or half days', () => {
    expect(updateEmployeeFileSchema.safeParse({ annualLeaveDays: 14.5 }).success).toBe(true);
    expect(updateEmployeeFileSchema.safeParse({ annualLeaveDays: 14.25 }).success).toBe(false);
  });
});

describe('payout method (rule A5)', () => {
  it('requires the institution, account and holder for a transfer or a wallet', () => {
    const result = payoutSchema.safeParse({ method: 'bank_transfer', institution: 'بنك سوريا' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0]).sort()).toEqual([
      'account',
      'holder',
    ]);
  });

  it('clears the details for cash and for no method', () => {
    const details = { institution: 'شام كاش', account: '0991234567', holder: 'سامر' };
    expect(payoutSchema.parse({ method: 'cash', ...details })).toEqual({
      method: 'cash',
      institution: null,
      account: null,
      holder: null,
    });
    expect(payoutSchema.parse({ method: null, ...details }).account).toBeNull();
    expect(payoutSchema.parse({ method: 'mobile_wallet', ...details })).toEqual({
      method: 'mobile_wallet',
      ...details,
    });
  });
});

describe('current salary (rule A4)', () => {
  const change = (effectiveOn: string, amountMinor: number, archived = false) => ({
    effectiveOn,
    amountMinor,
    currency: 'USD' as const,
    archived,
  });

  it('is the latest non-archived change effective up to today', () => {
    const changes = [
      change('2026-01-01', 50_000),
      change('2026-07-01', 60_000),
      change('2026-09-01', 70_000, true),
      change('2026-12-01', 80_000),
    ];
    expect(currentSalary(changes, '2026-10-21')).toEqual({
      amountMinor: 60_000,
      currency: 'USD',
      effectiveOn: '2026-07-01',
    });
    expect(currentSalary(changes, '2026-12-01')?.amountMinor).toBe(80_000);
  });

  it('is null before the first change', () => {
    expect(currentSalary([change('2026-11-01', 50_000)], '2026-10-21')).toBeNull();
  });
});

describe('contract and probation reminders (rule A7)', () => {
  const today = '2026-10-21';

  it('sends the 30-day reminder from 30 days before, then the 7-day one', () => {
    expect(endReminderDue('2026-11-21', today, CONTRACT_REMINDER_DAYS)).toBeNull();
    expect(endReminderDue('2026-11-20', today, CONTRACT_REMINDER_DAYS)).toBe(30);
    expect(endReminderDue('2026-10-29', today, CONTRACT_REMINDER_DAYS)).toBe(30);
    expect(endReminderDue('2026-10-28', today, CONTRACT_REMINDER_DAYS)).toBe(7);
    expect(endReminderDue(today, today, CONTRACT_REMINDER_DAYS)).toBe(7);
  });

  it('sends nothing once the date has passed', () => {
    expect(endReminderDue('2026-10-20', today, CONTRACT_REMINDER_DAYS)).toBeNull();
  });

  it('reminds of the probation end from 14 days before', () => {
    expect(endReminderDue('2026-11-04', today, [PROBATION_REMINDER_DAYS])).toBe(14);
    expect(endReminderDue('2026-11-05', today, [PROBATION_REMINDER_DAYS])).toBeNull();
  });
});

describe('work schedules (rule B2)', () => {
  const day = { startTime: '09:00', latestStartTime: null, requiredMinutes: 480 };

  it('keeps each weekday once, in week order', () => {
    const parsed = createWorkScheduleSchema.parse({
      name: ' Ramadan ',
      kind: 'fixed',
      days: [
        { weekday: 'monday', ...day },
        { weekday: 'saturday', ...day },
      ],
    });
    expect(parsed.name).toBe('Ramadan');
    expect(parsed.isDefault).toBe(false);
    expect(parsed.days.map((d) => d.weekday)).toEqual(['saturday', 'monday']);
    const twice = { name: 'x', kind: 'fixed', days: [{ weekday: 'monday', ...day }] };
    twice.days.push(twice.days[0] as (typeof twice.days)[0]);
    expect(createWorkScheduleSchema.safeParse(twice).success).toBe(false);
    expect(createWorkScheduleSchema.safeParse({ ...twice, days: [] }).success).toBe(false);
  });

  it('leaves the default untouched on a partial edit', () => {
    expect(updateWorkScheduleSchema.parse({ name: 'Main' })).toEqual({ name: 'Main' });
  });

  it('ends a fixed day by 23:59, without a start window', () => {
    expect(scheduleTimesValid('fixed', [day])).toBe(true);
    expect(
      scheduleTimesValid('fixed', [
        { startTime: '15:59', latestStartTime: null, requiredMinutes: 480 },
      ]),
    ).toBe(true);
    expect(
      scheduleTimesValid('fixed', [
        { startTime: '16:00', latestStartTime: null, requiredMinutes: 480 },
      ]),
    ).toBe(false);
    expect(scheduleTimesValid('fixed', [{ ...day, latestStartTime: '10:00' }])).toBe(false);
  });

  it('needs a flexible window that closes after it opens and ends by 23:59', () => {
    const flexible = { startTime: '08:00', latestStartTime: '10:00', requiredMinutes: 480 };
    expect(scheduleTimesValid('flexible', [flexible])).toBe(true);
    expect(scheduleTimesValid('flexible', [{ ...flexible, latestStartTime: null }])).toBe(false);
    expect(scheduleTimesValid('flexible', [{ ...flexible, latestStartTime: '07:59' }])).toBe(false);
    expect(scheduleTimesValid('flexible', [{ ...flexible, latestStartTime: '16:00' }])).toBe(false);
  });
});

describe('public holidays (rule B3)', () => {
  it('lasts one to ten days', () => {
    expect(holidayRangeValid({ startsOn: '2026-12-25', endsOn: '2026-12-25' })).toBe(true);
    expect(holidayRangeValid({ startsOn: '2026-12-25', endsOn: '2027-01-03' })).toBe(true);
    expect(holidayRangeValid({ startsOn: '2026-12-25', endsOn: '2027-01-04' })).toBe(false);
    expect(holidayRangeValid({ startsOn: '2026-12-25', endsOn: '2026-12-24' })).toBe(false);
  });

  it('is paid unless stated', () => {
    const parsed = createHolidaySchema.parse({
      name: 'Christmas',
      startsOn: '2026-12-25',
      endsOn: '2026-12-25',
    });
    expect(parsed.paid).toBe(true);
  });

  it('repeats on the same dates a year later, keeping its length', () => {
    expect(shiftYears('2026-05-01', 1)).toBe('2027-05-01');
    expect(shiftYears('2028-02-29', 1)).toBe('2029-02-28');
    expect(shiftedHoliday({ startsOn: '2026-12-31', endsOn: '2027-01-01' }, 1)).toEqual({
      startsOn: '2027-12-31',
      endsOn: '2028-01-01',
    });
    expect(shiftedHoliday({ startsOn: '2028-02-28', endsOn: '2028-03-01' }, 1)).toEqual({
      startsOn: '2029-02-28',
      endsOn: '2029-03-02',
    });
  });
});

describe('HR settings', () => {
  const defaults = {
    graceMinutes: 10,
    latenessTiers: [
      { upToMinutes: 30, fraction: 0.25 },
      { upToMinutes: 60, fraction: 0.5 },
      { upToMinutes: null, fraction: 1 },
    ],
    firstLatenessWarning: true,
    overtimeMinMinutes: 30,
    checkInReminderMinutes: 15,
    defaultAnnualLeaveDays: 14,
    carryOverMaxDays: 5,
    sickDaysPerYear: 14,
    sickCertificateAfterDays: 2,
    sickRequestWithinWorkDays: 3,
    emergencyDaysPerYear: 3,
    permissionMaxMinutes: 120,
    permissionsPerMonth: 4,
    annualNoticeWorkDays: 3,
    remoteNoticeWorkDays: 1,
    overtimeMinutesPerLeaveDay: 480,
  };

  it('accepts the seeded defaults', () => {
    expect(hrSettingsSchema.parse(defaults)).toEqual(defaults);
  });

  it('needs ascending lateness tiers with only the last one open', () => {
    expect(latenessTiersValid(defaults.latenessTiers as never)).toBe(true);
    expect(latenessTiersValid([{ upToMinutes: null, fraction: 1 }])).toBe(true);
    expect(
      latenessTiersValid([
        { upToMinutes: 60, fraction: 0.5 },
        { upToMinutes: 30, fraction: 0.25 },
        { upToMinutes: null, fraction: 1 },
      ]),
    ).toBe(false);
    expect(latenessTiersValid([{ upToMinutes: 30, fraction: 0.25 }])).toBe(false);
    expect(
      latenessTiersValid([
        { upToMinutes: null, fraction: 0.5 },
        { upToMinutes: null, fraction: 1 },
      ]),
    ).toBe(false);
  });

  it('takes quarter-day fractions and half leave days only', () => {
    const tier = { upToMinutes: null, fraction: 0.3 };
    expect(hrSettingsSchema.safeParse({ ...defaults, latenessTiers: [tier] }).success).toBe(false);
    expect(hrSettingsSchema.safeParse({ ...defaults, carryOverMaxDays: 2.5 }).success).toBe(true);
    expect(hrSettingsSchema.safeParse({ ...defaults, carryOverMaxDays: 2.25 }).success).toBe(false);
  });
});
