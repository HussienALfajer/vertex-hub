import {
  EMPLOYMENT_TYPES,
  END_REASONS,
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
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { archivedAt, id, minorAmount, timestamps } from './columns.js';
import { currencyEnum } from './projects.js';

/*
 * HR (spec F17, ADR 0039), owned by the api `hr` module. Part A: work schedules, the employee
 * file of every user and the salary history. Days are Asia/Damascus calendar dates.
 */

export const weekdayEnum = pgEnum('weekday', WEEKDAYS);

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
