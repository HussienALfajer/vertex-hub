import {
  ANNOUNCEMENT_LIMITS,
  ANNOUNCEMENT_STATUSES,
  ANNOUNCEMENT_TEMPLATE_LIMITS,
  POLL_LIMITS,
  POLL_RESULTS_VISIBILITY,
} from '@vertex-hub/contracts';
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
  unique,
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

export const pollResultsVisibilityEnum = pgEnum('poll_results_visibility', POLL_RESULTS_VISIBILITY);

/** Rule D11: one optional poll per announcement, part of it (no archive or audit of its own). */
export const announcementPolls = pgTable(
  'announcement_polls',
  {
    announcementId: uuid('announcement_id')
      .primaryKey()
      .references(() => announcements.id),
    question: text('question').notNull(),
    multiple: boolean('multiple').notNull(),
    anonymous: boolean('anonymous').notNull(),
    results: pollResultsVisibilityEnum('results').notNull(),
    closesAt: timestamp('closes_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (table) => [
    /** The minute job's polls to close and to remind about. */
    index('announcement_polls_closes_at_idx')
      .on(table.closesAt)
      .where(sql`${table.closedAt} is null`),
    check(
      'announcement_polls_question_check',
      sql`char_length(${table.question}) between ${sql.raw(String(POLL_LIMITS.questionMin))} and ${sql.raw(String(POLL_LIMITS.questionMax))}`,
    ),
  ],
);

export const announcementPollOptions = pgTable(
  'announcement_poll_options',
  {
    id: id(),
    announcementId: uuid('announcement_id')
      .notNull()
      .references(() => announcementPolls.announcementId),
    position: smallint('position').notNull(),
    label: text('label').notNull(),
  },
  (table) => [
    index('announcement_poll_options_announcement_id_idx').on(table.announcementId),
    unique('announcement_poll_options_position_key').on(table.announcementId, table.position),
    check(
      'announcement_poll_options_label_check',
      sql`char_length(${table.label}) between 1 and ${sql.raw(String(POLL_LIMITS.optionLabel))}`,
    ),
  ],
);

/**
 * One row per option a voter chose; the voter is kept even for an anonymous poll, to keep one
 * vote per person, and is never returned for it.
 */
export const announcementPollVotes = pgTable(
  'announcement_poll_votes',
  {
    announcementId: uuid('announcement_id')
      .notNull()
      .references(() => announcementPolls.announcementId),
    optionId: uuid('option_id')
      .notNull()
      .references(() => announcementPollOptions.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.optionId, table.userId] }),
    index('announcement_poll_votes_announcement_id_idx').on(table.announcementId, table.userId),
    index('announcement_poll_votes_user_id_idx').on(table.userId),
  ],
);

/** Rule D12: personal templates (`owner_id`) and shared ones (no owner); never an audience. */
export const announcementTemplates = pgTable(
  'announcement_templates',
  {
    id: id(),
    ownerId: uuid('owner_id').references(() => users.id),
    name: text('name').notNull(),
    title: text('title').notNull(),
    /** A TipTap document checked by `announcementBodySchema` (rule D13). */
    body: jsonb('body').notNull(),
    priority: notificationPriorityEnum('priority').notNull(),
    requiresAck: boolean('requires_ack').notNull(),
    linkUrl: text('link_url'),
    linkLabel: text('link_label'),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('announcement_templates_owner_id_idx').on(table.ownerId),
    check(
      'announcement_templates_name_check',
      sql`char_length(${table.name}) between ${sql.raw(String(ANNOUNCEMENT_TEMPLATE_LIMITS.nameMin))} and ${sql.raw(String(ANNOUNCEMENT_TEMPLATE_LIMITS.nameMax))}`,
    ),
    check(
      'announcement_templates_critical_ack_check',
      sql`${table.priority} <> 'critical' or ${table.requiresAck}`,
    ),
  ],
);
