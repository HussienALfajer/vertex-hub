import { describe, expect, it } from 'vitest';
import {
  CONTRACT_REMINDER_DAYS,
  currentSalary,
  employeeStatus,
  endReminderDue,
  fileDatesValid,
  PROBATION_REMINDER_DAYS,
  payoutSchema,
  updateEmployeeFileSchema,
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
