import { ANNOUNCEMENT_LIMITS, ANNOUNCEMENT_STATUSES } from '@vertex-hub/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { archivedAt, id, timestamps } from './columns.js';
import { notificationPriorityEnum } from './notifications.js';

/*
 * Announcements (F16 part D, ADR 0038), owned by the api `announcements` module: business
 * records, audited, archived when discarded or withdrawn. Recipients are frozen when sent.
 */

export const announcementStatusEnum = pgEnum('announcement_status', ANNOUNCEMENT_STATUSES);

export const announcements = pgTable(
  'announcements',
  {
    id: id(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    /** A TipTap document checked by `announcementBodySchema` (rule D13). */
    body: jsonb('body').notNull(),
    linkUrl: text('link_url'),
    linkLabel: text('link_label'),
    priority: notificationPriorityEnum('priority').notNull(),
    requiresAck: boolean('requires_ack').notNull(),
    /** `audienceSchema`; resolved when sent (rule D3). */
    audience: jsonb('audience').notNull(),
    status: announcementStatusEnum('status').notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    /** Edge case 17: the scheduled send found nobody in the audience; cleared when sent. */
    unsentAt: timestamp('unsent_at', { withTimezone: true }),
    pinnedUntil: date('pinned_until', { mode: 'string' }),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    renotifiedAt: timestamp('renotified_at', { withTimezone: true }),
    /** Rule D8: the author's last "Remind now", at most once an hour. */
    remindedAt: timestamp('reminded_at', { withTimezone: true }),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    withdrawnById: uuid('withdrawn_by_id').references(() => users.id),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('announcements_author_id_idx').on(table.authorId),
    index('announcements_withdrawn_by_id_idx').on(table.withdrawnById),
    /** The minute job's due scheduled sends. */
    index('announcements_scheduled_idx')
      .on(table.scheduledAt)
      .where(sql`${table.status} = 'scheduled'`),
    index('announcements_sent_at_idx').on(table.sentAt),
    check(
      'announcements_title_check',
      sql`char_length(${table.title}) between ${sql.raw(String(ANNOUNCEMENT_LIMITS.titleMin))} and ${sql.raw(String(ANNOUNCEMENT_LIMITS.titleMax))}`,
    ),
    check(
      'announcements_scheduled_check',
      sql`${table.status} <> 'scheduled' or ${table.scheduledAt} is not null`,
    ),
    check(
      'announcements_sent_check',
      sql`${table.status} not in ('sent', 'withdrawn') or ${table.sentAt} is not null`,
    ),
    check(
      'announcements_withdrawn_check',
      sql`(${table.status} = 'withdrawn') = (${table.withdrawnAt} is not null)`,
    ),
    check(
      'announcements_critical_ack_check',
      sql`${table.priority} <> 'critical' or ${table.requiresAck}`,
    ),
  ],
);

export const announcementRecipients = pgTable(
  'announcement_recipients',
  {
    announcementId: uuid('announcement_id')
      .notNull()
      .references(() => announcements.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    /** Rule D8: daily reminders sent, at most three; manual ones do not count. */
    remindersSent: smallint('reminders_sent').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.announcementId, table.userId] }),
    index('announcement_recipients_user_id_idx').on(table.userId),
    check(
      'announcement_recipients_reminders_check',
      sql`${table.remindersSent} between 0 and ${sql.raw(String(ANNOUNCEMENT_LIMITS.reminders))}`,
    ),
  ],
);
