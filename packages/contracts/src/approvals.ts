import { z } from 'zod';
import { calendarDateSchema, timeOfDaySchema } from './dates.js';
import { filePreviewStatusSchema, fileTypeSchema, fileVersionKindSchema } from './files.js';
import { pageQuerySchema, pageSchema, queryListSchema } from './lists.js';
import { postPlatformSchema, postTypeSchema } from './post-values.js';
import { optionalText } from './text.js';

/*
 * Client approval (spec F09, ADR 0020): the client's decisions, and the approval requests that
 * bundle ready tasks of one client into a link for a contact with final-approval authority.
 */

export const CLIENT_DECISIONS = ['approved', 'changes_requested'] as const;

export const clientDecisionSchema = z.enum(CLIENT_DECISIONS).meta({ id: 'ClientDecision' });

export type ClientDecision = z.infer<typeof clientDecisionSchema>;

/** How a client response arrived: through an approval link, or recorded by hand. */
export const RESPONSE_CHANNELS = ['link', 'manual'] as const;

export const responseChannelSchema = z.enum(RESPONSE_CHANNELS).meta({ id: 'ResponseChannel' });

export type ResponseChannel = z.infer<typeof responseChannelSchema>;

/** Computed, in this order: revoked, completed, expired, open. */
export const APPROVAL_REQUEST_STATES = ['open', 'expired', 'completed', 'revoked'] as const;

export const approvalRequestStateSchema = z
  .enum(APPROVAL_REQUEST_STATES)
  .meta({ id: 'ApprovalRequestState' });

export type ApprovalRequestState = z.infer<typeof approvalRequestStateSchema>;

export const APPROVAL_ITEM_STATUSES = [
  'pending',
  'approved',
  'changes_requested',
  'withdrawn',
] as const;

export const approvalItemStatusSchema = z
  .enum(APPROVAL_ITEM_STATUSES)
  .meta({ id: 'ApprovalItemStatus' });

export type ApprovalItemStatus = z.infer<typeof approvalItemStatusSchema>;

/** Why an item left `pending` without a decision (rules 8, 12 and 17; F08 rule 25). */
export const APPROVAL_WITHDRAWN_REASONS = [
  'revoked',
  'resent',
  'task_moved',
  'post_moved',
] as const;

export const approvalWithdrawnReasonSchema = z
  .enum(APPROVAL_WITHDRAWN_REASONS)
  .meta({ id: 'ApprovalWithdrawnReason' });

export type ApprovalWithdrawnReason = z.infer<typeof approvalWithdrawnReasonSchema>;

export const APPROVAL_LIMITS = {
  /** Tasks and posts in one request (a month of posts); `LIMIT_REACHED` past it. */
  items: 60,
  /** A link is valid this many days after it is issued. */
  linkDays: 7,
  /** Rule 24: the "no response" notice goes out this many hours after the link is issued. */
  reminderHours: 48,
} as const;

/** The state of a request (spec F09, "Data"). */
export function approvalRequestState(
  request: { revokedAt: Date | null; completedAt: Date | null; expiresAt: Date },
  now: Date = new Date(),
): ApprovalRequestState {
  if (request.revokedAt) return 'revoked';
  if (request.completedAt) return 'completed';
  if (now.getTime() >= request.expiresAt.getTime()) return 'expired';
  return 'open';
}

// Inputs

/** What an approval item sends: a task (F09) or a finished post (F08). */
export const APPROVAL_ITEM_KINDS = ['task', 'post'] as const;

export const approvalItemKindSchema = z.enum(APPROVAL_ITEM_KINDS).meta({ id: 'ApprovalItemKind' });

export type ApprovalItemKind = z.infer<typeof approvalItemKindSchema>;

/** What the client reads instead of the internal title of the task or the post. */
const itemTitleSchema = z.string().trim().min(1).max(160);

/** A task or a post, never both. */
const createApprovalItemSchema = z.union([
  z.strictObject({ taskId: z.uuid(), title: itemTitleSchema.optional() }),
  z.strictObject({ postId: z.uuid(), title: itemTitleSchema.optional() }),
]);

/**
 * The API checks what needs the database: the client scope, the contact (`CONTACT_NOT_APPROVER`),
 * that each task and post is ready (F09 rule 8, F08 rule 20) and the limit of
 * `APPROVAL_LIMITS.items`.
 */
export const createApprovalRequestSchema = z
  .object({
    clientId: z.uuid(),
    contactId: z.uuid(),
    /** Shown to the client at the top of the page. */
    message: optionalText(1000).optional(),
    items: z
      .array(createApprovalItemSchema)
      .min(1)
      .refine(
        (items) =>
          new Set(items.map((item) => ('taskId' in item ? item.taskId : item.postId))).size ===
          items.length,
        { message: 'A task or a post is sent once in a request' },
      ),
  })
  .meta({ id: 'CreateApprovalRequest' });

export type CreateApprovalRequest = z.infer<typeof createApprovalRequestSchema>;

export type CreateApprovalRequestInput = z.input<typeof createApprovalRequestSchema>;

/** The client's decision on one item of a link; asking for changes needs a note (rule 14). */
export const publicResponseSchema = z
  .object({ decision: clientDecisionSchema, note: optionalText(2000).optional() })
  .refine((response) => response.decision !== 'changes_requested' || !!response.note, {
    message: 'Requested changes need a note',
    path: ['note'],
  })
  .meta({ id: 'PublicApprovalResponse' });

export type PublicResponse = z.infer<typeof publicResponseSchema>;

export type PublicResponseInput = z.input<typeof publicResponseSchema>;

/** F08 rule 23: approves every pending post item of the link, with the same optional note. */
export const publicApproveAllSchema = z
  .object({ note: optionalText(2000).optional() })
  .meta({ id: 'PublicApproveAll' });

export type PublicApproveAll = z.infer<typeof publicApproveAllSchema>;

export type PublicApproveAllInput = z.input<typeof publicApproveAllSchema>;

// Responses

const personSchema = z.object({ id: z.uuid(), name: z.string() });

export const approvalRequestSchema = z
  .object({
    id: z.uuid(),
    client: personSchema,
    contact: personSchema.extend({ archived: z.boolean() }),
    state: approvalRequestStateSchema,
    items: z.object({
      total: z.number().int().min(1),
      approved: z.number().int().min(0),
      changesRequested: z.number().int().min(0),
      pending: z.number().int().min(0),
    }),
    issuedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    remindedAt: z.iso.datetime().nullable(),
    createdBy: personSchema,
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'ApprovalRequest' });

export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

/** A version of the snapshot an item sent, as the agency sees it. */
export const approvalVersionSchema = z
  .object({
    id: z.uuid(),
    fileItemId: z.uuid(),
    name: z.string(),
    number: z.number().int().min(1),
    kind: fileVersionKindSchema,
    type: fileTypeSchema,
    previewStatus: filePreviewStatusSchema,
  })
  .meta({ id: 'ApprovalVersion' });

export type ApprovalVersion = z.infer<typeof approvalVersionSchema>;

/** The post of a snapshot, as the client is shown it beside the media (F08 rule 27). */
const postSnapshotSchema = z.object({
  type: postTypeSchema,
  platforms: z.array(postPlatformSchema),
  publishDate: calendarDateSchema,
  publishTime: timeOfDaySchema.nullable(),
  caption: z.string().nullable(),
  hashtags: z.string().nullable(),
});

export const approvalItemSchema = z
  .object({
    id: z.uuid(),
    position: z.number().int().min(1),
    kind: approvalItemKindSchema,
    title: z.string(),
    /** Task items only. */
    task: z.object({ id: z.uuid(), title: z.string() }).nullable(),
    /** Post items only: the post, and its snapshot beside the versions. */
    post: postSnapshotSchema.extend({ id: z.uuid(), title: z.string() }).nullable(),
    status: approvalItemStatusSchema,
    withdrawnReason: approvalWithdrawnReasonSchema.nullable(),
    closedAt: z.iso.datetime().nullable(),
    /**
     * The snapshot sent, never the current versions and text: a task's by name, a post's in the
     * display order of its media.
     */
    versions: z.array(approvalVersionSchema),
    /** Task items only: the text for the client. */
    text: z.string().nullable(),
    response: z
      .object({
        decision: clientDecisionSchema,
        channel: responseChannelSchema,
        note: z.string().nullable(),
        createdAt: z.iso.datetime(),
      })
      .nullable(),
  })
  .meta({ id: 'ApprovalItem' });

export type ApprovalItem = z.infer<typeof approvalItemSchema>;

export const approvalRequestDetailSchema = approvalRequestSchema
  .omit({ items: true })
  .extend({
    counts: approvalRequestSchema.shape.items,
    message: z.string().nullable(),
    /** By position. */
    items: z.array(approvalItemSchema),
    /** For "Send on WhatsApp"; without it only copying the link is offered. */
    contactPhone: z.string().nullable(),
    permissions: z.object({ canReissue: z.boolean(), canRevoke: z.boolean() }),
  })
  .meta({ id: 'ApprovalRequestDetail' });

export type ApprovalRequestDetail = z.infer<typeof approvalRequestDetailSchema>;

/** A created or reissued request: `link` is shown once, only its hash is stored. */
export const issuedApprovalRequestSchema = approvalRequestDetailSchema
  .extend({ link: z.string() })
  .meta({ id: 'IssuedApprovalRequest' });

export type IssuedApprovalRequest = z.infer<typeof issuedApprovalRequestSchema>;

// Lists

export const approvalRequestListQuerySchema = pageQuerySchema.extend({
  clientId: z.uuid().optional(),
  state: queryListSchema(approvalRequestStateSchema).default(['open', 'expired']),
  createdBy: z.literal('me').optional(),
});

export type ApprovalRequestListQuery = z.infer<typeof approvalRequestListQuerySchema>;

export type ApprovalRequestListQueryInput = z.input<typeof approvalRequestListQuerySchema>;

export const approvalRequestPageSchema = pageSchema(approvalRequestSchema).meta({
  id: 'ApprovalRequestPage',
  description: 'Approval requests, newest first',
});

export type ApprovalRequestPage = z.infer<typeof approvalRequestPageSchema>;

// The client page

/** How the client page shows a file (rule 22): only `download` offers a download. */
export const PUBLIC_FILE_DISPLAYS = ['inline', 'download', 'link'] as const;

export const publicApprovalFileSchema = z
  .object({
    versionId: z.uuid(),
    kind: fileVersionKindSchema,
    name: z.string(),
    type: fileTypeSchema,
    sizeBytes: z.number().int().min(1).nullable(),
    display: z.enum(PUBLIC_FILE_DISPLAYS),
    previewAvailable: z.boolean(),
    linkUrl: z.string().nullable(),
    linkLabel: z.string().nullable(),
  })
  .meta({ id: 'PublicApprovalFile' });

export type PublicApprovalFile = z.infer<typeof publicApprovalFileSchema>;

export const publicApprovalItemSchema = z
  .object({
    id: z.uuid(),
    kind: approvalItemKindSchema,
    title: z.string(),
    /** Task items only. */
    text: z.string().nullable(),
    /** Post items only; null once the agency withdrew the item. */
    post: postSnapshotSchema.nullable(),
    files: z.array(publicApprovalFileSchema),
    status: approvalItemStatusSchema,
    /** The client's note with a decision. */
    note: z.string().nullable(),
    decidedAt: z.iso.datetime().nullable(),
    /** The decision was recorded by hand by the account manager (rule 16). */
    recordedByAgency: z.boolean(),
  })
  .meta({ id: 'PublicApprovalItem' });

export type PublicApprovalItem = z.infer<typeof publicApprovalItemSchema>;

/** The post items "Approve all" decided (F08 rule 23). */
export const publicApprovalItemsSchema = z
  .object({ items: z.array(publicApprovalItemSchema) })
  .meta({ id: 'PublicApprovalItems' });

export type PublicApprovalItems = z.infer<typeof publicApprovalItemsSchema>;

/** What the holder of a link sees (rule 21): nothing internal about the tasks and the posts. */
export const publicApprovalSchema = z
  .object({
    clientName: z.string(),
    contactName: z.string(),
    accountManagerName: z.string(),
    message: z.string().nullable(),
    expiresAt: z.iso.datetime(),
    /** Task items by position, then post items in publish order (F08 rule 27). */
    items: z.array(publicApprovalItemSchema),
  })
  .meta({ id: 'PublicApproval' });

export type PublicApproval = z.infer<typeof publicApprovalSchema>;
