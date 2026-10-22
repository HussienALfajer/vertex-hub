import {
  ATTENDANCE_DAY_KINDS,
  ATTENDANCE_DAY_STATUSES,
  ATTENDANCE_ITEM_KINDS,
  ATTENDANCE_ITEM_STATUSES,
  ATTENDANCE_MONTH_STATUSES,
  ATTENDANCE_PLACES,
  DAY_LEAVES,
  FIELD_REVIEWS,
  PASSKEY_STATUSES,
  PUNCH_METHODS,
} from '@vertex-hub/contracts';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { meetings, shoots } from './calendar.js';
import { archivedAt, id, timestamps } from './columns.js';
import {
  balanceLeaveTypeEnum,
  hrRequests,
  leaveDays,
  ledgerEntryEnum,
  punchDirectionEnum,
} from './hr.js';
import { tasks } from './tasks.js';

/*
 * HR attendance (spec F17 part C, ADR 0039), owned by the api `hr` module: attendance passkeys,
 * entrance screens, punches and the days computed from them. Days are Asia/Damascus dates.
 */

export const passkeyStatusEnum = pgEnum('attendance_passkey_status', PASSKEY_STATUSES);

/**
 * Rules C3 and C9: WebAuthn credentials for attendance only, never for signing in. At most one
 * active and one pending per user; revoked rows are kept.
 */
export const attendancePasskeys = pgTable(
  'attendance_passkeys',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** base64url. */
    credentialId: text('credential_id').notNull(),
    /** The COSE public key, base64url. */
    publicKey: text('public_key').notNull(),
    counter: bigint('counter', { mode: 'number' }).notNull().default(0),
    transports: text('transports').array().notNull().default(sql`'{}'::text[]`),
    deviceLabel: text('device_label').notNull(),
    status: passkeyStatusEnum('status').notNull(),
    /** Who approved the replacement or revoked it. */
    decidedById: uuid('decided_by_id').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    uniqueIndex('attendance_passkeys_credential_id_key').on(table.credentialId),
    index('attendance_passkeys_user_id_idx').on(table.userId),
    index('attendance_passkeys_decided_by_id_idx').on(table.decidedById),
    uniqueIndex('attendance_passkeys_active_key')
      .on(table.userId)
      .where(sql`${table.status} = 'active'`),
    uniqueIndex('attendance_passkeys_pending_key')
      .on(table.userId)
      .where(sql`${table.status} = 'pending'`),
  ],
);

/** An address a paired screen used, and when (rule C6). */
export interface KioskAddress {
  address: string;
  at: string;
}

/**
 * Rule C4: entrance screens. The screen's cookie and its pairing code are stored as SHA-256
 * hashes; `secret` signs the codes (rule C5), encrypted with `BETTER_AUTH_SECRET`. Archived means
 * unpaired.
 */
export const attendanceKiosks = pgTable(
  'attendance_kiosks',
  {
    id: id(),
    name: text('name').notNull(),
    tokenHash: text('token_hash'),
    pairingCodeHash: text('pairing_code_hash'),
    pairingExpiresAt: timestamp('pairing_expires_at', { withTimezone: true }),
    secret: text('secret').notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    lastIpAddress: text('last_ip_address'),
    /** The addresses seen in the last 10 minutes. */
    recentIps: jsonb('recent_ips').$type<KioskAddress[]>().notNull().default([]),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    uniqueIndex('attendance_kiosks_token_hash_key').on(table.tokenHash),
    uniqueIndex('attendance_kiosks_pairing_code_hash_key').on(table.pairingCodeHash),
    index('attendance_kiosks_created_by_id_idx').on(table.createdById),
  ],
);

export const punchMethodEnum = pgEnum('punch_method', PUNCH_METHODS);

export const fieldReviewEnum = pgEnum('field_review', FIELD_REVIEWS);

/**
 * Rules C7–C13: check-ins and check-outs, at the server's time. A rejected field or shoot punch is
 * archived and no longer counts. Punches write no audit entry: they are the record.
 */
export const attendancePunches = pgTable(
  'attendance_punches',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    direction: punchDirectionEnum('direction').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull(),
    method: punchMethodEnum('method').notNull(),
    kioskId: uuid('kiosk_id').references(() => attendanceKiosks.id),
    ipAddress: text('ip_address'),
    latitude: numeric('latitude', { precision: 9, scale: 6, mode: 'number' }),
    longitude: numeric('longitude', { precision: 9, scale: 6, mode: 'number' }),
    accuracyM: integer('accuracy_m'),
    fieldNote: text('field_note'),
    fieldTaskId: uuid('field_task_id').references(() => tasks.id),
    fieldMeetingId: uuid('field_meeting_id').references(() => meetings.id),
    shootId: uuid('shoot_id').references(() => shoots.id),
    fieldReview: fieldReviewEnum('field_review'),
    /** `correction` only: the request it came from (part C, corrections). */
    requestId: uuid('request_id').references(() => hrRequests.id),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('attendance_punches_user_id_idx').on(table.userId, table.at),
    index('attendance_punches_kiosk_id_idx').on(table.kioskId),
    index('attendance_punches_shoot_id_idx').on(table.shootId),
    index('attendance_punches_field_task_id_idx').on(table.fieldTaskId),
    index('attendance_punches_field_meeting_id_idx').on(table.fieldMeetingId),
    index('attendance_punches_request_id_idx').on(table.requestId),
    check(
      'attendance_punches_method_check',
      sql`(${table.method} = 'office') = (${table.kioskId} is not null)
        and (${table.method} = 'shoot') = (${table.shootId} is not null)
        and (${table.method} <> 'field' or ${table.fieldNote} is not null)
        and (${table.method} not in ('remote', 'field', 'shoot') or ${table.latitude} is not null)
        and (${table.method} in ('field', 'shoot')) = (${table.fieldReview} is not null)`,
    ),
    check(
      'attendance_punches_location_check',
      sql`(${table.latitude} is null) = (${table.longitude} is null)`,
    ),
  ],
);

export const attendanceDayKindEnum = pgEnum('attendance_day_kind', ATTENDANCE_DAY_KINDS);

export const attendancePlaceEnum = pgEnum('attendance_place', ATTENDANCE_PLACES);

export const dayLeaveEnum = pgEnum('day_leave', DAY_LEAVES);

export const attendanceDayStatusEnum = pgEnum('attendance_day_status', ATTENDANCE_DAY_STATUSES);

/**
 * Rules C14–C16: one row per user and date, its expectations frozen from the schedule when it is
 * created, its figures recomputed from punches, leave and holidays.
 */
export const attendanceDays = pgTable(
  'attendance_days',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    date: date('date', { mode: 'string' }).notNull(),
    kind: attendanceDayKindEnum('kind').notNull(),
    expectedStart: timestamp('expected_start', { withTimezone: true }),
    latestStart: timestamp('latest_start', { withTimezone: true }),
    expectedEnd: timestamp('expected_end', { withTimezone: true }),
    requiredMinutes: integer('required_minutes'),
    place: attendancePlaceEnum('place'),
    leave: dayLeaveEnum('leave').notNull().default('none'),
    firstInAt: timestamp('first_in_at', { withTimezone: true }),
    lastOutAt: timestamp('last_out_at', { withTimezone: true }),
    workedMinutes: integer('worked_minutes').notNull().default(0),
    lateMinutes: integer('late_minutes').notNull().default(0),
    earlyMinutes: integer('early_minutes').notNull().default(0),
    overtimeMinutes: integer('overtime_minutes').notNull().default(0),
    status: attendanceDayStatusEnum('status').notNull(),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [uniqueIndex('attendance_days_user_id_date_key').on(table.userId, table.date)],
);

export const attendanceItemKindEnum = pgEnum('attendance_item_kind', ATTENDANCE_ITEM_KINDS);

export const attendanceItemStatusEnum = pgEnum('attendance_item_status', ATTENDANCE_ITEM_STATUSES);

/**
 * Rules C14, C17 and C18: what the General Manager decides about a day. At most one live item per
 * day and kind; one that no longer applies is `void`. `credited_days` is the time off a
 * `time_off` decision added to the annual balance, reversed if the decision changes.
 */
export const attendanceItems = pgTable(
  'attendance_items',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    dayId: uuid('day_id')
      .notNull()
      .references(() => attendanceDays.id),
    kind: attendanceItemKindEnum('kind').notNull(),
    minutes: integer('minutes').notNull(),
    proposedFraction: numeric('proposed_fraction', {
      precision: 4,
      scale: 2,
      mode: 'number',
    }).notNull(),
    justification: text('justification'),
    justifiedAt: timestamp('justified_at', { withTimezone: true }),
    status: attendanceItemStatusEnum('status').notNull().default('pending'),
    decidedFraction: numeric('decided_fraction', { precision: 4, scale: 2, mode: 'number' }),
    decidedMinutes: integer('decided_minutes'),
    creditedDays: numeric('credited_days', { precision: 5, scale: 1, mode: 'number' }),
    decidedById: uuid('decided_by_id').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('attendance_items_user_id_idx').on(table.userId),
    index('attendance_items_day_id_idx').on(table.dayId),
    index('attendance_items_decided_by_id_idx').on(table.decidedById),
    index('attendance_items_status_idx').on(table.status, table.createdAt),
    uniqueIndex('attendance_items_day_kind_key')
      .on(table.dayId, table.kind)
      .where(sql`${table.status} <> 'void'`),
    check('attendance_items_minutes_check', sql`${table.minutes} >= 0`),
    check(
      'attendance_items_decision_check',
      sql`(${table.status} = 'deducted') = (${table.decidedFraction} is not null)
        and (${table.status} in ('paid', 'time_off')) = (${table.decidedMinutes} is not null)
        and (${table.decidedMinutes} is null or ${table.decidedMinutes} <= ${table.minutes})
        and (${table.creditedDays} is null or ${table.status} = 'time_off')`,
    ),
  ],
);

/**
 * Rules B4–B7: the signed leave balance ledger; a balance is the sum of its non-archived rows.
 * The unique keys keep the daily job idempotent. Declared here, beside `attendance_items`, since an
 * `overtime_credit` row points at its item (rule C18).
 */
export const leaveLedger = pgTable(
  'leave_ledger',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    leaveType: balanceLeaveTypeEnum('leave_type').notNull(),
    year: integer('year').notNull(),
    days: leaveDays('days').notNull(),
    entry: ledgerEntryEnum('entry').notNull(),
    /** `YYYY-MM`: the month an accrual is for. */
    period: text('period'),
    requestId: uuid('request_id').references(() => hrRequests.id),
    /** `overtime_credit` only: the overtime item it credits or gives back (rule C18). */
    itemId: uuid('item_id').references(() => attendanceItems.id),
    note: text('note'),
    createdById: uuid('created_by_id').references(() => users.id),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('leave_ledger_user_id_idx').on(table.userId, table.leaveType, table.year),
    index('leave_ledger_request_id_idx').on(table.requestId),
    index('leave_ledger_item_id_idx').on(table.itemId),
    index('leave_ledger_created_by_id_idx').on(table.createdById),
    uniqueIndex('leave_ledger_accrual_key')
      .on(table.userId, table.period)
      .where(sql`${table.entry} = 'accrual' and ${table.archivedAt} is null`),
    uniqueIndex('leave_ledger_yearly_key')
      .on(table.userId, table.leaveType, table.year, table.entry)
      .where(
        sql`${table.entry} in ('grant', 'carry_over', 'expiry') and ${table.archivedAt} is null`,
      ),
    check(
      'leave_ledger_period_check',
      sql`(${table.entry} = 'accrual') = (${table.period} is not null)`,
    ),
    check(
      'leave_ledger_note_check',
      sql`${table.entry} not in ('adjustment', 'opening') or ${table.note} is not null`,
    ),
    check(
      'leave_ledger_item_check',
      sql`(${table.entry}::text = 'overtime_credit') = (${table.itemId} is not null)`,
    ),
  ],
);

/** Rules B14 and C17: a department manager's or Ops' comment on a pending request or item. */
export const hrOpinions = pgTable(
  'hr_opinions',
  {
    id: id(),
    requestId: uuid('request_id').references(() => hrRequests.id),
    itemId: uuid('item_id').references(() => attendanceItems.id),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('hr_opinions_request_id_idx').on(table.requestId),
    index('hr_opinions_item_id_idx').on(table.itemId),
    index('hr_opinions_author_id_idx').on(table.authorId),
    check('hr_opinions_body_check', sql`char_length(${table.body}) between 1 and 1000`),
    check(
      'hr_opinions_subject_check',
      sql`(${table.requestId} is null) <> (${table.itemId} is null)`,
    ),
  ],
);

export const attendanceMonthStatusEnum = pgEnum(
  'attendance_month_status',
  ATTENDANCE_MONTH_STATUSES,
);

/**
 * Rules D2 and D4: a month closed by the General Manager, or reopened with a reason. A month
 * without a row is open.
 */
export const attendanceMonths = pgTable(
  'attendance_months',
  {
    id: id(),
    /** `YYYY-MM`. */
    month: text('month').notNull(),
    status: attendanceMonthStatusEnum('status').notNull(),
    closedById: uuid('closed_by_id').references(() => users.id),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    reopenedById: uuid('reopened_by_id').references(() => users.id),
    reopenedAt: timestamp('reopened_at', { withTimezone: true }),
    reopenReason: text('reopen_reason'),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    uniqueIndex('attendance_months_month_key').on(table.month),
    index('attendance_months_closed_by_id_idx').on(table.closedById),
    index('attendance_months_reopened_by_id_idx').on(table.reopenedById),
    check('attendance_months_month_check', sql`${table.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check(
      'attendance_months_closed_check',
      sql`${table.status} = 'open' or (${table.closedById} is not null and ${table.closedAt} is not null)`,
    ),
  ],
);

const days = (name: string) => numeric(name, { precision: 5, scale: 1, mode: 'number' });

/**
 * Rule D3: an employee's month as written at its closing, the only rows F19 reads. A later
 * closing rewrites them; a user without days at that closing has theirs archived.
 */
export const attendanceMonthSummaries = pgTable(
  'attendance_month_summaries',
  {
    id: id(),
    monthId: uuid('month_id')
      .notNull()
      .references(() => attendanceMonths.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    workDays: integer('work_days').notNull(),
    presentDays: integer('present_days').notNull(),
    remoteDays: integer('remote_days').notNull(),
    fieldDays: integer('field_days').notNull(),
    absentDays: days('absent_days').notNull(),
    /** By leave type, in days. */
    leaveDays: jsonb('leave_days').$type<Record<string, number>>().notNull(),
    unpaidLeaveDays: days('unpaid_leave_days').notNull(),
    holidayDays: integer('holiday_days').notNull(),
    lateCount: integer('late_count').notNull(),
    deductedDays: numeric('deducted_days', { precision: 5, scale: 2, mode: 'number' }).notNull(),
    overtimePaidMinutes: integer('overtime_paid_minutes').notNull(),
    overtimeTimeOffMinutes: integer('overtime_time_off_minutes').notNull(),
    workedMinutes: integer('worked_minutes').notNull(),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    uniqueIndex('attendance_month_summaries_month_id_user_id_key').on(table.monthId, table.userId),
    index('attendance_month_summaries_user_id_idx').on(table.userId),
  ],
);
