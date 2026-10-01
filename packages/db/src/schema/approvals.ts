import { APPROVAL_ITEM_STATUSES, APPROVAL_WITHDRAWN_REASONS } from '@vertex-hub/contracts';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { clientContacts, clients } from './clients.js';
import { id, timestamps } from './columns.js';
import { taskClientResponses, taskReviews, tasks } from './tasks.js';

/*
 * Approval requests (F09, ADR 0020), owned by the api `approvals` module: ready tasks of one
 * client bundled into a link for a contact with final-approval authority. Requests are revoked,
 * never archived.
 */

export const approvalItemStatusEnum = pgEnum('approval_item_status', APPROVAL_ITEM_STATUSES);

export const approvalWithdrawnReasonEnum = pgEnum(
  'approval_withdrawn_reason',
  APPROVAL_WITHDRAWN_REASONS,
);

export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: id(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => clientContacts.id),
    /** Shown to the client at the top of the page. */
    message: text('message'),
    /** SHA-256 of the current token (ADR 0002); the token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    linkIssuedAt: timestamp('link_issued_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Set by the hourly job (rules 24 and 25), cleared on reissue. */
    remindedAt: timestamp('reminded_at', { withTimezone: true }),
    expiryNotifiedAt: timestamp('expiry_notified_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedById: uuid('revoked_by_id').references(() => users.id),
    /** Set when no item is pending any more. */
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id),
    ...timestamps(),
  },
  (table) => [
    index('approval_requests_client_id_idx').on(table.clientId, table.createdAt),
    index('approval_requests_contact_id_idx').on(table.contactId),
    index('approval_requests_revoked_by_id_idx').on(table.revokedById),
    index('approval_requests_created_by_id_idx').on(table.createdById),
    index('approval_requests_expires_at_idx').on(table.expiresAt),
    check('approval_requests_message_check', sql`char_length(${table.message}) between 1 and 1000`),
    check(
      'approval_requests_revoked_check',
      sql`(${table.revokedAt} is null) = (${table.revokedById} is null)`,
    ),
  ],
);

export const approvalItems = pgTable(
  'approval_items',
  {
    id: id(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => approvalRequests.id),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    /** Display order, dense from 1. */
    position: integer('position').notNull(),
    /** What the client reads instead of the task's internal title. */
    title: text('title').notNull(),
    /** The snapshot sent: the task's cleared review when the request was created. */
    reviewId: uuid('review_id')
      .notNull()
      .references(() => taskReviews.id),
    status: approvalItemStatusEnum('status').notNull().default('pending'),
    responseId: uuid('response_id').references((): AnyPgColumn => taskClientResponses.id),
    withdrawnReason: approvalWithdrawnReasonEnum('withdrawn_reason'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    index('approval_items_request_id_idx').on(table.requestId, table.position),
    index('approval_items_task_id_idx').on(table.taskId),
    index('approval_items_review_id_idx').on(table.reviewId),
    index('approval_items_response_id_idx').on(table.responseId),
    /** A task waits on one link at a time (rule 8). */
    uniqueIndex('approval_items_pending_unique')
      .on(table.taskId)
      .where(sql`${table.status} = 'pending'`),
    check('approval_items_title_check', sql`char_length(${table.title}) between 1 and 160`),
    check('approval_items_position_check', sql`${table.position} >= 1`),
    check(
      'approval_items_status_check',
      sql`(${table.status} = 'pending') = (${table.closedAt} is null)
        and (${table.status} in ('approved', 'changes_requested')) = (${table.responseId} is not null)
        and (${table.status} = 'withdrawn') = (${table.withdrawnReason} is not null)`,
    ),
  ],
);
