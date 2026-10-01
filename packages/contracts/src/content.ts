import { z } from 'zod';
import { approvalVersionSchema, clientDecisionSchema, responseChannelSchema } from './approvals.js';
import {
  businessDate,
  type CalendarDate,
  calendarDateSchema,
  daysInclusive,
  timeOfDaySchema,
  workDaysBefore,
} from './dates.js';
import { type DepartmentCode, departmentCodeSchema } from './departments.js';
import { pageQuerySchema, pageSchema, queryBooleanSchema, queryListSchema } from './lists.js';
import {
  POST_PLATFORMS,
  type PostType,
  postPlatformSchema,
  postTypeSchema,
} from './post-values.js';
import { deliverableKindSchema } from './retainers.js';
import {
  pendingApprovalSchema,
  type ReviewStage,
  reviewContentToken,
  reviewOutcomeSchema,
  reviewStageSchema,
  reviewVersionSchema,
  taskSchema,
  taskStatusSchema,
  taskTitleSchema,
} from './tasks.js';
import { httpUrlSchema, optionalText } from './text.js';

/*
 * The content calendar (spec F08, ADR 0021): the post is the unit of content, planned per client
 * on a calendar, reviewed like a task (snapshots, medical stage, client response) and marked
 * scheduled and published by hand.
 */

export const POST_STATUSES = [
  'idea',
  'in_production',
  'internal_review',
  'awaiting_client',
  'approved',
  'scheduled',
  'published',
  'cancelled',
] as const;

export const postStatusSchema = z.enum(POST_STATUSES).meta({ id: 'PostStatus' });

export type PostStatus = z.infer<typeof postStatusSchema>;

/** "Open": any status except published and cancelled. */
export const OPEN_POST_STATUSES = [
  'idea',
  'in_production',
  'internal_review',
  'awaiting_client',
  'approved',
  'scheduled',
] as const satisfies readonly PostStatus[];

export function isPostOpen(status: PostStatus): boolean {
  return (OPEN_POST_STATUSES as readonly PostStatus[]).includes(status);
}

/** Limits of what one post holds; the API answers `LIMIT_REACHED` past `files`. */
export const POST_LIMITS = {
  title: 160,
  caption: 5000,
  hashtags: 1000,
  notes: 2000,
  /** Non-archived files of the post itself (edge case 14). */
  files: 10,
  /** Tasks linked to one post (rule 6). */
  tasks: 5,
  /** Tasks the link-task dialog is offered at once. */
  linkableTasks: 50,
  /** The widest range one calendar request covers, in days. */
  calendarDays: 45,
} as const;

// Workflow

/** A named move of the post workflow (spec F08, "Post status"). */
export type PostMove =
  | 'start'
  | 'submit'
  | 'return'
  | 'send_to_client'
  | 'approve'
  | 'withdraw'
  | 'client_approved'
  | 'client_changes'
  | 'schedule'
  | 'unschedule'
  | 'publish'
  | 'reopen_content'
  | 'cancel'
  | 'reopen';

/** The move from one status to another, or null when the workflow has none. */
export function postMove(from: PostStatus, to: PostStatus): PostMove | null {
  if (to === 'cancelled') return isPostOpen(from) ? 'cancel' : null;
  switch (`${from}>${to}`) {
    case 'idea>in_production':
      return 'start';
    case 'idea>internal_review':
    case 'in_production>internal_review':
      return 'submit';
    case 'internal_review>in_production':
      return 'return';
    case 'internal_review>awaiting_client':
      return 'send_to_client';
    case 'internal_review>approved':
      return 'approve';
    case 'awaiting_client>internal_review':
      return 'withdraw';
    case 'awaiting_client>approved':
      return 'client_approved';
    case 'awaiting_client>in_production':
      return 'client_changes';
    case 'approved>scheduled':
      return 'schedule';
    case 'scheduled>approved':
      return 'unschedule';
    case 'approved>published':
    case 'scheduled>published':
      return 'publish';
    case 'approved>in_production':
    case 'scheduled>in_production':
      return 'reopen_content';
    case 'cancelled>idea':
    case 'cancelled>in_production':
      return 'reopen';
    default:
      return null;
  }
}

/** What a move must carry (rule 1): a `note` of what must change, or a `reason`. */
export function postMoveNeeds(move: PostMove): 'note' | 'reason' | null {
  if (move === 'return' || move === 'client_changes') return 'note';
  if (move === 'cancel' || move === 'reopen_content') return 'reason';
  return null;
}

/**
 * What the caller may do on one post, worked out by the API from their scopes (spec F08, "Scopes
 * on posts"): `edit` is `content.manage`, `review` is `content.review`, `client` is F09's client
 * scope (`tasks.manage` under `all` or `own_clients` on the post's client).
 */
export type PostRights = { edit: boolean; review: boolean; client: boolean };

/** The parts of a post the workflow looks at. */
export type PostState = {
  status: PostStatus;
  /** The stage of `internal_review`; null in every other status. */
  reviewStage: ReviewStage | null;
  needsClientApproval: boolean;
  /** It has linked tasks or media: where reopening a cancelled post goes. */
  hasWork: boolean;
};

/**
 * Whether the caller may make this move (rule 1; archived excluded). In the medical stage review
 * scope may only return: the pass belongs to the medical reviewers, through their own route.
 */
export function canMakePostMove(post: PostState, move: PostMove, rights: PostRights): boolean {
  switch (move) {
    case 'start':
    case 'submit':
    case 'schedule':
    case 'unschedule':
    case 'publish':
    case 'reopen_content':
    case 'cancel':
    case 'reopen':
      return rights.edit;
    case 'return':
    case 'withdraw':
      return rights.review;
    case 'send_to_client':
      return rights.review && post.needsClientApproval && post.reviewStage !== 'medical';
    case 'approve':
      return rights.review && !post.needsClientApproval && post.reviewStage !== 'medical';
    case 'client_approved':
    case 'client_changes':
      return rights.client;
  }
}

/** Where reopening a cancelled post goes (rule 19). */
export const postReopenTarget = (post: PostState): PostStatus =>
  post.hasWork ? 'in_production' : 'idea';

/** Every status the caller may move the post to, in workflow order (for the UI). */
export function allowedPostTransitions(post: PostState, rights: PostRights): PostStatus[] {
  return POST_STATUSES.filter((to) => {
    if (post.status === 'cancelled' && to !== postReopenTarget(post)) return false;
    const move = postMove(post.status, to);
    return move !== null && canMakePostMove(post, move, rights);
  });
}

/** The fields that change only in `idea` and `in_production` (rule 3, `POST_LOCKED`). */
export const POST_CONTENT_FIELDS = ['caption', 'hashtags', 'type'] as const;

export function isPostContentEditable(status: PostStatus): boolean {
  return status === 'idea' || status === 'in_production';
}

/** Approved or scheduled with a publish date before today in Asia/Damascus. */
export function isPostOverdue(
  post: { status: PostStatus; publishDate: CalendarDate },
  now: Date = new Date(),
): boolean {
  return (
    (post.status === 'approved' || post.status === 'scheduled') &&
    post.publishDate < businessDate(now)
  );
}

/**
 * Rule 11: a token of what a review looks at: the media versions, the caption and the hashtags.
 * The same hash as F09's `reviewContentToken`.
 */
export function postContentToken(
  versionIds: readonly string[],
  caption: string | null,
  hashtags: string | null,
): string {
  return reviewContentToken(versionIds, JSON.stringify([caption ?? '', hashtags ?? '']));
}

/** The latest thing that sent a post back, as "Send back for changes" reads it (rule 12). */
export type PostReturnEvent = { kind: 'review' | 'response'; changesRequested: boolean };

/**
 * Rule 12: a linked task sent back counts as a client revision only when the latest review or
 * client response of the post is the client asking for changes.
 */
export const isClientReturn = (latest: PostReturnEvent | null): boolean =>
  latest?.kind === 'response' && latest.changesRequested;

/**
 * The title prefix of a task requested from a post (rule 9). Stored in Arabic, the language of
 * the records.
 */
const POST_TASK_PREFIXES: Record<PostType, string> = {
  post: 'منشور',
  reel: 'ريل',
  story: 'ستوري',
  carousel: 'كاروسيل',
};

/** Rule 9: "<type>: <post title>", cut to the length of a task title. */
export const postTaskTitle = (type: PostType, title: string): string =>
  `${POST_TASK_PREFIXES[type]}: ${title}`.slice(0, 160);

/** Rule 9: a reel is filmed, everything else is designed. */
export const postTaskDepartment = (type: PostType): DepartmentCode =>
  type === 'reel' ? 'photography' : 'design';

/** Rule 9: two work days before the publish date, never before today. */
export function postTaskDueDate(
  publishDate: CalendarDate,
  today: CalendarDate = businessDate(),
): CalendarDate {
  const due = workDaysBefore(publishDate, 2);
  return due < today ? today : due;
}

// Inputs

const postTitleSchema = z.string().trim().min(1).max(POST_LIMITS.title);

/** 1–8 distinct platforms, kept in the order given. */
const postPlatformsSchema = z
  .array(postPlatformSchema)
  .transform((platforms) => [...new Set(platforms)])
  .pipe(z.array(postPlatformSchema).min(1).max(POST_PLATFORMS.length));

export const publishedLinkSchema = z
  .object({ platform: postPlatformSchema, url: httpUrlSchema })
  .meta({ id: 'PublishedLink' });

export type PublishedLink = z.infer<typeof publishedLinkSchema>;

/** At most one link per platform; the API checks them against the post's platforms. */
const publishedLinksSchema = z
  .array(publishedLinkSchema)
  .max(POST_PLATFORMS.length)
  .refine((links) => new Set(links.map((link) => link.platform)).size === links.length, {
    message: 'One link per platform',
  });

const publishedAtSchema = z.iso.datetime({ offset: true });

const postFieldsSchema = z.object({
  title: postTitleSchema,
  type: postTypeSchema,
  platforms: postPlatformsSchema,
  publishDate: calendarDateSchema,
  publishTime: timeOfDaySchema.nullable(),
  /** Plain text with line breaks. */
  caption: optionalText(POST_LIMITS.caption),
  hashtags: optionalText(POST_LIMITS.hashtags),
  /** The internal brief for the team, never shown to the client. */
  notes: optionalText(POST_LIMITS.notes),
  needsClientApproval: z.boolean(),
  /** A non-archived user whose `content.manage` covers the client (`INVALID_RESPONSIBLE`). */
  responsibleId: z.uuid(),
  /** The retainer cycle line the post counts on directly (rule 16). */
  cycleLineId: z.uuid().nullable(),
});

/**
 * The API checks what needs the database: the client (rule 2), the responsible person, the cycle
 * line (rule 16) and that the publish date is not in the past (`INVALID_DATES`).
 */
export const createPostSchema = postFieldsSchema
  .extend({
    clientId: z.uuid(),
    needsClientApproval: z.boolean().default(true),
    /** The caller when left out. */
    responsibleId: z.uuid().optional(),
    cycleLineId: z.uuid().nullable().default(null),
  })
  .partial({ publishTime: true, caption: true, hashtags: true, notes: true })
  .meta({ id: 'CreatePost' });

export type CreatePost = z.infer<typeof createPostSchema>;

export type CreatePostInput = z.input<typeof createPostSchema>;

/**
 * Any subset of the fields (rule 3): the content fields only in `idea` and `in_production`, the
 * others in any open status; on a published post only `publishedAt` and `publishedLinks`.
 */
export const updatePostSchema = postFieldsSchema
  .extend({
    /** Published posts only; not in the future. */
    publishedAt: publishedAtSchema,
    publishedLinks: publishedLinksSchema,
  })
  .partial()
  .meta({ id: 'UpdatePost' });

export type UpdatePost = z.infer<typeof updatePostSchema>;

export type UpdatePostInput = z.input<typeof updatePostSchema>;

/**
 * A move to `to`. `note` and `reason` are required by the moves of `postMoveNeeds`;
 * `contentToken` is the one the reviewer was shown and is required by an internal pass (rule 11);
 * `contactId` names who answered for the client and is required when recording a client response
 * (rule 24); `publishedAt` and `publishedLinks` go with a move to `published` (rule 18).
 */
export const postStatusChangeSchema = z
  .object({
    to: postStatusSchema,
    note: optionalText(2000).optional(),
    reason: optionalText(500).optional(),
    contentToken: z.string().max(64).optional(),
    contactId: z.uuid().optional(),
    publishedAt: publishedAtSchema.optional(),
    publishedLinks: publishedLinksSchema.optional(),
  })
  .refine((change) => change.to !== 'cancelled' || !!change.reason, {
    message: 'Cancelling needs a reason',
    path: ['reason'],
  })
  .meta({ id: 'PostStatusChange' });

export type PostStatusChange = z.infer<typeof postStatusChangeSchema>;

export type PostStatusChangeInput = z.input<typeof postStatusChangeSchema>;

/** Rule 4: the copy keeps the publish date unless another is given. */
export const duplicatePostSchema = z
  .object({ publishDate: calendarDateSchema.optional() })
  .meta({ id: 'DuplicatePost' });

export type DuplicatePost = z.infer<typeof duplicatePostSchema>;

/** Offered by the link-task dialog: a search over the title and a department. */
export const linkableTaskQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  department: departmentCodeSchema.optional(),
});

export type LinkableTaskQuery = z.infer<typeof linkableTaskQuerySchema>;

/**
 * Rule 9: a task requested from the post, in a department's queue. Left out: the title is
 * `postTaskTitle`, the brief the post's notes and caption, the due date `postTaskDueDate`. The API
 * checks the due date (`INVALID_DATES`) and the cycle line (`INVALID_LINK`, `CYCLE_CLOSED`,
 * `POST_COUNTED_BY_TASK`).
 */
export const createPostTaskSchema = z
  .object({
    department: departmentCodeSchema,
    title: taskTitleSchema.optional(),
    brief: optionalText(5000).optional(),
    dueDate: calendarDateSchema.optional(),
    /** A line of an open cycle of a retainer of the post's client. */
    cycleLineId: z.uuid().nullable().default(null),
  })
  .meta({ id: 'CreatePostTask' });

export type CreatePostTask = z.infer<typeof createPostTaskSchema>;

export type CreatePostTaskInput = z.input<typeof createPostTaskSchema>;

/** Rule 12: what must change in the task's work. */
export const returnPostTaskSchema = z
  .object({ note: z.string().trim().min(1).max(2000) })
  .meta({ id: 'ReturnPostTask' });

export type ReturnPostTask = z.infer<typeof returnPostTaskSchema>;

// Responses

const personSchema = z.object({ id: z.uuid(), name: z.string() });

const archivablePersonSchema = personSchema.extend({ archived: z.boolean() });

/** A post as the calendar and the lists show it. */
export const postSchema = z
  .object({
    id: z.uuid(),
    client: personSchema,
    title: z.string(),
    type: postTypeSchema,
    platforms: z.array(postPlatformSchema),
    publishDate: calendarDateSchema,
    publishTime: timeOfDaySchema.nullable(),
    status: postStatusSchema,
    /** The stage of `internal_review`; null in every other status. */
    reviewStage: reviewStageSchema.nullable(),
    responsible: archivablePersonSchema,
    /** The first media version with a preview, for the card. */
    thumbnailVersionId: z.uuid().nullable(),
    linkedTaskCount: z.number().int().min(0),
    overdue: z.boolean(),
  })
  .meta({ id: 'Post' });

export type Post = z.infer<typeof postSchema>;

/** A pass or a return of a review; a pass carries the snapshot it approved (rule 11). */
export const postReviewSchema = z
  .object({
    id: z.uuid(),
    stage: reviewStageSchema,
    outcome: reviewOutcomeSchema,
    note: z.string().nullable(),
    /** Null for the system pass when a client stops being healthcare (rule 26). */
    reviewer: personSchema.nullable(),
    /** Passes only: the media in display order. */
    versions: z.array(reviewVersionSchema),
    /** Passes only: the post as it was approved. */
    caption: z.string().nullable(),
    hashtags: z.string().nullable(),
    type: postTypeSchema.nullable(),
    platforms: z.array(postPlatformSchema),
    publishDate: calendarDateSchema.nullable(),
    publishTime: timeOfDaySchema.nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'PostReview' });

export type PostReview = z.infer<typeof postReviewSchema>;

/** The client's answer on a snapshot, from an approval link or recorded by hand. */
export const postClientResponseSchema = z
  .object({
    id: z.uuid(),
    decision: clientDecisionSchema,
    channel: responseChannelSchema,
    contact: archivablePersonSchema,
    note: z.string().nullable(),
    /** The versions answered: the snapshot's. */
    versions: z.array(reviewVersionSchema),
    /** Manual responses only. */
    recordedBy: personSchema.nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'PostClientResponse' });

export type PostClientResponse = z.infer<typeof postClientResponseSchema>;

/** A media version of a post (rule 5): of its own file, or the final version of a linked task. */
export const postMediaSchema = approvalVersionSchema
  .extend({
    /** The linked task the version comes from; null for a file of the post itself. */
    task: z.object({ id: z.uuid(), title: z.string() }).nullable(),
  })
  .meta({ id: 'PostMedia' });

export type PostMedia = z.infer<typeof postMediaSchema>;

/** A task linked to the post, by link time. */
export const postTaskSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    department: departmentCodeSchema,
    assignee: archivablePersonSchema.nullable(),
    status: taskStatusSchema,
    /** The line the unit counts on through this task (rule 16). */
    cycleLine: z
      .object({ id: z.uuid(), kind: deliverableKindSchema, label: z.string().nullable() })
      .nullable(),
  })
  .meta({ id: 'PostTask' });

export type PostTask = z.infer<typeof postTaskSchema>;

/** A task the post may link (rule 6). */
export const linkableTaskSchema = taskSchema
  .extend({
    /** Of the retainer cycle of the post's publish date: offered first (ADR 0017). */
    inPublishCycle: z.boolean(),
  })
  .meta({ id: 'LinkableTask' });

export type LinkableTask = z.infer<typeof linkableTaskSchema>;

export const linkableTaskListSchema = z.object({ items: z.array(linkableTaskSchema) }).meta({
  id: 'LinkableTaskList',
  description: 'Open unlinked tasks of the client, the publish cycle first, then by due date',
});

export type LinkableTaskList = z.infer<typeof linkableTaskListSchema>;

export const postPermissionsSchema = z
  .object({
    /** Edit scope on a post that is not read-only. */
    canEdit: z.boolean(),
    /** `canEdit` while the content is unlocked (rule 3). */
    canEditContent: z.boolean(),
    canReview: z.boolean(),
    /** A medical reviewer other than the responsible person, on a post in the medical stage. */
    canMedicalReview: z.boolean(),
    /** Client scope on a post ready to send (rule 20). */
    canSendForApproval: z.boolean(),
    /** Client scope on a post waiting for the client, cleared for them (rule 24). */
    canRecordResponse: z.boolean(),
    canArchive: z.boolean(),
  })
  .meta({ id: 'PostPermissions', description: 'What the caller may do, for the UI' });

export type PostPermissions = z.infer<typeof postPermissionsSchema>;

export const postDetailSchema = postSchema
  .extend({
    client: personSchema.extend({ healthcare: z.boolean() }),
    /** `inScope` is false after the person lost edit scope on the client (rule 28). */
    responsible: archivablePersonSchema.extend({ inScope: z.boolean() }),
    caption: z.string().nullable(),
    hashtags: z.string().nullable(),
    notes: z.string().nullable(),
    needsClientApproval: z.boolean(),
    /** Rule 5, in display order: the post's own files, then the linked tasks' final versions. */
    media: z.array(postMediaSchema),
    /** By link time. */
    linkedTasks: z.array(postTaskSchema),
    cycleLine: z
      .object({
        id: z.uuid(),
        kind: deliverableKindSchema,
        label: z.string().nullable(),
        retainer: personSchema,
      })
      .nullable(),
    /** Of the media versions, the caption and the hashtags (rule 11). */
    contentToken: z.string(),
    /** The pass that put the post in `awaiting_client` or `approved`: what was sent. */
    clearedReview: postReviewSchema.nullable(),
    /** Oldest first. */
    reviewHistory: z.array(postReviewSchema),
    /** Oldest first. */
    clientResponses: z.array(postClientResponseSchema),
    /** The approval request holding the post's pending item. */
    pendingApproval: pendingApprovalSchema.nullable(),
    scheduledAt: z.iso.datetime().nullable(),
    publishedAt: z.iso.datetime().nullable(),
    publishedBy: personSchema.nullable(),
    publishedLinks: z.array(publishedLinkSchema),
    cancelledAt: z.iso.datetime().nullable(),
    cancelReason: z.string().nullable(),
    createdBy: personSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    archivedAt: z.iso.datetime().nullable(),
    /** Archived, or its client is archived (rule 2). */
    readOnly: z.boolean(),
    permissions: postPermissionsSchema,
    allowedTransitions: z.array(postStatusSchema),
  })
  .meta({ id: 'PostDetail' });

export type PostDetail = z.infer<typeof postDetailSchema>;

// Calendar and lists

const postFiltersSchema = z.object({
  clientId: z.uuid().optional(),
  status: queryListSchema(postStatusSchema).optional(),
  platform: postPlatformSchema.optional(),
  type: postTypeSchema.optional(),
  responsible: z.union([z.uuid(), z.literal('me')]).optional(),
  /** Posts in this stage of internal review: `medical` is the medical queue (F09). */
  reviewStage: reviewStageSchema.optional(),
});

/** Posts with a publish date in `[from, to]`, at most `POST_LIMITS.calendarDays` days. */
export const contentCalendarQuerySchema = postFiltersSchema
  .extend({ from: calendarDateSchema, to: calendarDateSchema })
  .refine(
    (query) =>
      query.from <= query.to && daysInclusive(query.from, query.to) <= POST_LIMITS.calendarDays,
    { message: `A range of 1 to ${POST_LIMITS.calendarDays} days`, path: ['to'] },
  );

export type ContentCalendarQuery = z.infer<typeof contentCalendarQuerySchema>;

export type ContentCalendarQueryInput = z.input<typeof contentCalendarQuerySchema>;

export const contentCalendarSchema = z
  .object({
    from: calendarDateSchema,
    to: calendarDateSchema,
    /** By publish date and time; cancelled posts included, archived ones never. */
    posts: z.array(postSchema),
    /** Posts of the range per status, under the same filters, the status filter aside. */
    counts: z.record(postStatusSchema, z.number().int().min(0)),
  })
  .meta({ id: 'ContentCalendar' });

export type ContentCalendar = z.infer<typeof contentCalendarSchema>;

/**
 * The sections of My posts: `publish_today`, `overdue` and `returned` are posts the caller is
 * responsible for; `to_review` is posts in internal review under the caller's review scope.
 */
export const POST_VIEWS = ['publish_today', 'overdue', 'to_review', 'returned'] as const;

export const postViewSchema = z.enum(POST_VIEWS).meta({ id: 'PostView' });

export type PostView = z.infer<typeof postViewSchema>;

export const postListQuerySchema = pageQuerySchema.extend(postFiltersSchema.shape).extend({
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
  /** Matches the title. */
  q: z.string().trim().min(1).max(100).optional(),
  view: postViewSchema.optional(),
  /** `true` lists archived posts only; needs `content.review` with scope all. */
  archived: queryBooleanSchema.default(false),
});

export type PostListQuery = z.infer<typeof postListQuerySchema>;

export type PostListQueryInput = z.input<typeof postListQuerySchema>;

export const postPageSchema = pageSchema(postSchema).meta({
  id: 'PostPage',
  description: 'Posts by publish date and time',
});

export type PostPage = z.infer<typeof postPageSchema>;

/** Counts for the sections of My posts (`POST_VIEWS`). */
export const myContentSummarySchema = z
  .object({
    publishToday: z.number().int().min(0),
    overdue: z.number().int().min(0),
    returned: z.number().int().min(0),
    /** Null without `content.review`. */
    toReview: z.number().int().min(0).nullable(),
  })
  .meta({ id: 'MyContentSummary' });

export type MyContentSummary = z.infer<typeof myContentSummarySchema>;
