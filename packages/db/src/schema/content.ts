import {
  CAPTION_GROUPS,
  OCCASION_CALENDARS,
  OCCASION_CATEGORIES,
  type OccasionSkip,
  PILLAR_COLORS,
  type PillarTarget,
  POST_PLATFORMS,
  POST_STATUSES,
  POST_TYPES,
  type PostCaption,
  type PostingWindow,
  type PublishedLink,
  SNIPPET_KINDS,
} from '@vertex-hub/contracts';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
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
} from './reviews.js';

/*
 * The content calendar (F08, ADR 0021), owned by the api `content` module. `publish_date` is a
 * calendar day in Asia/Damascus, read and written as `YYYY-MM-DD`; `publish_time` is a time of
 * day there. Review snapshots and client responses mirror the task ones (F09, ADR 0020).
 */

export const postTypeEnum = pgEnum('post_type', POST_TYPES);

export const postPlatformEnum = pgEnum('post_platform', POST_PLATFORMS);

export const postStatusEnum = pgEnum('post_status', POST_STATUSES);

export const captionGroupEnum = pgEnum('caption_group', CAPTION_GROUPS);

/** A slide of a post's media layout (F08B rule A6). */
export interface MediaLayoutEntry {
  fileItemId: string;
  caption: string | null;
}

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
    /**
     * The plain extract of the first caption group (F08B): search, notification texts and the
     * previous release; written from `post_captions`, never edited directly.
     */
    caption: text('caption'),
    hashtags: text('hashtags'),
    /**
     * F08B rule A6: the slide order of the post's media (its files and its linked tasks' finals,
     * by file item) with each slide's caption; media not listed follow in F08 rule 5's order.
     */
    mediaLayout: jsonb('media_layout').$type<MediaLayoutEntry[]>().notNull().default([]),
    /** The internal brief for the team, never shown to the client. */
    notes: text('notes'),
    /** F08B rule C1: one optional pillar. */
    pillarId: uuid('pillar_id').references((): AnyPgColumn => contentPillars.id),
    /** F08B rule C6: the occasion this post is for. */
    occasionId: uuid('occasion_id').references((): AnyPgColumn => contentOccasions.id),
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
    index('content_posts_published_at_idx').on(table.publishedAt),
    index('content_posts_responsible_id_idx').on(table.responsibleId),
    index('content_posts_cycle_line_id_idx').on(table.cycleLineId),
    index('content_posts_cleared_review_id_idx').on(table.clearedReviewId),
    index('content_posts_published_by_id_idx').on(table.publishedById),
    index('content_posts_created_by_id_idx').on(table.createdById),
    index('content_posts_pillar_id_idx').on(table.pillarId),
    index('content_posts_occasion_id_idx').on(table.occasionId),
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
 * A post's caption per caption group (F08B rule A1, ADR 0042). Rows are never deleted: a group
 * whose platforms leave the post is kept and ignored, and comes back with them.
 */
export const postCaptions = pgTable(
  'post_captions',
  {
    id: id(),
    postId: uuid('post_id')
      .notNull()
      .references(() => contentPosts.id),
    group: captionGroupEnum('group').notNull(),
    caption: text('caption'),
    hashtags: text('hashtags'),
    /** YouTube only. */
    title: text('title'),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('post_captions_post_id_group_idx').on(table.postId, table.group),
    check(
      'post_captions_text_check',
      sql`char_length(${table.caption}) between 1 and 5000
        and char_length(${table.hashtags}) between 1 and 1000
        and char_length(${table.title}) between 1 and 100`,
    ),
    check('post_captions_title_check', sql`${table.group} = 'youtube' or ${table.title} is null`),
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
    /**
     * F08B rule A7: passes only, the captions of the snapshot's groups; null on rows written
     * before F08B, read as `caption` and `hashtags` for every group.
     */
    captions: jsonb('captions').$type<PostCaption[]>(),
    /** F08B rule A7: passes only, aligned with `version_ids`; null on rows before F08B. */
    slideCaptions: jsonb('slide_captions').$type<(string | null)[]>(),
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

/*
 * F08B part C (ADR 0042): the planning aids of the content calendar, owned by `content`.
 */

export const pillarColorEnum = pgEnum('pillar_color', PILLAR_COLORS);

export const occasionCategoryEnum = pgEnum('occasion_category', OCCASION_CATEGORIES);

export const occasionCalendarEnum = pgEnum('occasion_calendar', OCCASION_CALENDARS);

export const snippetKindEnum = pgEnum('snippet_kind', SNIPPET_KINDS);

/** The agency's content pillars (rule C1); at most 10 non-archived, names unique among them. */
export const contentPillars = pgTable(
  'content_pillars',
  {
    id: id(),
    name: text('name').notNull(),
    color: pillarColorEnum('color').notNull(),
    /** Dense from 1. */
    position: integer('position').notNull(),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    uniqueIndex('content_pillars_name_idx')
      .on(sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} is null`),
    check('content_pillars_name_check', sql`char_length(${table.name}) between 1 and 40`),
    check('content_pillars_position_check', sql`${table.position} >= 1`),
  ],
);

/**
 * Occasions (rules C4–C6): a Gregorian or Hijri day each year, or one date; general, of a
 * category, or of one client.
 */
export const contentOccasions = pgTable(
  'content_occasions',
  {
    id: id(),
    name: text('name').notNull(),
    category: occasionCategoryEnum('category').notNull(),
    /** An occasion of one client only; its category is ignored. */
    clientId: uuid('client_id').references(() => clients.id),
    calendar: occasionCalendarEnum('calendar').notNull(),
    month: integer('month'),
    day: integer('day'),
    date: date('date', { mode: 'string' }),
    durationDays: integer('duration_days').notNull().default(1),
    leadDays: integer('lead_days').notNull().default(7),
    createdById: uuid('created_by_id').references(() => users.id),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('content_occasions_client_id_idx').on(table.clientId),
    index('content_occasions_created_by_id_idx').on(table.createdById),
    check('content_occasions_name_check', sql`char_length(${table.name}) between 1 and 80`),
    check(
      'content_occasions_rule_check',
      sql`case when ${table.calendar} = 'once'
        then ${table.date} is not null and ${table.month} is null and ${table.day} is null
        else ${table.date} is null and ${table.month} between 1 and 12
          and ${table.day} between 1 and (case when ${table.calendar} = 'hijri' then 30 else 31 end) end`,
    ),
    check(
      'content_occasions_days_check',
      sql`${table.durationDays} between 1 and 31 and ${table.leadDays} between 0 and 30`,
    ),
  ],
);

/** A manager's confirmed start of an occasion in a Gregorian year (rule C5). */
export const contentOccasionDates = pgTable(
  'content_occasion_dates',
  {
    id: id(),
    occasionId: uuid('occasion_id')
      .notNull()
      .references(() => contentOccasions.id),
    year: integer('year').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    confirmedById: uuid('confirmed_by_id')
      .notNull()
      .references(() => users.id),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    // Archived = back to the computed date: one live row per occasion and year.
    uniqueIndex('content_occasion_dates_occasion_id_idx')
      .on(table.occasionId, table.year)
      .where(sql`${table.archivedAt} is null`),
    index('content_occasion_dates_confirmed_by_id_idx').on(table.confirmedById),
  ],
);

/** The agency's planning settings (`client_id` null) and one row per client (rules C1–C7). */
export const contentPlanningSettings = pgTable(
  'content_planning_settings',
  {
    id: id(),
    clientId: uuid('client_id').references(() => clients.id),
    postingTimes: jsonb('posting_times').$type<PostingWindow[]>().notNull().default([]),
    pillarTargets: jsonb('pillar_targets').$type<PillarTarget[]>().notNull().default([]),
    maxGapDays: integer('max_gap_days').notNull().default(3),
    occasionCategories: occasionCategoryEnum('occasion_categories')
      .array()
      .notNull()
      .default(sql`'{general}'::occasion_category[]`),
    excludedOccasionIds: uuid('excluded_occasion_ids').array().notNull().default(sql`'{}'::uuid[]`),
    skippedOccasions: jsonb('skipped_occasions').$type<OccasionSkip[]>().notNull().default([]),
    xLongPosts: boolean('x_long_posts').notNull().default(false),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('content_planning_settings_client_id_idx').on(table.clientId),
    uniqueIndex('content_planning_settings_agency_idx')
      .on(sql`(${table.clientId} is null)`)
      .where(sql`${table.clientId} is null`),
    check('content_planning_settings_gap_check', sql`${table.maxGapDays} between 1 and 14`),
  ],
);

/** Hashtag sets and caption snippets of a client, or of the agency (rule A10). */
export const contentSnippets = pgTable(
  'content_snippets',
  {
    id: id(),
    clientId: uuid('client_id').references(() => clients.id),
    kind: snippetKindEnum('kind').notNull(),
    name: text('name').notNull(),
    body: text('body').notNull(),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('content_snippets_client_id_idx').on(table.clientId, table.kind),
    index('content_snippets_created_by_id_idx').on(table.createdById),
    check('content_snippets_name_check', sql`char_length(${table.name}) between 1 and 60`),
    check(
      'content_snippets_body_check',
      sql`char_length(${table.body}) between 1 and (case when ${table.kind} = 'hashtags' then 1000 else 2000 end)`,
    ),
  ],
);

/** The ideas bank (rule C12): open, used (`post_id`) or dropped (archived). */
export const contentIdeas = pgTable(
  'content_ideas',
  {
    id: id(),
    text: text('text').notNull(),
    clientId: uuid('client_id').references(() => clients.id),
    pillarId: uuid('pillar_id').references(() => contentPillars.id),
    occasionId: uuid('occasion_id').references(() => contentOccasions.id),
    /** Set once when the idea becomes a post; never changes after. */
    postId: uuid('post_id').references(() => contentPosts.id),
    dropReason: text('drop_reason'),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('content_ideas_client_id_idx').on(table.clientId),
    index('content_ideas_pillar_id_idx').on(table.pillarId),
    index('content_ideas_occasion_id_idx').on(table.occasionId),
    index('content_ideas_post_id_idx').on(table.postId),
    index('content_ideas_created_by_id_idx').on(table.createdById, table.createdAt),
    check('content_ideas_text_check', sql`char_length(${table.text}) between 1 and 300`),
    check(
      'content_ideas_state_check',
      sql`(${table.postId} is null or ${table.archivedAt} is null)
        and (${table.dropReason} is null or ${table.archivedAt} is not null)
        and char_length(${table.dropReason}) between 1 and 300`,
    ),
  ],
);
