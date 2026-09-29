import {
  NOTIFICATION_REMINDER_KINDS,
  NOTIFICATION_SUBJECTS,
  NOTIFICATION_TYPES,
} from '@vertex-hub/contracts';
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { id, timestamps } from './columns.js';

/*
 * In-app notifications (F14, ADR 0018), owned by the api `notifications` module. Not business
 * records: never archived, purged 90 days after they were read, never audited.
 */

export const notificationTypeEnum = pgEnum('notification_type', NOTIFICATION_TYPES);

export const notificationSubjectEnum = pgEnum('notification_subject', NOTIFICATION_SUBJECTS);

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
    /** Merged `task_commented` notifications count their comments (rule 5). */
    count: integer('count').notNull().default(1),
    readAt: timestamp('read_at', { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    index('notifications_recipient_id_idx').on(table.recipientId, table.updatedAt.desc()),
    index('notifications_unread_idx').on(table.recipientId).where(sql`${table.readAt} is null`),
    index('notifications_read_at_idx').on(table.readAt),
    index('notifications_actor_id_idx').on(table.actorId),
    check('notifications_count_check', sql`${table.count} >= 1`),
  ],
);

/** A user without a row has nothing muted. */
export const notificationSettings = pgTable('notification_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id),
  mutedTypes: notificationTypeEnum('muted_types').array().notNull().default(sql`'{}'`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

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
