import {
  CHANNEL_MODES,
  type ChannelOverrides,
  FOLLOW_SOURCES,
  FOLLOW_SUBJECTS,
  NOTIFICATION_BOXES,
  NOTIFICATION_EMAIL_STATES,
  NOTIFICATION_PRIORITIES,
  NOTIFICATION_REMINDER_KINDS,
  NOTIFICATION_RESOLUTIONS,
  NOTIFICATION_SUBJECTS,
  NOTIFICATION_TYPES,
  PUSH_DELIVERY_KINDS,
  PUSH_DELIVERY_STATUSES,
  PUSH_LIMITS,
  TIMED_REMINDER_KINDS,
} from '@vertex-hub/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sessions, users } from './auth.js';
import { id, timestamps } from './columns.js';
import { emailMessages } from './email.js';

/*
 * In-app notifications (F14, ADR 0018), owned by the api `notifications` module. Not business
 * records: never archived, purged 90 days after they were read, never audited.
 */

export const notificationTypeEnum = pgEnum('notification_type', NOTIFICATION_TYPES);

export const notificationSubjectEnum = pgEnum('notification_subject', NOTIFICATION_SUBJECTS);

/** F14 email rules 3–5: null when the type is not emailed to the recipient. */
export const notificationEmailStateEnum = pgEnum(
  'notification_email_state',
  NOTIFICATION_EMAIL_STATES,
);

/** F16: the type's priority, snapshotted on each row. */
export const notificationPriorityEnum = pgEnum('notification_priority', NOTIFICATION_PRIORITIES);

/** F16 rule B6: "Needs you" or "For your information". */
export const notificationBoxEnum = pgEnum('notification_box', NOTIFICATION_BOXES);

/** F16 rule B5: the work was done, or no longer applies. */
export const notificationResolutionEnum = pgEnum(
  'notification_resolution',
  NOTIFICATION_RESOLUTIONS,
);

export const notificationReminderKindEnum = pgEnum(
  'notification_reminder_kind',
  NOTIFICATION_REMINDER_KINDS,
);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id),
    type: notificationTypeEnum('type').notNull(),
    /** Null for the daily job and automatic runs. */
    actorId: uuid('actor_id').references(() => users.id),
    subjectType: notificationSubjectEnum('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    /** Display snapshot, validated by the type's schema in contracts. */
    data: jsonb('data').notNull(),
    /**
     * F16: snapshot of the type's priority. The default only covers rows a previous release
     * inserts during a deploy; `NotificationCenter` always sets it.
     */
    priority: notificationPriorityEnum('priority').notNull().default('normal'),
    /**
     * F16 rule B6: snapshot of the type's box. The default only covers rows a previous release
     * inserts during a deploy; `NotificationCenter` always sets it.
     */
    box: notificationBoxEnum('box').notNull().default('info'),
    /**
     * F16 rule B5: for `action` rows, the type whose resolution closes it (itself, or the
     * original's for an escalation step). Null on `info` rows and on rows created before F16,
     * which `resolve` closes by their type and escalation skips (edge case 21).
     */
    resolutionType: notificationTypeEnum('resolution_type'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    /** Null for automatic resolution. */
    resolvedById: uuid('resolved_by_id').references(() => users.id),
    resolution: notificationResolutionEnum('resolution'),
    /** F16 rule B8: the row is out of the lists until then. */
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    /** Merged `task_commented` notifications count their comments (rule 5). */
    count: integer('count').notNull().default(1),
    readAt: timestamp('read_at', { withTimezone: true }),
    emailState: notificationEmailStateEnum('email_state'),
    /** When a `pending` notification may be emailed: 10 minutes after it was created or merged. */
    emailAfter: timestamp('email_after', { withTimezone: true }),
    /** The batch or digest that carried it; cleared when the purge deletes that email. */
    emailId: uuid('email_id').references(() => emailMessages.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (table) => [
    index('notifications_recipient_id_idx').on(table.recipientId, table.updatedAt.desc()),
    index('notifications_unread_idx').on(table.recipientId).where(sql`${table.readAt} is null`),
    index('notifications_read_at_idx').on(table.readAt),
    index('notifications_actor_id_idx').on(table.actorId),
    index('notifications_email_pending_idx')
      .on(table.recipientId, table.emailAfter)
      .where(sql`${table.emailState} = 'pending'`),
    index('notifications_email_id_idx').on(table.emailId),
    check('notifications_count_check', sql`${table.count} >= 1`),
    index('notifications_needs_you_idx')
      .on(table.recipientId, table.updatedAt.desc())
      .where(sql`${table.box} = 'action' and ${table.resolvedAt} is null`),
    index('notifications_snoozed_idx')
      .on(table.snoozedUntil)
      .where(sql`${table.snoozedUntil} is not null`),
    index('notifications_open_subject_idx')
      .on(table.subjectType, table.subjectId, table.resolutionType)
      .where(sql`${table.resolvedAt} is null`),
    index('notifications_resolved_at_idx').on(table.resolvedAt),
    index('notifications_resolved_by_id_idx').on(table.resolvedById),
    check(
      'notifications_resolution_check',
      sql`(${table.resolution} is null) = (${table.resolvedAt} is null)`,
    ),
  ],
);

/** A user without a row has nothing muted. */
export const notificationSettings = pgTable('notification_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id),
  mutedTypes: notificationTypeEnum('muted_types').array().notNull().default(sql`'{}'`),
  /**
   * F14 email rule 2, replaced by `email_overrides` (F16); no longer read or written. Kept: a
   * drop breaks inserts in the previous release (owner, 2026-10-21; F16 spec, "Data").
   */
  emailTypes: notificationTypeEnum('email_types').array(),
  /** F16 rule B3: `{ type: boolean }` where the user departs from the push default. */
  pushOverrides: jsonb('push_overrides').$type<ChannelOverrides>().notNull().default({}),
  /** F16 rule B3: `{ type: boolean }` where the user departs from the email default. */
  emailOverrides: jsonb('email_overrides').$type<ChannelOverrides>().notNull().default({}),
  /** F14 email rule 11. */
  digestEnabled: boolean('digest_enabled').notNull().default(true),
  /** F16 rule B14: the morning push summary. */
  morningPush: boolean('morning_push').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const channelModeEnum = pgEnum('channel_mode', CHANNEL_MODES);

/**
 * F16 rules B1–B2: one row per type whose channels management changed; no row means the catalog
 * default. Changes are audited (`notification_policy.updated`).
 */
export const notificationPolicies = pgTable(
  'notification_policies',
  {
    type: notificationTypeEnum('type').primaryKey(),
    push: channelModeEnum('push').notNull(),
    email: channelModeEnum('email').notNull(),
    updatedById: uuid('updated_by_id')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('notification_policies_updated_by_id_idx').on(table.updatedById)],
);

export const followSubjectEnum = pgEnum('follow_subject', FOLLOW_SUBJECTS);

export const followSourceEnum = pgEnum('follow_source', FOLLOW_SOURCES);

/**
 * F16 rule B12: who follows a task or a post. `following` false keeps an unfollow, so automatic
 * following does not add the user back. Personal, not a business record.
 */
export const recordFollowers = pgTable(
  'record_followers',
  {
    subjectType: followSubjectEnum('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    following: boolean('following').notNull(),
    source: followSourceEnum('source').notNull(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.subjectType, table.subjectId, table.userId] }),
    index('record_followers_user_id_idx').on(table.userId),
  ],
);

/** One row per reminder the daily job sent: its idempotency key (rule 8). Never purged. */
export const notificationReminders = pgTable(
  'notification_reminders',
  {
    kind: notificationReminderKindEnum('kind').notNull(),
    /** The task or retainer. */
    subjectId: uuid('subject_id').notNull(),
    /** The due date or renewal date the reminder was for. */
    occurrence: date('occurrence', { mode: 'string' }).notNull(),
    /** The work day the job sent it. */
    sentOn: date('sent_on', { mode: 'string' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.kind, table.subjectId, table.occurrence] })],
);

/** F16 rule B13: the timed sources of the minute job. */
export const timedReminderKindEnum = pgEnum('timed_reminder_kind', TIMED_REMINDER_KINDS);

/**
 * F16 rule B13: idempotency of the minute job, one row per reminder sent. A moved time is a new
 * key. Purged 30 days after its moment.
 */
export const timedReminders = pgTable(
  'timed_reminders',
  {
    kind: timedReminderKindEnum('kind').notNull(),
    /** The task, post, shoot or meeting. */
    subjectId: uuid('subject_id').notNull(),
    /** The moment the reminder is for: the due, publish or start time. */
    occursAt: timestamp('occurs_at', { withTimezone: true }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.kind, table.subjectId, table.occursAt] }),
    index('timed_reminders_occurs_at_idx').on(table.occursAt),
  ],
);

/**
 * One row per digest sent (F14 email rule 10): the digest's idempotency key. Never purged; the
 * email reference is cleared when the purge deletes the email.
 */
export const emailDigests = pgTable(
  'email_digests',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** The work day. */
    digestDate: date('digest_date', { mode: 'string' }).notNull(),
    emailId: uuid('email_id').references(() => emailMessages.id, { onDelete: 'set null' }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.digestDate] }),
    index('email_digests_email_id_idx').on(table.emailId),
  ],
);

export const pushDeliveryKindEnum = pgEnum('push_delivery_kind', PUSH_DELIVERY_KINDS);

export const pushDeliveryStatusEnum = pgEnum('push_delivery_status', PUSH_DELIVERY_STATUSES);

/**
 * F16 rule A7 (ADR 0036): one Web Push subscription per signed-in session. Deleted with its
 * session, so signing a device out stops its pushes. Technical, not a business record.
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    /** "Chrome · Android", from the user agent that subscribed; copied onto each delivery. */
    deviceLabel: text('device_label').notNull(),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
    /** Rule A13: consecutive failed messages; reset on success. */
    failureCount: integer('failure_count').notNull().default(0),
    ...timestamps(),
  },
  (table) => [
    index('push_subscriptions_user_id_idx').on(table.userId),
    uniqueIndex('push_subscriptions_session_id_idx').on(table.sessionId),
    uniqueIndex('push_subscriptions_endpoint_idx').on(table.endpoint),
    check(
      'push_subscriptions_endpoint_check',
      sql`${table.endpoint} like 'https://%' and length(${table.endpoint}) <= ${sql.raw(String(PUSH_LIMITS.endpoint))}`,
    ),
  ],
);

/**
 * F16 rule A15: one row per push sent to a subscription, purged 30 days after creation. Its id is
 * the push's id in the payload. Technical, not a business record.
 */
export const pushDeliveries = pgTable(
  'push_deliveries',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id').references(() => pushSubscriptions.id, {
      onDelete: 'set null',
    }),
    /** Kept when the subscription goes. */
    deviceLabel: text('device_label').notNull(),
    kind: pushDeliveryKindEnum('kind').notNull(),
    notificationId: uuid('notification_id').references(() => notifications.id, {
      onDelete: 'set null',
    }),
    status: pushDeliveryStatusEnum('status').notNull().default('queued'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    clickedAt: timestamp('clicked_at', { withTimezone: true }),
  },
  (table) => [
    index('push_deliveries_user_id_idx').on(table.userId, table.createdAt.desc()),
    index('push_deliveries_created_at_idx').on(table.createdAt),
    index('push_deliveries_subscription_id_idx').on(table.subscriptionId),
    index('push_deliveries_notification_id_idx').on(table.notificationId),
    check(
      'push_deliveries_error_check',
      sql`length(${table.error}) <= ${sql.raw(String(PUSH_LIMITS.error))}`,
    ),
  ],
);
