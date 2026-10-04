import {
  EMAIL_AUDIENCES,
  EMAIL_KINDS,
  EMAIL_LIMITS,
  EMAIL_RECORD_TYPES,
  EMAIL_STATUSES,
} from '@vertex-hub/contracts';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { clients } from './clients.js';
import { id, timestamps } from './columns.js';

/*
 * The email outbox (F14 email, ADR 0028), owned by the api `email` module. Not business records:
 * never archived; client emails are kept, staff emails are purged after 90 days (rule 25); the
 * module that sends a client email audits it on its own record (rule 22).
 */

export const emailKindEnum = pgEnum('email_kind', EMAIL_KINDS);

export const emailAudienceEnum = pgEnum('email_audience', EMAIL_AUDIENCES);

export const emailStatusEnum = pgEnum('email_status', EMAIL_STATUSES);

export const emailRecordTypeEnum = pgEnum('email_record_type', EMAIL_RECORD_TYPES);

export const emailMessages = pgTable(
  'email_messages',
  {
    id: id(),
    kind: emailKindEnum('kind').notNull(),
    audience: emailAudienceEnum('audience').notNull(),
    /** `EmailAddress[]`, 1 to 10. */
    to: jsonb('to').notNull(),
    /** `EmailAddress[]`, up to 5. */
    cc: jsonb('cc').notNull().default([]),
    /** The sender's address, for client emails. */
    replyTo: text('reply_to'),
    subject: text('subject').notNull(),
    /** The editable text of a client email. */
    message: text('message'),
    /** Template data, validated by the kind's schema in contracts; token links redacted. */
    data: jsonb('data').notNull(),
    /** `EmailAttachment[]`. */
    attachments: jsonb('attachments').notNull().default([]),
    /** Null for system emails. */
    senderId: uuid('sender_id').references(() => users.id),
    /** The sender's name when queued, so the outbox reads no other table (as the audit log). */
    senderName: text('sender_name'),
    clientId: uuid('client_id').references(() => clients.id),
    recordType: emailRecordTypeEnum('record_type'),
    recordId: uuid('record_id'),
    status: emailStatusEnum('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    /** The SMTP error of the last attempt. */
    lastError: text('last_error'),
    providerMessageId: text('provider_message_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    index('email_messages_record_idx').on(table.recordType, table.recordId, table.createdAt.desc()),
    index('email_messages_client_id_idx').on(table.clientId, table.createdAt.desc()),
    index('email_messages_status_idx').on(table.status, table.createdAt),
    index('email_messages_created_at_idx').on(table.createdAt),
    index('email_messages_sender_id_idx').on(table.senderId),
    check(
      'email_messages_subject_check',
      sql`char_length(${table.subject}) between 1 and ${sql.raw(String(EMAIL_LIMITS.subject))}`,
    ),
    check(
      'email_messages_sender_check',
      sql`(${table.senderId} is null) = (${table.senderName} is null)`,
    ),
    check(
      'email_messages_record_check',
      sql`(${table.recordType} is null) = (${table.recordId} is null)`,
    ),
  ],
);
