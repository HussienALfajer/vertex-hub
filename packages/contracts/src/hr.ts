import { z } from 'zod';
import {
  addDays,
  type CalendarDate,
  calendarDateSchema,
  daysInclusive,
  instantSchema,
  lastOfMonth,
  type TimeOfDay,
  timeOfDaySchema,
} from './dates.js';
import { userDepartmentSchema } from './departments.js';
import { pageQuerySchema, pageSchema } from './lists.js';
import { currencySchema } from './money.js';
import { optionalText } from './text.js';
import { phoneSchema } from './users.js';

/*
 * HR (spec F17, ADR 0039). Part A: the employee file of every user, salary history, payout
 * method and the end of service. Part B: work schedules, public holidays and the HR settings;
 * leave, attendance and months follow.
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
