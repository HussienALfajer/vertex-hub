import { describe, expect, it } from 'vitest';
import {
  accrualDays,
  CONTRACT_REMINDER_DAYS,
  createHolidaySchema,
  createHrRequestSchema,
  createLeaveAdjustmentSchema,
  createWorkScheduleSchema,
  currentSalary,
  decideHrRequestSchema,
  employeeStatus,
  endReminderDue,
  fileDatesValid,
  floorHalfDay,
  holidayRangeValid,
  hrSettingsSchema,
  isScheduleWorkDay,
  type LeaveHalf,
  latenessTiersValid,
  leaveSplit,
  leaveUnits,
  PROBATION_REMINDER_DAYS,
  paidDaysByYear,
  payoutSchema,
  permissionMinutes,
  requestsOverlap,
  rollover,
  scheduleTimesValid,
  shiftedHoliday,
  shiftYears,
  unitDays,
  updateEmployeeFileSchema,
  updateWorkScheduleSchema,
  type Weekday,
  weekdayOf,
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
    attendanceStartsOn: null,
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

const SATURDAY_TO_THURSDAY: Weekday[] = [
  'saturday',
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
];

describe('leave days (rules B1 and B11)', () => {
  it('names the weekday of a date', () => {
    expect(weekdayOf('2026-10-17')).toBe('saturday');
    expect(weekdayOf('2026-10-23')).toBe('friday');
  });

  it("counts the user's schedule days that are not holidays", () => {
    const eid = [{ startsOn: '2026-10-19', endsOn: '2026-10-20' }];
    // Saturday 17 to Saturday 24: Friday is off, Monday and Tuesday are a holiday.
    const units = leaveUnits(
      { startsOn: '2026-10-17', endsOn: '2026-10-24', half: null },
      SATURDAY_TO_THURSDAY,
      eid,
    );
    expect(units.map((unit) => unit.date)).toEqual([
      '2026-10-17',
      '2026-10-18',
      '2026-10-21',
      '2026-10-22',
      '2026-10-24',
    ]);
    expect(unitDays(units)).toBe(5);
    expect(isScheduleWorkDay('2026-10-23', SATURDAY_TO_THURSDAY, [])).toBe(false);
    expect(isScheduleWorkDay('2026-10-23', ['friday'], [])).toBe(true);
  });

  it('counts a half day as 0.5, and nothing on a day off', () => {
    const half = (date: string) =>
      unitDays(
        leaveUnits({ startsOn: date, endsOn: date, half: 'first_half' }, SATURDAY_TO_THURSDAY, []),
      );
    expect(half('2026-10-21')).toBe(0.5);
    expect(half('2026-10-23')).toBe(0);
  });
});

describe('paid and unpaid days (rule B12)', () => {
  const available = { annual: 10, sick: 2, emergency: 3 };

  it('pays sick days up to the sick balance', () => {
    expect(leaveSplit('sick', 4, available)).toEqual({ paidDays: 2, unpaidDays: 2 });
  });

  it('pays emergency days up to the cap and the annual balance', () => {
    expect(leaveSplit('emergency', 4, available)).toEqual({ paidDays: 3, unpaidDays: 1 });
    expect(leaveSplit('emergency', 2, { ...available, annual: 1.5 })).toEqual({
      paidDays: 1.5,
      unpaidDays: 0.5,
    });
    expect(leaveSplit('emergency', 1, { ...available, annual: -2 })).toEqual({
      paidDays: 0,
      unpaidDays: 1,
    });
  });

  it('pays annual leave whole and unpaid leave never', () => {
    expect(leaveSplit('annual', 3, available)).toEqual({ paidDays: 3, unpaidDays: 0 });
    expect(leaveSplit('unpaid', 3, available)).toEqual({ paidDays: 0, unpaidDays: 3 });
  });

  it('takes the paid days first, split by year, and from a day on', () => {
    const units = leaveUnits(
      { startsOn: '2026-12-30', endsOn: '2027-01-03', half: null },
      SATURDAY_TO_THURSDAY,
      [],
    );
    // Wed 30, Thu 31, Sat 2, Sun 3 (Friday 1 is off).
    expect(paidDaysByYear(units, 4)).toEqual(
      new Map([
        [2026, 2],
        [2027, 2],
      ]),
    );
    expect(paidDaysByYear(units, 3)).toEqual(
      new Map([
        [2026, 2],
        [2027, 1],
      ]),
    );
    expect(paidDaysByYear(units, 4, '2026-12-31')).toEqual(
      new Map([
        [2026, 1],
        [2027, 2],
      ]),
    );
  });
});

describe('overlapping requests (rule B8)', () => {
  const leave = (startsOn: string, endsOn: string, half: LeaveHalf | null = null) => ({
    kind: 'leave' as const,
    startsOn,
    endsOn,
    half,
    fromTime: null,
    toTime: null,
  });
  const permission = (date: string, fromTime: string, toTime: string) => ({
    kind: 'permission' as const,
    startsOn: date,
    endsOn: date,
    half: null,
    fromTime,
    toTime,
  });

  it('refuses leaves sharing a day, except the two halves of one', () => {
    expect(
      requestsOverlap(leave('2026-10-17', '2026-10-20'), leave('2026-10-20', '2026-10-22')),
    ).toBe(true);
    expect(
      requestsOverlap(leave('2026-10-17', '2026-10-19'), leave('2026-10-20', '2026-10-22')),
    ).toBe(false);
    const day = '2026-10-21';
    expect(requestsOverlap(leave(day, day, 'first_half'), leave(day, day, 'second_half'))).toBe(
      false,
    );
    expect(requestsOverlap(leave(day, day, 'first_half'), leave(day, day, 'first_half'))).toBe(
      true,
    );
  });

  it('fits a permission beside a half day or another window of the day', () => {
    const day = '2026-10-21';
    expect(requestsOverlap(permission(day, '09:00', '10:00'), leave(day, day))).toBe(true);
    expect(requestsOverlap(leave(day, day, 'second_half'), permission(day, '09:00', '10:00'))).toBe(
      false,
    );
    expect(
      requestsOverlap(permission(day, '09:00', '10:00'), permission(day, '10:00', '11:00')),
    ).toBe(false);
    expect(
      requestsOverlap(permission(day, '09:00', '10:30'), permission(day, '10:00', '11:00')),
    ).toBe(true);
  });
});

describe('accrual and rollover (rules B4 and B5)', () => {
  it('adds a twelfth a month, carrying the remainder so the year adds up', () => {
    let accrued = 0;
    const months: number[] = [];
    for (let month = 1; month <= 12; month += 1) {
      const days = accrualDays({
        annualDays: 14,
        startDate: '2025-03-01',
        period: `2026-${String(month).padStart(2, '0')}`,
        accruedBefore: accrued,
      });
      months.push(days);
      accrued += days;
    }
    expect(months.slice(0, 3)).toEqual([1, 1, 1.5]);
    expect(accrued).toBe(14);
  });

  it('counts the first month pro rata, from the start date', () => {
    // 14 / 12 × 16 / 31 of October = 0.6, rounded down.
    const first = accrualDays({
      annualDays: 14,
      startDate: '2026-10-16',
      period: '2026-10',
      accruedBefore: 0,
    });
    expect(first).toBe(0.5);
    expect(
      accrualDays({ annualDays: 14, startDate: '2026-10-16', period: '2026-09', accruedBefore: 0 }),
    ).toBe(0);
    // November: 0.6 + 1.17 = 1.77, rounded down to 1.5, less the 0.5 already added.
    expect(
      accrualDays({
        annualDays: 14,
        startDate: '2026-10-16',
        period: '2026-11',
        accruedBefore: first,
      }),
    ).toBe(1);
  });

  it('carries up to the maximum, expires the rest and carries a debt as it is', () => {
    expect(rollover(8, 5)).toEqual({ carried: 5, expired: 3 });
    expect(rollover(3.5, 5)).toEqual({ carried: 3.5, expired: 0 });
    expect(rollover(-1, 5)).toEqual({ carried: -1, expired: 0 });
    expect(floorHalfDay(1.4999999999)).toBe(1.5);
    expect(floorHalfDay(1.49)).toBe(1);
  });
});

describe('requests (rules B8–B14)', () => {
  const leave = {
    kind: 'leave',
    leaveType: 'annual',
    startsOn: '2026-11-01',
    endsOn: '2026-11-03',
  };

  it('takes a leave with a reason except for annual leave', () => {
    expect(createHrRequestSchema.safeParse(leave).success).toBe(true);
    expect(createHrRequestSchema.safeParse({ ...leave, leaveType: 'sick' }).success).toBe(false);
    expect(
      createHrRequestSchema.safeParse({ ...leave, leaveType: 'sick', reason: 'إنفلونزا' }).success,
    ).toBe(true);
  });

  it('takes a half day on a single day only, and a range in order', () => {
    expect(createHrRequestSchema.safeParse({ ...leave, half: 'first_half' }).success).toBe(false);
    expect(
      createHrRequestSchema.safeParse({ ...leave, endsOn: '2026-11-01', half: 'first_half' })
        .success,
    ).toBe(true);
    expect(createHrRequestSchema.safeParse({ ...leave, endsOn: '2026-10-31' }).success).toBe(false);
    expect(createHrRequestSchema.safeParse({ ...leave, endsOn: '2027-01-31' }).success).toBe(false);
  });

  it('takes a permission with a reason and a window that ends after it starts', () => {
    const permission = {
      kind: 'permission',
      date: '2026-11-01',
      fromTime: '09:00',
      toTime: '10:30',
      reason: 'موعد طبيب',
    };
    expect(createHrRequestSchema.safeParse(permission).success).toBe(true);
    expect(createHrRequestSchema.safeParse({ ...permission, reason: null }).success).toBe(false);
    expect(createHrRequestSchema.safeParse({ ...permission, toTime: '09:00' }).success).toBe(false);
    expect(permissionMinutes(permission)).toBe(90);
  });

  it('needs a note to reject', () => {
    expect(decideHrRequestSchema.safeParse({ decision: 'reject' }).success).toBe(false);
    expect(decideHrRequestSchema.safeParse({ decision: 'reject', note: 'ضغط عمل' }).success).toBe(
      true,
    );
    expect(decideHrRequestSchema.parse({ decision: 'approve' })).toEqual({
      decision: 'approve',
      note: null,
      confirmMissingCertificate: false,
    });
  });

  it('adjusts a balance by whole or half days, never by 0', () => {
    const adjustment = { leaveType: 'annual', year: 2026, note: 'رصيد افتتاحي', entry: 'opening' };
    expect(createLeaveAdjustmentSchema.safeParse({ ...adjustment, days: -2.5 }).success).toBe(true);
    expect(createLeaveAdjustmentSchema.safeParse({ ...adjustment, days: 0 }).success).toBe(false);
    expect(createLeaveAdjustmentSchema.safeParse({ ...adjustment, days: 1.25 }).success).toBe(
      false,
    );
  });
});
