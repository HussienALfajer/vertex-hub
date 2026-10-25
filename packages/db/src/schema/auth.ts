import { ROLES } from '@vertex-hub/contracts';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { archivedAt, id, timestamps } from './columns.js';
import { departmentCodeEnum } from './department-codes.js';
import { images } from './images.js';

/*
 * Identity and access, owned by the api `auth` module: the Better Auth tables (ADR 0002) plus
 * roles and departments (ADR 0014). Property names of Better Auth tables are the field names it
 * expects; column names are snake_case. Better Auth generates ids through `newId` (UUIDv7).
 */

export const users = pgTable(
  'users',
  {
    id: id(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    /** Set by the Better Auth two-factor plugin once TOTP is verified. */
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
    title: text('title'),
    /** `+` and 8–15 digits. */
    phone: text('phone'),
    skills: text('skills').array().notNull().default(sql`'{}'::text[]`),
    /** F01C: the current photo; Better Auth's `image` stays unused. */
    imageId: uuid('image_id').references((): AnyPgColumn => images.id),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [index('users_image_id_idx').on(table.imageId)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    /** F01B rule 1: SHA-256 of the browser's `vh_device` cookie; null until its next request. */
    browserKey: text('browser_key'),
    /** F01B rule 5: HMAC of the reported hardware signals; null until the web app reports them. */
    hardwareKey: text('hardware_key'),
    /** F01B rule 4: the last request made with the session, written at most every 5 minutes. */
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
    lastIpAddress: text('last_ip_address'),
    ...timestamps(),
  },
  (table) => [
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_browser_key_idx').on(table.browserKey),
    index('sessions_hardware_key_idx').on(table.hardwareKey),
  ],
);

/** Sign-in methods of a user. Email and password sign-in is the `credential` provider. */
export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    ...timestamps(),
  },
  (table) => [index('accounts_user_id_idx').on(table.userId)],
);

/** Short-lived tokens: activation and password reset links (`user-link:<sha256>`). */
export const verifications = pgTable(
  'verifications',
  {
    id: id(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (table) => [index('verifications_identifier_idx').on(table.identifier)],
);

export const roleEnum = pgEnum('role', ROLES);

/** Roles held by each user; a user can hold several (ADR 0007). */
export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.role] })],
);

/** TOTP secret and backup codes, both encrypted by the Better Auth two-factor plugin. */
export const twoFactors = pgTable(
  'two_factors',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    verified: boolean('verified').notNull().default(true),
    failedVerificationCount: integer('failed_verification_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [index('two_factors_user_id_idx').on(table.userId)],
);

/** The ten fixed departments (ADR 0014), seeded by migration; never archived in V1. */
export const departments = pgTable(
  'departments',
  {
    id: id(),
    code: departmentCodeEnum('code').notNull().unique(),
    name: text('name').notNull(),
    managerId: uuid('manager_id').references(() => users.id),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    // "Design" and "design" are the same name (F01 rule 21).
    uniqueIndex('departments_name_idx').on(sql`lower(${table.name})`),
    index('departments_manager_id_idx').on(table.managerId),
  ],
);

/** Who belongs to which department; each active user has exactly one primary department. */
export const departmentMembers = pgTable(
  'department_members',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id),
    isPrimary: boolean('is_primary').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.departmentId] }),
    index('department_members_department_id_idx').on(table.departmentId),
    uniqueIndex('department_members_one_primary_idx')
      .on(table.userId)
      .where(sql`${table.isPrimary}`),
  ],
);

/**
 * The browsers and systems each user signed in from (F14 email rule 15): a session from a device
 * not listed sends a new-device email. Owned by `auth`.
 */
export const userDevices = pgTable(
  'user_devices',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the browser family and the system family. */
    deviceKey: text('device_key').notNull(),
    /** E.g. "Chrome · Windows". */
    label: text('label').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.deviceKey] })],
);
