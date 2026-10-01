import {
  POST_PLATFORMS,
  POST_STATUSES,
  POST_TYPES,
  type PublishedLink,
} from '@vertex-hub/contracts';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { approvalItems } from './approvals.js';
import { users } from './auth.js';
import { clientContacts, clients } from './clients.js';
import { archivedAt, id, timestamps } from './columns.js';
import { retainerCycleLines } from './retainers.js';
import {
  clientDecisionEnum,
  responseChannelEnum,
  reviewOutcomeEnum,
  reviewStageEnum,
} from './tasks.js';

/*
 * The content calendar (F08, ADR 0021), owned by the api `content` module. `publish_date` is a
 * calendar day in Asia/Damascus, read and written as `YYYY-MM-DD`; `publish_time` is a time of
 * day there. Review snapshots and client responses mirror the task ones (F09, ADR 0020).
 */

export const postTypeEnum = pgEnum('post_type', POST_TYPES);

export const postPlatformEnum = pgEnum('post_platform', POST_PLATFORMS);

export const postStatusEnum = pgEnum('post_status', POST_STATUSES);

export const contentPosts = pgTable(
  'content_posts',
  {
    id: id(),
    /** Never changes after creation. */
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    title: text('title').notNull(),
    type: postTypeEnum('type').notNull(),
    platforms: postPlatformEnum('platforms').array().notNull(),
    caption: text('caption'),
    hashtags: text('hashtags'),
    /** The internal brief for the team, never shown to the client. */
    notes: text('notes'),
    publishDate: date('publish_date', { mode: 'string' }).notNull(),
    publishTime: time('publish_time'),
    status: postStatusEnum('status').notNull().default('idea'),
    /** The stage of `internal_review`; null in every other status. */
    reviewStage: reviewStageEnum('review_stage'),
    needsClientApproval: boolean('needs_client_approval').notNull().default(true),
    responsibleId: uuid('responsible_id')
      .notNull()
      .references(() => users.id),
    /** The retainer cycle line the post counts on directly (rule 16). */
    cycleLineId: uuid('cycle_line_id').references(() => retainerCycleLines.id),
    /** The pass that put the post in `awaiting_client` or `approved`; kept afterwards. */
    clearedReviewId: uuid('cleared_review_id').references((): AnyPgColumn => postReviews.id),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedById: uuid('published_by_id').references(() => users.id),
    /** At most one link per platform of the post. */
    publishedLinks: jsonb('published_links').$type<PublishedLink[]>().notNull().default([]),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('content_posts_client_id_idx').on(table.clientId, table.publishDate),
    index('content_posts_publish_date_idx').on(table.publishDate),
    index('content_posts_status_idx').on(table.status),
    index('content_posts_responsible_id_idx').on(table.responsibleId),
    index('content_posts_cycle_line_id_idx').on(table.cycleLineId),
    index('content_posts_cleared_review_id_idx').on(table.clearedReviewId),
    index('content_posts_published_by_id_idx').on(table.publishedById),
    index('content_posts_created_by_id_idx').on(table.createdById),
    check(
      'content_posts_review_stage_check',
      sql`(${table.status} = 'internal_review') = (${table.reviewStage} is not null)`,
    ),
    check('content_posts_title_check', sql`char_length(${table.title}) between 1 and 160`),
    check('content_posts_platforms_check', sql`cardinality(${table.platforms}) between 1 and 8`),
    check(
      'content_posts_text_check',
      sql`char_length(${table.caption}) between 1 and 5000
        and char_length(${table.hashtags}) between 1 and 1000
        and char_length(${table.notes}) between 1 and 2000`,
    ),
    check(
      'content_posts_published_check',
      sql`(${table.status} = 'published') = (${table.publishedAt} is not null)
        and (${table.publishedAt} is null) = (${table.publishedById} is null)`,
    ),
    check(
      'content_posts_cancelled_check',
      sql`(${table.status} = 'cancelled') = (${table.cancelledAt} is not null)
        and (${table.cancelledAt} is null) = (${table.cancelReason} is null)`,
    ),
  ],
);

/**
 * Every pass and return of a post review (F08 rule 11); append-only. A pass holds the snapshot
 * it approved: the media versions in display order and the post as the client is shown it.
 */
export const postReviews = pgTable(
  'post_reviews',
  {
    id: id(),
    postId: uuid('post_id')
      .notNull()
      .references(() => contentPosts.id),
    stage: reviewStageEnum('stage').notNull(),
    outcome: reviewOutcomeEnum('outcome').notNull(),
    note: text('note'),
    /** Null only for the system pass when a client stops being healthcare (rule 26). */
    reviewerId: uuid('reviewer_id').references(() => users.id),
    /** Ids of `file_versions`, owned by the files module; empty for a return. */
    versionIds: uuid('version_ids').array().notNull().default(sql`'{}'::uuid[]`),
    caption: text('caption'),
    hashtags: text('hashtags'),
    type: postTypeEnum('type'),
    platforms: postPlatformEnum('platforms').array().notNull().default(sql`'{}'::post_platform[]`),
    publishDate: date('publish_date', { mode: 'string' }),
    publishTime: time('publish_time'),
    ...timestamps(),
  },
  (table) => [
    index('post_reviews_post_id_idx').on(table.postId, table.createdAt),
    index('post_reviews_reviewer_id_idx').on(table.reviewerId),
    check(
      'post_reviews_outcome_check',
      sql`case when ${table.outcome} = 'returned'
        then ${table.note} is not null and ${table.versionIds} = '{}'
          and ${table.caption} is null and ${table.hashtags} is null
          and ${table.type} is null and ${table.publishDate} is null
        else ${table.type} is not null and ${table.publishDate} is not null end`,
    ),
  ],
);

/**
 * The client's answers on posts (F08 rules 22–24), from an approval link or recorded by hand,
 * each against the snapshot it answered; append-only.
 */
export const postClientResponses = pgTable(
  'post_client_responses',
  {
    id: id(),
    postId: uuid('post_id')
      .notNull()
      .references(() => contentPosts.id),
    decision: clientDecisionEnum('decision').notNull(),
    channel: responseChannelEnum('channel').notNull(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => clientContacts.id),
    note: text('note'),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => postReviews.id),
    /** The pending item it closed: always for `link`, when there was one for `manual`. */
    approvalItemId: uuid('approval_item_id').references((): AnyPgColumn => approvalItems.id),
    /** Manual responses only. */
    recordedById: uuid('recorded_by_id').references(() => users.id),
    /** Link responses only, kept as evidence. */
    ip: text('ip'),
    userAgent: text('user_agent'),
    ...timestamps(),
  },
  (table) => [
    index('post_client_responses_post_id_idx').on(table.postId, table.createdAt),
    index('post_client_responses_contact_id_idx').on(table.contactId),
    index('post_client_responses_review_id_idx').on(table.reviewId),
    index('post_client_responses_approval_item_id_idx').on(table.approvalItemId),
    index('post_client_responses_recorded_by_id_idx').on(table.recordedById),
    check(
      'post_client_responses_channel_check',
      sql`case when ${table.channel} = 'manual'
        then ${table.recordedById} is not null and ${table.ip} is null and ${table.userAgent} is null
        else ${table.recordedById} is null and ${table.approvalItemId} is not null end`,
    ),
    check(
      'post_client_responses_decision_check',
      sql`${table.decision} <> 'changes_requested' or ${table.note} is not null`,
    ),
    check('post_client_responses_user_agent_check', sql`char_length(${table.userAgent}) <= 500`),
  ],
);
