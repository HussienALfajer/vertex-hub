import {
  ATTENDANCE_PUNCH_DIRECTIONS,
  BALANCE_LEAVE_TYPES,
  EMPLOYMENT_TYPES,
  END_REASONS,
  HR_REQUEST_KINDS,
  HR_REQUEST_STATUSES,
  type LatenessTier,
  LEAVE_HALVES,
  LEAVE_TYPES,
  LEDGER_ENTRIES,
  PAYOUT_METHODS,
  WEEKDAYS,
  WORK_SCHEDULE_KINDS,
} from '@vertex-hub/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { archivedAt, id, minorAmount, timestamps } from './columns.js';
import { currencyEnum } from './projects.js';

/*
 * HR (spec F17, ADR 0039), owned by the api `hr` module. Part A: work schedules, the employee
 * file of every user and the salary history. Part B: public holidays, the HR settings, leave and
 * permission requests, the leave balance ledger and the opinions on requests. Days are
 * Asia/Damascus calendar dates.
 */

export const weekdayEnum = pgEnum('weekday', WEEKDAYS);

/** Leave days in half days (spec, Data). */
export const leaveDays = (name: string) =>
  numeric(name, { precision: 5, scale: 1, mode: 'number' });

export const workScheduleKindEnum = pgEnum('work_schedule_kind', WORK_SCHEDULE_KINDS);

export const employmentTypeEnum = pgEnum('employment_type', EMPLOYMENT_TYPES);

export const payoutMethodEnum = pgEnum('payout_method', PAYOUT_METHODS);

export const endReasonEnum = pgEnum('end_reason', END_REASONS);

export const workSchedules = pgTable(
  'work_schedules',
  {
    id: id(),
    name: text('name').notNull(),
    kind: workScheduleKindEnum('kind').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    uniqueIndex('work_schedules_name_key').on(sql`lower(${table.name})`),
    /** Exactly one default (rule B2). */
    uniqueIndex('work_schedules_default_key').on(table.isDefault).where(sql`${table.isDefault}`),
  ],
);

/** A weekday without a row is an off day. */
export const workScheduleDays = pgTable(
  'work_schedule_days',
  {
    scheduleId: uuid('schedule_id')
      .notNull()
      .references(() => workSchedules.id),
    weekday: weekdayEnum('weekday').notNull(),
    /** Fixed: the start; flexible: the window opens. */
    startTime: time('start_time').notNull(),
    /** Flexible only: the window closes. */
    latestStartTime: time('latest_start_time'),
    requiredMinutes: integer('required_minutes').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scheduleId, table.weekday] }),
    check('work_schedule_days_minutes_check', sql`${table.requiredMinutes} between 60 and 960`),
    check(
      'work_schedule_days_window_check',
      sql`${table.latestStartTime} is null or ${table.latestStartTime} >= ${table.startTime}`,
    ),
  ],
);

/** One per user (rule A1), archived and restored with the account. */
export const employeeFiles = pgTable(
  'employee_files',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    nationalId: text('national_id'),
    birthDate: date('birth_date', { mode: 'string' }),
    address: text('address'),
    emergencyName: text('emergency_name'),
    emergencyPhone: text('emergency_phone'),
    emergencyRelation: text('emergency_relation'),
    employmentType: employmentTypeEnum('employment_type').notNull().default('full_time'),
    startDate: date('start_date', { mode: 'string' }),
    probationEndDate: date('probation_end_date', { mode: 'string' }),
    contractEndDate: date('contract_end_date', { mode: 'string' }),
    scheduleId: uuid('schedule_id')
      .notNull()
      .references(() => workSchedules.id),
    attendanceExempt: boolean('attendance_exempt').notNull().default(false),
    remoteWeekdays: weekdayEnum('remote_weekdays').array().notNull().default(sql`'{}'::weekday[]`),
    annualLeaveDays: numeric('annual_leave_days', {
      precision: 4,
      scale: 1,
      mode: 'number',
    }).notNull(),
    payoutMethod: payoutMethodEnum('payout_method'),
    payoutInstitution: text('payout_institution'),
    payoutAccount: text('payout_account'),
    payoutHolder: text('payout_holder'),
    endedOn: date('ended_on', { mode: 'string' }),
    endReason: endReasonEnum('end_reason'),
    endNote: text('end_note'),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    uniqueIndex('employee_files_user_id_key').on(table.userId),
    index('employee_files_schedule_id_idx').on(table.scheduleId),
    check(
      'employee_files_dates_check',
      sql`${table.startDate} is null or ((${table.probationEndDate} is null or ${table.probationEndDate} >= ${table.startDate}) and (${table.contractEndDate} is null or ${table.contractEndDate} >= ${table.startDate}))`,
    ),
    check(
      'employee_files_end_check',
      sql`(${table.endedOn} is null) = (${table.endReason} is null)`,
    ),
    check(
      'employee_files_payout_check',
      sql`${table.payoutMethod} in ('bank_transfer', 'mobile_wallet') or (${table.payoutInstitution} is null and ${table.payoutAccount} is null and ${table.payoutHolder} is null)`,
    ),
  ],
);

/** Added and archived, never edited (rule A4). */
export const salaryChanges = pgTable(
  'salary_changes',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    effectiveOn: date('effective_on', { mode: 'string' }).notNull(),
    amountMinor: minorAmount('amount_minor').notNull(),
    currency: currencyEnum('currency').notNull(),
    reason: text('reason').notNull(),
    createdById: uuid('created_by_id').references(() => users.id),
    archiveReason: text('archive_reason'),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('salary_changes_user_id_idx').on(table.userId),
    index('salary_changes_created_by_id_idx').on(table.createdById),
    uniqueIndex('salary_changes_effective_key')
      .on(table.userId, table.effectiveOn)
      .where(sql`${table.archivedAt} is null`),
    check('salary_changes_amount_check', sql`${table.amountMinor} > 0`),
    check(
      'salary_changes_archive_check',
      sql`(${table.archivedAt} is null) = (${table.archiveReason} is null)`,
    ),
  ],
);

/** Rule B3: at most ten days each; overlapping non-archived holidays are refused by the API. */
export const publicHolidays = pgTable(
  'public_holidays',
  {
    id: id(),
    name: text('name').notNull(),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }).notNull(),
    paid: boolean('paid').notNull().default(true),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('public_holidays_starts_on_idx').on(table.startsOn),
    check(
      'public_holidays_range_check',
      sql`${table.endsOn} >= ${table.startsOn} and ${table.endsOn} - ${table.startsOn} < 10`,
    ),
  ],
);

/** The single row of HR settings; its column defaults are the spec's (owner, 2026-10-21). */
export const hrSettings = pgTable(
  'hr_settings',
  {
    /** Always true: the table holds one row. */
    singleton: boolean('singleton').primaryKey().default(true),
    /** Rule C1: null keeps attendance in trial. */
    attendanceStartsOn: date('attendance_starts_on', { mode: 'string' }),
    graceMinutes: integer('grace_minutes').notNull().default(10),
    latenessTiers: jsonb('lateness_tiers')
      .$type<LatenessTier[]>()
      .notNull()
      .default([
        { upToMinutes: 30, fraction: 0.25 },
        { upToMinutes: 60, fraction: 0.5 },
        { upToMinutes: null, fraction: 1 },
      ]),
    firstLatenessWarning: boolean('first_lateness_warning').notNull().default(true),
    overtimeMinMinutes: integer('overtime_min_minutes').notNull().default(30),
    checkInReminderMinutes: integer('check_in_reminder_minutes').notNull().default(15),
    defaultAnnualLeaveDays: leaveDays('default_annual_leave_days').notNull().default(14),
    carryOverMaxDays: leaveDays('carry_over_max_days').notNull().default(5),
    sickDaysPerYear: leaveDays('sick_days_per_year').notNull().default(14),
    sickCertificateAfterDays: integer('sick_certificate_after_days').notNull().default(2),
    sickRequestWithinWorkDays: integer('sick_request_within_work_days').notNull().default(3),
    emergencyDaysPerYear: leaveDays('emergency_days_per_year').notNull().default(3),
    permissionMaxMinutes: integer('permission_max_minutes').notNull().default(120),
    permissionsPerMonth: integer('permissions_per_month').notNull().default(4),
    annualNoticeWorkDays: integer('annual_notice_work_days').notNull().default(3),
    remoteNoticeWorkDays: integer('remote_notice_work_days').notNull().default(1),
    overtimeMinutesPerLeaveDay: integer('overtime_minutes_per_leave_day').notNull().default(480),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedById: uuid('updated_by_id').references(() => users.id),
  },
  (table) => [
    index('hr_settings_updated_by_id_idx').on(table.updatedById),
    check('hr_settings_singleton_check', sql`${table.singleton}`),
  ],
);

export const hrRequestKindEnum = pgEnum('hr_request_kind', HR_REQUEST_KINDS);

export const leaveTypeEnum = pgEnum('leave_type', LEAVE_TYPES);

export const balanceLeaveTypeEnum = pgEnum('balance_leave_type', BALANCE_LEAVE_TYPES);

export const leaveHalfEnum = pgEnum('leave_half', LEAVE_HALVES);

export const hrRequestStatusEnum = pgEnum('hr_request_status', HR_REQUEST_STATUSES);

export const ledgerEntryEnum = pgEnum('ledger_entry', LEDGER_ENTRIES);

/** A punch's direction; declared here for `hr_requests` and reused by `attendance_punches`. */
export const punchDirectionEnum = pgEnum('punch_direction', ATTENDANCE_PUNCH_DIRECTIONS);

/**
 * Rules B8–B15 and C19: leave, permission, remote-day and correction requests. A permission's or
 * a correction's day is both `starts_on` and `ends_on`; `days` and the split are a leave's only
 * (remote days have `days`). A correction's punch time is `from_time`. A `passkey_replacement`
 * (rule C9) is dated the day it was asked. A cancelled request keeps the canceller in
 * `decided_by_id`.
 */
export const hrRequests = pgTable(
  'hr_requests',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    kind: hrRequestKindEnum('kind').notNull(),
    leaveType: leaveTypeEnum('leave_type'),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }).notNull(),
    half: leaveHalfEnum('half'),
    fromTime: time('from_time'),
    toTime: time('to_time'),
    correctionDirection: punchDirectionEnum('correction_direction'),
    days: leaveDays('days'),
    paidDays: leaveDays('paid_days'),
    unpaidDays: leaveDays('unpaid_days'),
    reason: text('reason'),
    shortNotice: boolean('short_notice').notNull().default(false),
    status: hrRequestStatusEnum('status').notNull().default('pending'),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id),
    decidedById: uuid('decided_by_id').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('hr_requests_user_id_idx').on(table.userId, table.startsOn),
    index('hr_requests_created_by_id_idx').on(table.createdById),
    index('hr_requests_decided_by_id_idx').on(table.decidedById),
    index('hr_requests_status_idx').on(table.status, table.createdAt),
    check('hr_requests_range_check', sql`${table.endsOn} >= ${table.startsOn}`),
    check(
      'hr_requests_kind_check',
      sql`(${table.kind} = 'leave' and ${table.leaveType} is not null and ${table.fromTime} is null and ${table.toTime} is null and ${table.days} is not null)
        or (${table.kind} = 'permission' and ${table.leaveType} is null and ${table.half} is null and ${table.startsOn} = ${table.endsOn} and ${table.fromTime} < ${table.toTime})
        or (${table.kind}::text = 'passkey_replacement' and ${table.leaveType} is null and ${table.half} is null and ${table.fromTime} is null and ${table.toTime} is null and ${table.days} is null and ${table.startsOn} = ${table.endsOn})
        or (${table.kind}::text = 'remote_day' and ${table.leaveType} is null and ${table.half} is null and ${table.fromTime} is null and ${table.toTime} is null and ${table.days} is not null)
        or (${table.kind}::text = 'correction' and ${table.leaveType} is null and ${table.half} is null and ${table.fromTime} is not null and ${table.toTime} is null and ${table.days} is null and ${table.startsOn} = ${table.endsOn})`,
    ),
    check(
      'hr_requests_correction_check',
      sql`(${table.kind}::text = 'correction') = (${table.correctionDirection} is not null)`,
    ),
    check(
      'hr_requests_half_check',
      sql`${table.half} is null or ${table.startsOn} = ${table.endsOn}`,
    ),
  ],
);
