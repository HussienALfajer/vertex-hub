import { z } from 'zod';
import { punchDirectionSchema } from './attendance.js';
import {
  addDays,
  type CalendarDate,
  calendarDateSchema,
  calendarMonthSchema,
  daysInclusive,
  type HolidayRange,
  instantSchema,
  lastOfMonth,
  type TimeOfDay,
  timeOfDaySchema,
  weekday,
} from './dates.js';
import { userDepartmentSchema } from './departments.js';
import { pageQuerySchema, pageSchema, queryListSchema, sortOrderSchema } from './lists.js';
import { currencySchema } from './money.js';
import { optionalText } from './text.js';
import { phoneSchema } from './users.js';

/*
 * HR (spec F17, ADR 0039). Part A: the employee file of every user, salary history, payout
 * method and the end of service. Part B: work schedules, public holidays, the HR settings and
 * leave; attendance and months follow.
 */

/** The days of the work week, Saturday first (`WORK_WEEK`). */
export const WEEKDAYS = [
  'saturday',
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
] as const;

export const weekdaySchema = z.enum(WEEKDAYS).meta({ id: 'Weekday' });

export type Weekday = z.infer<typeof weekdaySchema>;

export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'freelance'] as const;

export const employmentTypeSchema = z.enum(EMPLOYMENT_TYPES).meta({ id: 'EmploymentType' });

export type EmploymentType = z.infer<typeof employmentTypeSchema>;

export const PAYOUT_METHODS = ['cash', 'bank_transfer', 'mobile_wallet'] as const;

export const payoutMethodSchema = z.enum(PAYOUT_METHODS).meta({ id: 'PayoutMethod' });

export type PayoutMethod = z.infer<typeof payoutMethodSchema>;

export const END_REASONS = ['resigned', 'terminated', 'contract_ended', 'other'] as const;

export const endReasonSchema = z.enum(END_REASONS).meta({ id: 'EndReason' });

export type EndReason = z.infer<typeof endReasonSchema>;

export const WORK_SCHEDULE_KINDS = ['fixed', 'flexible'] as const;

export const workScheduleKindSchema = z.enum(WORK_SCHEDULE_KINDS).meta({ id: 'WorkScheduleKind' });

export type WorkScheduleKind = z.infer<typeof workScheduleKindSchema>;

/**
 * Derived, never stored: `ended` once the account is archived, `leaving` while an end of service
 * is set (rule A8), else `active`.
 */
export const EMPLOYEE_STATUSES = ['active', 'leaving', 'ended'] as const;

export const employeeStatusSchema = z.enum(EMPLOYEE_STATUSES).meta({ id: 'EmployeeStatus' });

export type EmployeeStatus = z.infer<typeof employeeStatusSchema>;

export function employeeStatus(file: {
  archived: boolean;
  endedOn: CalendarDate | null;
}): EmployeeStatus {
  if (file.archived) return 'ended';
  return file.endedOn ? 'leaving' : 'active';
}

/** Leave days in whole or half days, from 0 to `max`. */
const halfDaysSchema = (max: number) =>
  z
    .number()
    .min(0)
    .max(max)
    .refine((days) => Number.isInteger(days * 2), 'Whole or half days');

/** Annual leave days per year; a new file takes `defaultAnnualLeaveDays` (HR settings). */
export const annualLeaveDaysSchema = halfDaysSchema(60);

/** The personal part of a file (`employees.read` and the employee). */
export const employeePersonalSchema = z
  .object({
    nationalId: z.string().nullable(),
    birthDate: calendarDateSchema.nullable(),
    address: z.string().nullable(),
    emergencyName: z.string().nullable(),
    emergencyPhone: z.string().nullable(),
    emergencyRelation: z.string().nullable(),
  })
  .meta({ id: 'EmployeePersonal' });

export type EmployeePersonal = z.infer<typeof employeePersonalSchema>;

/** The contract, schedule and end of service of a file (`employees.read` and the employee). */
export const employeeEmploymentSchema = z
  .object({
    employmentType: employmentTypeSchema,
    startDate: calendarDateSchema.nullable(),
    probationEndDate: calendarDateSchema.nullable(),
    contractEndDate: calendarDateSchema.nullable(),
    schedule: z.object({ id: z.uuid(), name: z.string() }),
    attendanceExempt: z.boolean(),
    remoteWeekdays: z.array(weekdaySchema),
    annualLeaveDays: z.number(),
    endedOn: calendarDateSchema.nullable(),
    endReason: endReasonSchema.nullable(),
    endNote: z.string().nullable(),
  })
  .meta({ id: 'EmployeeEmployment' });

export type EmployeeEmployment = z.infer<typeof employeeEmploymentSchema>;

/** The current salary: the non-archived change with the latest effective date up to today. */
export const currentSalarySchema = z
  .object({
    amountMinor: z.number().int(),
    currency: currencySchema,
    effectiveOn: calendarDateSchema,
  })
  .meta({ id: 'CurrentSalary' });

export type CurrentSalary = z.infer<typeof currentSalarySchema>;

/** The Pay section (`salaries.read` and the employee). */
export const employeePaySchema = z
  .object({
    payoutMethod: payoutMethodSchema.nullable(),
    payoutInstitution: z.string().nullable(),
    payoutAccount: z.string().nullable(),
    payoutHolder: z.string().nullable(),
    currentSalary: currentSalarySchema.nullable(),
  })
  .meta({ id: 'EmployeePay' });

export type EmployeePay = z.infer<typeof employeePaySchema>;

/**
 * An employee file as the caller sees it (rule A2). `personal` and `employment` are present for
 * `employees.read` holders and the employee; `pay` for `salaries.read` holders and the employee.
 */
export const employeeFileSchema = z
  .object({
    userId: z.uuid(),
    name: z.string(),
    title: z.string().nullable(),
    /** Primary first. */
    departments: z.array(userDepartmentSchema),
    status: employeeStatusSchema,
    personal: employeePersonalSchema.optional(),
    employment: employeeEmploymentSchema.optional(),
    pay: employeePaySchema.optional(),
  })
  .meta({ id: 'EmployeeFile' });

export type EmployeeFile = z.infer<typeof employeeFileSchema>;

/** A row of People: the file without its personal part. */
export const employeeSummarySchema = employeeFileSchema
  .omit({ personal: true })
  .meta({ id: 'EmployeeSummary' });

export type EmployeeSummary = z.infer<typeof employeeSummarySchema>;

export const employeeListQuerySchema = pageQuerySchema.extend({
  /** Matches the name or the email. */
  search: z.string().trim().min(1).max(100).optional(),
  departmentId: z.uuid().optional(),
  status: employeeStatusSchema.default('active'),
});

export type EmployeeListQuery = z.infer<typeof employeeListQuerySchema>;

export const employeePageSchema = pageSchema(employeeSummarySchema).meta({
  id: 'EmployeePage',
  description: 'Employee files sorted by name',
});

export type EmployeePage = z.infer<typeof employeePageSchema>;

/** Edits by `employees.manage`; the dates are checked against the stored ones (`INVALID_DATES`). */
export const updateEmployeeFileSchema = z
  .object({
    nationalId: optionalText(40),
    birthDate: calendarDateSchema.nullable(),
    address: optionalText(300),
    emergencyName: optionalText(100),
    emergencyPhone: phoneSchema,
    emergencyRelation: optionalText(60),
    employmentType: employmentTypeSchema,
    startDate: calendarDateSchema.nullable(),
    probationEndDate: calendarDateSchema.nullable(),
    contractEndDate: calendarDateSchema.nullable(),
    scheduleId: z.uuid(),
    attendanceExempt: z.boolean(),
    remoteWeekdays: z
      .array(weekdaySchema)
      .transform((days) => WEEKDAYS.filter((day) => days.includes(day))),
    annualLeaveDays: annualLeaveDaysSchema,
  })
  .partial()
  .meta({ id: 'UpdateEmployeeFile' });

export type UpdateEmployeeFile = z.infer<typeof updateEmployeeFileSchema>;

export type UpdateEmployeeFileInput = z.input<typeof updateEmployeeFileSchema>;

/** The personal fields: their audit entries name them without their values. */
export const EMPLOYEE_PERSONAL_FIELDS = Object.keys(
  employeePersonalSchema.shape,
) as (keyof EmployeePersonal)[];

/** Probation and contract end on or after the start date (rule A1, `INVALID_DATES`). */
export function fileDatesValid(dates: {
  startDate: CalendarDate | null;
  probationEndDate: CalendarDate | null;
  contractEndDate: CalendarDate | null;
}): boolean {
  const { startDate, probationEndDate, contractEndDate } = dates;
  if (!startDate) return true;
  return (
    (!probationEndDate || probationEndDate >= startDate) &&
    (!contractEndDate || contractEndDate >= startDate)
  );
}

/**
 * Rule A5: the institution, account and holder are required for a bank transfer and a mobile
 * wallet, and cleared for cash and for no method.
 */
export const payoutSchema = z
  .object({
    method: payoutMethodSchema.nullable(),
    institution: optionalText(100).optional(),
    account: optionalText(100).optional(),
    holder: optionalText(100).optional(),
  })
  .superRefine((payout, ctx) => {
    if (payout.method !== 'bank_transfer' && payout.method !== 'mobile_wallet') return;
    for (const key of ['institution', 'account', 'holder'] as const) {
      if (!payout[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'Required' });
    }
  })
  .transform((payout) => {
    const details = payout.method === 'bank_transfer' || payout.method === 'mobile_wallet';
    return {
      method: payout.method,
      institution: details ? (payout.institution ?? null) : null,
      account: details ? (payout.account ?? null) : null,
      holder: details ? (payout.holder ?? null) : null,
    };
  })
  .meta({ id: 'Payout' });

export type Payout = z.infer<typeof payoutSchema>;

export type PayoutInput = z.input<typeof payoutSchema>;

export const salaryChangeSchema = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    effectiveOn: calendarDateSchema,
    amountMinor: z.number().int(),
    currency: currencySchema,
    reason: z.string(),
    createdBy: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    createdAt: instantSchema,
    archivedAt: instantSchema.nullable(),
    archiveReason: z.string().nullable(),
  })
  .meta({ id: 'SalaryChange' });

export type SalaryChange = z.infer<typeof salaryChangeSchema>;

export const salaryChangeListSchema = z
  .object({ items: z.array(salaryChangeSchema) })
  .meta({ id: 'SalaryChangeList', description: 'Salary changes, latest effective date first' });

export type SalaryChangeList = z.infer<typeof salaryChangeListSchema>;

const reasonSchema = z.string().trim().min(1).max(200);

/** Rule A4: a monthly fixed salary, added and never edited. */
export const createSalaryChangeSchema = z
  .object({
    effectiveOn: calendarDateSchema,
    amountMinor: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    currency: currencySchema,
    reason: reasonSchema,
  })
  .meta({ id: 'CreateSalaryChange' });

export type CreateSalaryChange = z.infer<typeof createSalaryChangeSchema>;

export const archiveSalaryChangeSchema = z
  .object({ reason: reasonSchema })
  .meta({ id: 'ArchiveSalaryChange' });

export type ArchiveSalaryChange = z.infer<typeof archiveSalaryChangeSchema>;

/** The current salary among `changes` on `today` (rule A4); null before the first one. */
export function currentSalary(
  changes: readonly {
    effectiveOn: CalendarDate;
    amountMinor: number;
    currency: CurrentSalary['currency'];
    archived: boolean;
  }[],
  today: CalendarDate,
): CurrentSalary | null {
  let current: CurrentSalary | null = null;
  for (const change of changes) {
    if (change.archived || change.effectiveOn > today) continue;
    if (!current || change.effectiveOn > current.effectiveOn) {
      current = {
        amountMinor: change.amountMinor,
        currency: change.currency,
        effectiveOn: change.effectiveOn,
      };
    }
  }
  return current;
}

/** Rule A8: the last working day, today or later (`INVALID_DATES`). */
export const endServiceSchema = z
  .object({
    endedOn: calendarDateSchema,
    reason: endReasonSchema,
    note: optionalText(500).optional(),
  })
  .meta({ id: 'EndService' });

export type EndService = z.infer<typeof endServiceSchema>;

/*
 * Rule A7: the contract and probation reminders of the daily job, by days left.
 */

/** Days before the contract end at which GMs and Ops are reminded, latest first. */
export const CONTRACT_REMINDER_DAYS = [30, 7] as const;

/** Days before the probation end at which they are reminded. */
export const PROBATION_REMINDER_DAYS = 14;

/**
 * The reminder due on `today` for an end date, or null: the latest threshold it has reached and
 * not passed, so a job run after missed days still sends it once (a contract set to end in five
 * days gets only the 7-day reminder).
 */
export function endReminderDue(
  endsOn: CalendarDate,
  today: CalendarDate,
  thresholds: readonly number[],
): number | null {
  if (endsOn < today) return null;
  const daysLeft = daysInclusive(today, endsOn) - 1;
  const reached = thresholds.filter((days) => daysLeft <= days);
  return reached.length > 0 ? Math.min(...reached) : null;
}

/*
 * Part B: work schedules (rule B2), public holidays (rule B3) and the HR settings.
 */

export const WORK_SCHEDULE_LIMITS = { name: 100, minMinutes: 60, maxMinutes: 960 } as const;

/** The last minute a work day may end on: no shift crosses midnight (spec, out of scope). */
const DAY_END_MINUTES = 23 * 60 + 59;

/** Minutes since midnight of a time of day. */
export function minutesOfDay(time: TimeOfDay): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * A work day of a schedule. Fixed: work starts at `startTime` and ends `requiredMinutes` later.
 * Flexible: the start window runs from `startTime` to `latestStartTime`.
 */
export const workScheduleDaySchema = z
  .object({
    weekday: weekdaySchema,
    startTime: timeOfDaySchema,
    latestStartTime: timeOfDaySchema.nullable(),
    requiredMinutes: z
      .number()
      .int()
      .min(WORK_SCHEDULE_LIMITS.minMinutes)
      .max(WORK_SCHEDULE_LIMITS.maxMinutes),
  })
  .meta({ id: 'WorkScheduleDay' });

export type WorkScheduleDay = z.infer<typeof workScheduleDaySchema>;

export const workScheduleSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    kind: workScheduleKindSchema,
    isDefault: z.boolean(),
    /** In week order; a weekday left out is an off day. */
    days: z.array(workScheduleDaySchema),
    /** Employee files of active accounts on this schedule; one or more blocks archiving. */
    employees: z.number().int(),
    createdAt: instantSchema,
    updatedAt: instantSchema,
    archivedAt: instantSchema.nullable(),
  })
  .meta({ id: 'WorkSchedule' });

export type WorkSchedule = z.infer<typeof workScheduleSchema>;

export const workScheduleListSchema = z
  .object({ items: z.array(workScheduleSchema) })
  .meta({ id: 'WorkScheduleList', description: 'The default first, then by name' });

export type WorkScheduleList = z.infer<typeof workScheduleListSchema>;

/** One to seven distinct weekdays, kept in week order. */
const scheduleDaysSchema = z
  .array(workScheduleDaySchema)
  .min(1)
  .max(WEEKDAYS.length)
  .refine(
    (days) => new Set(days.map((day) => day.weekday)).size === days.length,
    'Each weekday once',
  )
  .transform((days) =>
    [...days].sort((a, b) => WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday)),
  );

const scheduleFieldsSchema = z.object({
  name: z.string().trim().min(1).max(WORK_SCHEDULE_LIMITS.name),
  kind: workScheduleKindSchema,
  days: scheduleDaysSchema,
});

/** Rule B2; the times are checked by `scheduleTimesValid` (`INVALID_TIMES`). */
export const createWorkScheduleSchema = scheduleFieldsSchema
  .extend({
    /** Makes it the default in place of the current one. */
    isDefault: z.boolean().default(false),
  })
  .meta({ id: 'CreateWorkSchedule' });

export type CreateWorkSchedule = z.infer<typeof createWorkScheduleSchema>;

export type CreateWorkScheduleInput = z.input<typeof createWorkScheduleSchema>;

/** `isDefault: true` moves the default here; `false` on the default is `DEFAULT_REQUIRED`. */
export const updateWorkScheduleSchema = scheduleFieldsSchema
  .extend({ isDefault: z.boolean() })
  .partial()
  .meta({ id: 'UpdateWorkSchedule' });

export type UpdateWorkSchedule = z.infer<typeof updateWorkScheduleSchema>;

export type UpdateWorkScheduleInput = z.input<typeof updateWorkScheduleSchema>;

/**
 * The times of a schedule's days (`INVALID_TIMES`): a fixed day has no start window and ends by
 * 23:59; a flexible day has a window that closes on or after it opens, and ends by 23:59 when it
 * starts at the window's close.
 */
export function scheduleTimesValid(
  kind: WorkScheduleKind,
  days: readonly Pick<WorkScheduleDay, 'startTime' | 'latestStartTime' | 'requiredMinutes'>[],
): boolean {
  return days.every((day) => {
    const start = minutesOfDay(day.startTime);
    if (kind === 'fixed') {
      return day.latestStartTime === null && start + day.requiredMinutes <= DAY_END_MINUTES;
    }
    if (day.latestStartTime === null) return false;
    const latest = minutesOfDay(day.latestStartTime);
    return latest >= start && latest + day.requiredMinutes <= DAY_END_MINUTES;
  });
}

export const HOLIDAY_LIMITS = { name: 100, days: 10 } as const;

export const holidaySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    startsOn: calendarDateSchema,
    endsOn: calendarDateSchema,
    paid: z.boolean(),
    createdAt: instantSchema,
    updatedAt: instantSchema,
    archivedAt: instantSchema.nullable(),
  })
  .meta({ id: 'Holiday' });

export type Holiday = z.infer<typeof holidaySchema>;

export const holidayListSchema = z
  .object({ items: z.array(holidaySchema) })
  .meta({ id: 'HolidayList', description: 'Non-archived holidays by start date' });

export type HolidayList = z.infer<typeof holidayListSchema>;

const holidayYearSchema = z.coerce.number().int().min(2000).max(2999);

/** The holidays with a day in `year`. */
export const holidayListQuerySchema = z.object({ year: holidayYearSchema });

export type HolidayListQuery = z.infer<typeof holidayListQuerySchema>;

const holidayFieldsSchema = z.object({
  name: z.string().trim().min(1).max(HOLIDAY_LIMITS.name),
  startsOn: calendarDateSchema,
  endsOn: calendarDateSchema,
  paid: z.boolean(),
});

/** Rule B3; the range is checked by `holidayRangeValid` (`INVALID_DATES`). */
export const createHolidaySchema = holidayFieldsSchema
  .extend({ paid: z.boolean().default(true) })
  .meta({ id: 'CreateHoliday' });

export type CreateHoliday = z.infer<typeof createHolidaySchema>;

export type CreateHolidayInput = z.input<typeof createHolidaySchema>;

export const updateHolidaySchema = holidayFieldsSchema.partial().meta({ id: 'UpdateHoliday' });

export type UpdateHoliday = z.infer<typeof updateHolidaySchema>;

/** "Repeat last year": copies the holidays of `year - 1` into `year`. */
export const repeatHolidaysSchema = z
  .object({ year: holidayYearSchema })
  .meta({ id: 'RepeatHolidays' });

export type RepeatHolidays = z.infer<typeof repeatHolidaysSchema>;

/** A holiday ends on or after its start and lasts at most `HOLIDAY_LIMITS.days` days. */
export function holidayRangeValid(range: {
  startsOn: CalendarDate;
  endsOn: CalendarDate;
}): boolean {
  return (
    range.endsOn >= range.startsOn &&
    daysInclusive(range.startsOn, range.endsOn) <= HOLIDAY_LIMITS.days
  );
}

/**
 * Rule B3, "Repeat last year": the same day and month `years` later; 29 February becomes
 * 28 February in a year without it.
 */
export function shiftYears(date: CalendarDate, years: number): CalendarDate {
  const year = String(Number(date.slice(0, 4)) + years).padStart(4, '0');
  const month = `${year}-${date.slice(5, 7)}-01`;
  const day = `${year}-${date.slice(5)}`;
  const last = lastOfMonth(month);
  return day > last ? last : day;
}

/** The copy of a holiday `years` later, keeping its length (a holiday may cross a year end). */
export function shiftedHoliday(
  holiday: { startsOn: CalendarDate; endsOn: CalendarDate },
  years: number,
): { startsOn: CalendarDate; endsOn: CalendarDate } {
  const startsOn = shiftYears(holiday.startsOn, years);
  return {
    startsOn,
    endsOn: addDays(startsOn, daysInclusive(holiday.startsOn, holiday.endsOn) - 1),
  };
}

/** A lateness deduction in fractions of a day (decided by the General Manager, part C). */
export const LATENESS_FRACTIONS = [0.25, 0.5, 0.75, 1] as const;

export const latenessTierSchema = z
  .object({
    /** The tier covers lateness up to these minutes; null is "more" and closes the list. */
    upToMinutes: z.number().int().min(1).max(WORK_SCHEDULE_LIMITS.maxMinutes).nullable(),
    fraction: z.literal(LATENESS_FRACTIONS),
  })
  .meta({ id: 'LatenessTier' });

export type LatenessTier = z.infer<typeof latenessTierSchema>;

/** Ascending limits, and only the last tier open. */
export function latenessTiersValid(tiers: readonly LatenessTier[]): boolean {
  return tiers.every((tier, i) => {
    const last = i === tiers.length - 1;
    if (last) return tier.upToMinutes === null;
    const next = tiers[i + 1]?.upToMinutes;
    return (
      tier.upToMinutes !== null && (next === null || next === undefined || next > tier.upToMinutes)
    );
  });
}

const minutesSetting = (min: number, max: number) => z.number().int().min(min).max(max);

/** The HR settings, one row (spec, `hr_settings`); read with `hr.read`, set with `hr.manage`. */
export const hrSettingsSchema = z
  .object({
    /** Rule C1: attendance runs in trial until this date; null keeps it in trial. */
    attendanceStartsOn: calendarDateSchema.nullable(),
    graceMinutes: minutesSetting(0, 120),
    latenessTiers: z
      .array(latenessTierSchema)
      .min(1)
      .max(6)
      .refine(latenessTiersValid, 'Ascending tiers, the last one open'),
    /** Rule C17: the first lateness of a month is proposed as a warning. */
    firstLatenessWarning: z.boolean(),
    overtimeMinMinutes: minutesSetting(0, 480),
    checkInReminderMinutes: minutesSetting(0, 120),
    defaultAnnualLeaveDays: annualLeaveDaysSchema,
    carryOverMaxDays: halfDaysSchema(60),
    sickDaysPerYear: halfDaysSchema(60),
    sickCertificateAfterDays: z.number().int().min(0).max(30),
    sickRequestWithinWorkDays: z.number().int().min(0).max(30),
    emergencyDaysPerYear: halfDaysSchema(30),
    permissionMaxMinutes: minutesSetting(15, 480),
    permissionsPerMonth: z.number().int().min(0).max(31),
    annualNoticeWorkDays: z.number().int().min(0).max(30),
    remoteNoticeWorkDays: z.number().int().min(0).max(30),
    overtimeMinutesPerLeaveDay: minutesSetting(60, 960),
  })
  .meta({ id: 'HrSettings' });

export type HrSettings = z.infer<typeof hrSettingsSchema>;

/*
 * Part B: leave (rules B4–B18). Requests of kind `leave` and `permission`, the leave balance
 * ledger and the opinions on requests. Part C adds `passkey_replacement` (rule C9: a new
 * attendance passkey waiting for the General Manager), remote days and corrections (rule C19).
 */

export const HR_REQUEST_KINDS = [
  'leave',
  'permission',
  'passkey_replacement',
  'remote_day',
  'correction',
] as const;

export const hrRequestKindSchema = z.enum(HR_REQUEST_KINDS).meta({ id: 'HrRequestKind' });

export type HrRequestKind = z.infer<typeof hrRequestKindSchema>;

export const LEAVE_TYPES = ['annual', 'sick', 'emergency', 'unpaid'] as const;

export const leaveTypeSchema = z.enum(LEAVE_TYPES).meta({ id: 'LeaveType' });

export type LeaveType = z.infer<typeof leaveTypeSchema>;

/** The leave types with a balance; unpaid leave has none. */
export const BALANCE_LEAVE_TYPES = ['annual', 'sick', 'emergency'] as const;

export const balanceLeaveTypeSchema = z.enum(BALANCE_LEAVE_TYPES).meta({ id: 'BalanceLeaveType' });

export type BalanceLeaveType = z.infer<typeof balanceLeaveTypeSchema>;

export const LEAVE_HALVES = ['first_half', 'second_half'] as const;

export const leaveHalfSchema = z.enum(LEAVE_HALVES).meta({ id: 'LeaveHalf' });

export type LeaveHalf = z.infer<typeof leaveHalfSchema>;

export const HR_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;

export const hrRequestStatusSchema = z.enum(HR_REQUEST_STATUSES).meta({ id: 'HrRequestStatus' });

export type HrRequestStatus = z.infer<typeof hrRequestStatusSchema>;

/** What a ledger row records (spec, `leave_ledger`); `overtime_credit` is rule C18's time off. */
export const LEDGER_ENTRIES = [
  'opening',
  'accrual',
  'grant',
  'carry_over',
  'expiry',
  'taken',
  'restored',
  'adjustment',
  'overtime_credit',
] as const;

export const ledgerEntrySchema = z.enum(LEDGER_ENTRIES).meta({ id: 'LedgerEntry' });

export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

export const HR_REQUEST_LIMITS = {
  reason: 500,
  note: 500,
  opinion: 1000,
  leaveDays: 60,
  remoteDays: 31,
} as const;

export const personRefSchema = z.object({ id: z.uuid(), name: z.string() });

/** The weekday of a date (`WEEKDAYS`). */
export function weekdayOf(date: CalendarDate): Weekday {
  return WEEKDAYS[(weekday(date) + 1) % 7] as Weekday;
}

/** Rule B1: a work day of a user is a weekday of their schedule that is not a public holiday. */
export function isScheduleWorkDay(
  date: CalendarDate,
  workWeekdays: readonly Weekday[],
  holidays: readonly HolidayRange[],
): boolean {
  return (
    workWeekdays.includes(weekdayOf(date)) &&
    !holidays.some((holiday) => holiday.startsOn <= date && date <= holiday.endsOn)
  );
}

/** One work day a leave covers: a whole day, or half of one. */
export interface LeaveUnit {
  date: CalendarDate;
  days: 1 | 0.5;
}

/**
 * The work days a leave covers, in order (rule B11: a single-day leave may be a half day).
 * Holidays and off days count for nothing.
 */
export function leaveUnits(
  leave: { startsOn: CalendarDate; endsOn: CalendarDate; half: LeaveHalf | null },
  workWeekdays: readonly Weekday[],
  holidays: readonly HolidayRange[],
): LeaveUnit[] {
  const units: LeaveUnit[] = [];
  for (let date = leave.startsOn; date <= leave.endsOn; date = addDays(date, 1)) {
    if (isScheduleWorkDay(date, workWeekdays, holidays)) {
      units.push({ date, days: leave.half ? 0.5 : 1 });
    }
  }
  return units;
}

/** Rounds down to a half day; float noise never loses half a day. */
export function floorHalfDay(days: number): number {
  return Math.floor(days * 2 + 1e-9) / 2;
}

/** A sum of half days, without float noise. */
export function sumDays(values: readonly number[]): number {
  return Math.round(values.reduce((total, value) => total + value, 0) * 2) / 2;
}

/** The days of `units`. */
export function unitDays(units: readonly LeaveUnit[]): number {
  return sumDays(units.map((unit) => unit.days));
}

/**
 * The paid days of `units` by year, the first `paidDays` of them being paid (rule B12: the
 * overflow of a sick or emergency leave is its last days). With `from`, only the days on or after
 * it count (rule B15: the days not taken yet).
 */
export function paidDaysByYear(
  units: readonly LeaveUnit[],
  paidDays: number,
  from?: CalendarDate,
): Map<number, number> {
  const result = new Map<number, number>();
  let left = paidDays;
  for (const unit of units) {
    const paid = Math.min(unit.days, left);
    left -= paid;
    if (paid > 0 && (!from || unit.date >= from)) {
      const year = Number(unit.date.slice(0, 4));
      result.set(year, sumDays([result.get(year) ?? 0, paid]));
    }
  }
  return result;
}

/**
 * Rule B12: the paid and unpaid days of a leave. Annual leave is wholly paid (beyond the balance
 * it is refused before this) and unpaid leave wholly unpaid. Sick days are paid up to the sick
 * balance; emergency days up to both the emergency cap and the annual balance they draw on.
 */
export function leaveSplit(
  leaveType: LeaveType,
  days: number,
  available: Record<BalanceLeaveType, number>,
): { paidDays: number; unpaidDays: number } {
  const limit =
    leaveType === 'annual'
      ? days
      : leaveType === 'unpaid'
        ? 0
        : leaveType === 'sick'
          ? available.sick
          : Math.min(available.emergency, available.annual);
  const paidDays = Math.max(0, Math.min(days, floorHalfDay(limit)));
  return { paidDays, unpaidDays: sumDays([days, -paidDays]) };
}

/** The time a request covers, as rule B8 compares it. */
export interface RequestSpan {
  kind: HrRequestKind;
  startsOn: CalendarDate;
  endsOn: CalendarDate;
  half: LeaveHalf | null;
  fromTime: TimeOfDay | null;
  toTime: TimeOfDay | null;
}

/**
 * Rule B8: whether two requests of one user cover the same time. Two halves of one day fit
 * together, and a permission fits beside a half-day leave or another permission of the day whose
 * window it does not share. A remote day (rule C19) meets only another remote day: it says where
 * the day is worked, so leave and permissions fit beside it.
 */
export function requestsOverlap(a: RequestSpan, b: RequestSpan): boolean {
  if (a.startsOn > b.endsOn || b.startsOn > a.endsOn) return false;
  if (a.kind === 'remote_day' || b.kind === 'remote_day') return a.kind === b.kind;
  if (a.kind === 'permission' && b.kind === 'permission') {
    return (a.fromTime ?? '') < (b.toTime ?? '') && (b.fromTime ?? '') < (a.toTime ?? '');
  }
  if (a.kind === 'permission') return b.half === null;
  if (b.kind === 'permission') return a.half === null;
  return !(a.half && b.half && a.half !== b.half);
}

/**
 * Rule B4: the annual accrual posted on day 1 of the month after `period` (`YYYY-MM`): a twelfth
 * of `annualDays`, pro rata by days in the month the employee started, rounded down to a half day
 * by carrying the remainder through the year, so a year's accruals add up to its entitlement.
 * `accruedBefore` is what the earlier accruals of the period's year added.
 */
export function accrualDays(input: {
  annualDays: number;
  startDate: CalendarDate;
  period: string;
  accruedBefore: number;
}): number {
  const { annualDays, startDate, period } = input;
  const year = period.slice(0, 4);
  let exact = 0;
  for (let month = 1; month <= Number(period.slice(5, 7)); month += 1) {
    const first = `${year}-${String(month).padStart(2, '0')}-01`;
    const last = lastOfMonth(first);
    if (startDate > last) continue;
    const worked = startDate > first ? daysInclusive(startDate, last) : daysInclusive(first, last);
    exact += ((annualDays / 12) * worked) / daysInclusive(first, last);
  }
  return Math.max(0, sumDays([floorHalfDay(exact), -input.accruedBefore]));
}

/**
 * Rule B5: at the year's end, the unused annual balance up to `carryOverMaxDays` is carried into
 * the new year and the rest expires; a negative balance is carried as it is.
 */
export function rollover(
  balance: number,
  carryOverMaxDays: number,
): { carried: number; expired: number } {
  if (balance <= 0) return { carried: balance, expired: 0 };
  const carried = Math.min(balance, carryOverMaxDays);
  return { carried, expired: sumDays([balance, -carried]) };
}

const requestReason = optionalText(HR_REQUEST_LIMITS.reason).default(null);

/** `userId`: `hr.approve` records a request for someone, approved at once (rule B8). */
const leaveRequestSchema = z.object({
  kind: z.literal('leave'),
  userId: z.uuid().optional(),
  leaveType: leaveTypeSchema,
  startsOn: calendarDateSchema,
  endsOn: calendarDateSchema,
  half: leaveHalfSchema.nullable().default(null),
  reason: requestReason,
});

const permissionRequestSchema = z.object({
  kind: z.literal('permission'),
  userId: z.uuid().optional(),
  date: calendarDateSchema,
  fromTime: timeOfDaySchema,
  toTime: timeOfDaySchema,
  reason: requestReason,
});

/** Rule C19: days worked remotely, up to `HR_REQUEST_LIMITS.remoteDays` days. */
const remoteDayRequestSchema = z.object({
  kind: z.literal('remote_day'),
  userId: z.uuid().optional(),
  startsOn: calendarDateSchema,
  endsOn: calendarDateSchema,
  reason: requestReason,
});

/** Rule C19: a forgotten punch, `direction` at `time` on `date`. */
const correctionRequestSchema = z.object({
  kind: z.literal('correction'),
  userId: z.uuid().optional(),
  date: calendarDateSchema,
  direction: punchDirectionSchema,
  time: timeOfDaySchema,
  reason: requestReason,
});

/**
 * Rules B8–B13 and C19: a leave of up to `HR_REQUEST_LIMITS.leaveDays` days, a half day only on a
 * single day, a reason except for annual leave; a permission with a reason and a window that ends
 * after it starts; remote days and corrections with a reason. Balances, notice, overlaps and the
 * correction's moment need the database and the clock.
 */
export const createHrRequestSchema = z
  .discriminatedUnion('kind', [
    leaveRequestSchema,
    permissionRequestSchema,
    remoteDayRequestSchema,
    correctionRequestSchema,
  ])
  .superRefine((request, ctx) => {
    if (request.kind === 'remote_day' || request.kind === 'correction') {
      if (!request.reason) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Required' });
    }
    if (request.kind === 'correction') return;
    if (request.kind === 'remote_day') {
      if (request.endsOn < request.startsOn) {
        ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'Ends on or after the start' });
      } else if (daysInclusive(request.startsOn, request.endsOn) > HR_REQUEST_LIMITS.remoteDays) {
        ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'Too long' });
      }
      return;
    }
    if (request.kind === 'leave') {
      if (request.endsOn < request.startsOn) {
        ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'Ends on or after the start' });
      } else if (daysInclusive(request.startsOn, request.endsOn) > HR_REQUEST_LIMITS.leaveDays) {
        ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'Too long' });
      }
      if (request.half && request.startsOn !== request.endsOn) {
        ctx.addIssue({ code: 'custom', path: ['half'], message: 'A half day is a single day' });
      }
      if (request.leaveType !== 'annual' && !request.reason) {
        ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Required' });
      }
      return;
    }
    if (request.toTime <= request.fromTime) {
      ctx.addIssue({ code: 'custom', path: ['toTime'], message: 'Ends after it starts' });
    }
    if (!request.reason) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Required' });
  })
  .meta({ id: 'CreateHrRequest' });

export type CreateHrRequest = z.infer<typeof createHrRequestSchema>;

export type CreateHrRequestInput = z.input<typeof createHrRequestSchema>;

/** The minutes of a permission's window. */
export function permissionMinutes(window: { fromTime: TimeOfDay; toTime: TimeOfDay }): number {
  return minutesOfDay(window.toTime) - minutesOfDay(window.fromTime);
}

export const HR_REQUEST_WARNINGS = ['short_notice', 'unpaid_days', 'certificate_required'] as const;

export const hrRequestWarningSchema = z.enum(HR_REQUEST_WARNINGS).meta({ id: 'HrRequestWarning' });

export type HrRequestWarning = z.infer<typeof hrRequestWarningSchema>;

/** What a request would be, shown before it is submitted (rules B9, B12, B13). */
export const hrRequestPreviewSchema = z
  .object({
    /** Work days a leave or remote days cover; null for a permission or a correction. */
    days: z.number().nullable(),
    paidDays: z.number().nullable(),
    unpaidDays: z.number().nullable(),
    shortNotice: z.boolean(),
    warnings: z.array(hrRequestWarningSchema),
  })
  .meta({ id: 'HrRequestPreview' });

export type HrRequestPreview = z.infer<typeof hrRequestPreviewSchema>;

export const hrRequestSchema = z
  .object({
    id: z.uuid(),
    user: personRefSchema,
    kind: hrRequestKindSchema,
    /** Leave only. */
    leaveType: leaveTypeSchema.nullable(),
    /** A permission's or a correction's day is both. */
    startsOn: calendarDateSchema,
    endsOn: calendarDateSchema,
    half: leaveHalfSchema.nullable(),
    /** Permission: its window; correction: `fromTime` is the punch's time. */
    fromTime: timeOfDaySchema.nullable(),
    toTime: timeOfDaySchema.nullable(),
    /** Correction only (rule C19). */
    correctionDirection: punchDirectionSchema.nullable(),
    /**
     * Leave: the work days it covers, and their paid and unpaid split (rule B12); remote days:
     * the work days they cover.
     */
    days: z.number().nullable(),
    paidDays: z.number().nullable(),
    unpaidDays: z.number().nullable(),
    reason: z.string().nullable(),
    shortNotice: z.boolean(),
    status: hrRequestStatusSchema,
    /** Rule B13: a sick leave longer than the setting needs a certificate. */
    certificateRequired: z.boolean(),
    /** Live documents attached to the request (F10 owner `hr_request`). */
    documents: z.number().int().min(0),
    createdBy: personRefSchema,
    decidedBy: personRefSchema.nullable(),
    decidedAt: instantSchema.nullable(),
    decisionNote: z.string().nullable(),
    createdAt: instantSchema,
    updatedAt: instantSchema,
  })
  .meta({ id: 'HrRequest' });

export type HrRequest = z.infer<typeof hrRequestSchema>;

export const hrRequestListQuerySchema = pageQuerySchema.extend({
  status: queryListSchema(hrRequestStatusSchema).optional(),
  kind: hrRequestKindSchema.optional(),
  /** `me` for one's own; others' requests need `hr.read` covering them. */
  userId: z.union([z.uuid(), z.literal('me')]).optional(),
  departmentId: z.uuid().optional(),
  /** Requests with a day in this month. */
  month: calendarMonthSchema.optional(),
  /** By submission time: oldest first for the approvals inbox, newest first by default. */
  order: sortOrderSchema.default('desc'),
});

export type HrRequestListQuery = z.infer<typeof hrRequestListQuerySchema>;

export type HrRequestListQueryInput = z.input<typeof hrRequestListQuerySchema>;

export const hrRequestPageSchema = pageSchema(hrRequestSchema).meta({
  id: 'HrRequestPage',
  description: 'Requests by submission time',
});

export type HrRequestPage = z.infer<typeof hrRequestPageSchema>;

/** On a request, or on an attendance item (rule C17). */
export const hrOpinionSchema = z
  .object({
    id: z.uuid(),
    requestId: z.uuid().nullable(),
    itemId: z.uuid().nullable(),
    author: personRefSchema,
    body: z.string(),
    createdAt: instantSchema,
  })
  .meta({ id: 'HrOpinion' });

export type HrOpinion = z.infer<typeof hrOpinionSchema>;

/** Rule B14: a department manager's or Ops' comment on a pending request or item. */
export const createHrOpinionSchema = z
  .object({
    requestId: z.uuid().optional(),
    itemId: z.uuid().optional(),
    body: z.string().trim().min(1).max(HR_REQUEST_LIMITS.opinion),
  })
  .refine((opinion) => !opinion.requestId !== !opinion.itemId, {
    message: 'A request or an item',
    path: ['itemId'],
  })
  .meta({ id: 'CreateHrOpinion' });

export type CreateHrOpinion = z.infer<typeof createHrOpinionSchema>;

export const OVERLAPPING_WORK_KINDS = ['task', 'shoot', 'meeting'] as const;

/** Rule B14: the employee's open work in a leave's period, shown before deciding. */
export const overlappingWorkSchema = z
  .object({
    kind: z.enum(OVERLAPPING_WORK_KINDS),
    id: z.uuid(),
    title: z.string(),
    /** A task's due date; a shoot's or meeting's first day. */
    date: calendarDateSchema,
    /** Shoots and meetings only. */
    startsAt: instantSchema.nullable(),
  })
  .meta({ id: 'OverlappingWork' });

export type OverlappingWork = z.infer<typeof overlappingWorkSchema>;

export const hrRequestPermissionsSchema = z
  .object({
    /** `hr.approve` on a pending request. */
    canDecide: z.boolean(),
    /** Rule B15. */
    canCancel: z.boolean(),
    /** `hr.read` covering the employee, on someone else's pending request. */
    canGiveOpinion: z.boolean(),
  })
  .meta({ id: 'HrRequestPermissions', description: 'What the caller may do, for the UI' });

export type HrRequestPermissions = z.infer<typeof hrRequestPermissionsSchema>;

export const hrRequestDetailSchema = hrRequestSchema
  .extend({
    /** Oldest first. */
    opinions: z.array(hrOpinionSchema),
    /** For `hr.approve` on a leave, by date; null otherwise. */
    overlappingWork: z.array(overlappingWorkSchema).nullable(),
    permissions: hrRequestPermissionsSchema,
  })
  .meta({ id: 'HrRequestDetail' });

export type HrRequestDetail = z.infer<typeof hrRequestDetailSchema>;

/** Rule B14: a note is required to reject. */
export const decideHrRequestSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    note: optionalText(HR_REQUEST_LIMITS.note).default(null),
    /** Rule B13: approve a sick leave without its certificate. */
    confirmMissingCertificate: z.boolean().default(false),
  })
  .refine((decision) => decision.decision === 'approve' || !!decision.note, {
    message: 'A rejection needs a note',
    path: ['note'],
  })
  .meta({ id: 'DecideHrRequest' });

export type DecideHrRequest = z.infer<typeof decideHrRequestSchema>;

export type DecideHrRequestInput = z.input<typeof decideHrRequestSchema>;

export const cancelHrRequestSchema = z
  .object({ note: optionalText(HR_REQUEST_LIMITS.note).default(null) })
  .meta({ id: 'CancelHrRequest' });

export type CancelHrRequest = z.infer<typeof cancelHrRequestSchema>;

export const leaveBalanceQuerySchema = z.object({ year: holidayYearSchema });

export type LeaveBalanceQuery = z.infer<typeof leaveBalanceQuerySchema>;

export const ledgerRowSchema = z
  .object({
    id: z.uuid(),
    leaveType: balanceLeaveTypeSchema,
    year: z.number().int(),
    /** Signed. */
    days: z.number(),
    entry: ledgerEntrySchema,
    /** `YYYY-MM` for an accrual. */
    period: z.string().nullable(),
    requestId: z.uuid().nullable(),
    /** `overtime_credit`: the overtime item it credits or gives back (rule C18). */
    itemId: z.uuid().nullable(),
    note: z.string().nullable(),
    /** Null for the daily job. */
    createdBy: personRefSchema.nullable(),
    createdAt: instantSchema,
  })
  .meta({ id: 'LedgerRow' });

export type LedgerRow = z.infer<typeof ledgerRowSchema>;

/** One balance of a year: the sum of its ledger, and its parts. */
export const leaveTypeBalanceSchema = z
  .object({
    leaveType: balanceLeaveTypeSchema,
    balance: z.number(),
    /** Days of pending requests; `available` is the balance less these. */
    pending: z.number(),
    available: z.number(),
    opening: z.number(),
    /** Accruals and grants. */
    accrued: z.number(),
    carriedOver: z.number(),
    /** Taken less restored, as a positive number. */
    taken: z.number(),
    /** Expired at the year's end, as a positive number. */
    expired: z.number(),
    adjusted: z.number(),
  })
  .meta({ id: 'LeaveTypeBalance' });

export type LeaveTypeBalance = z.infer<typeof leaveTypeBalanceSchema>;

export const leaveBalanceSchema = z
  .object({
    userId: z.uuid(),
    year: z.number().int(),
    /** Annual, sick and emergency, in that order. */
    balances: z.array(leaveTypeBalanceSchema),
    /** The year's rows, newest first. */
    ledger: z.array(ledgerRowSchema),
  })
  .meta({ id: 'LeaveBalance' });

export type LeaveBalance = z.infer<typeof leaveBalanceSchema>;

/** Rules B6 and B7: `hr.approve` records an opening balance or a signed adjustment. */
export const createLeaveAdjustmentSchema = z
  .object({
    leaveType: balanceLeaveTypeSchema,
    year: holidayYearSchema,
    days: z
      .number()
      .min(-HR_REQUEST_LIMITS.leaveDays)
      .max(HR_REQUEST_LIMITS.leaveDays)
      .refine((days) => days !== 0 && Number.isInteger(days * 2), 'Whole or half days, not 0'),
    note: z.string().trim().min(1).max(HR_REQUEST_LIMITS.note),
    entry: z.enum(['adjustment', 'opening']),
  })
  .meta({ id: 'CreateLeaveAdjustment' });

export type CreateLeaveAdjustment = z.infer<typeof createLeaveAdjustmentSchema>;

/** Rule B16: approved leave on the company calendar; the type only for `hr.read` in scope. */
export const calendarLeaveSchema = z
  .object({
    requestId: z.uuid(),
    user: personRefSchema,
    startsOn: calendarDateSchema,
    endsOn: calendarDateSchema,
    half: leaveHalfSchema.nullable(),
    leaveType: leaveTypeSchema.nullable(),
  })
  .meta({ id: 'CalendarLeave' });

export type CalendarLeave = z.infer<typeof calendarLeaveSchema>;

/** Rule B17: a leave of the assignee covering a task's due date (`ASSIGNEE_ON_LEAVE` details). */
export const assigneeLeaveSchema = z
  .object({ startsOn: calendarDateSchema, endsOn: calendarDateSchema })
  .meta({ id: 'AssigneeLeave' });

export type AssigneeLeave = z.infer<typeof assigneeLeaveSchema>;
