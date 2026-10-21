import {
  ATTENDANCE_DAY_KINDS,
  ATTENDANCE_DAY_STATUSES,
  ATTENDANCE_PLACES,
  ATTENDANCE_PUNCH_DIRECTIONS,
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
import { hrRequests } from './hr.js';
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

export const punchDirectionEnum = pgEnum('punch_direction', ATTENDANCE_PUNCH_DIRECTIONS);

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
