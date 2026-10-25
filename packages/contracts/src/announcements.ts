import { z } from 'zod';
import { type Audience, audienceSchema } from './audiences.js';
import { calendarDateSchema, instantSchema } from './dates.js';
import { personSchema } from './images.js';
import { pageQuerySchema, pageSchema, queryListSchema } from './lists.js';
import { notificationPrioritySchema } from './notifications.js';

/*
 * Announcements (spec F16 part D, ADR 0038): written by anyone to any audience, frozen into
 * recipients when sent, with receipts, reminders, scheduling and pinning.
 */

export const ANNOUNCEMENT_STATUSES = ['draft', 'scheduled', 'sent', 'withdrawn'] as const;

export const announcementStatusSchema = z
  .enum(ANNOUNCEMENT_STATUSES)
  .meta({ id: 'AnnouncementStatus' });

export type AnnouncementStatus = z.infer<typeof announcementStatusSchema>;

export const ANNOUNCEMENT_LIMITS = {
  titleMin: 3,
  titleMax: 120,
  /** Characters of text in the body. */
  bodyText: 10_000,
  linkUrl: 1000,
  linkLabel: 60,
  /** Rule D5: a send is scheduled 5 minutes to 90 days ahead. */
  scheduleMinMinutes: 5,
  scheduleMaxDays: 90,
  /** Rule D7: pinned until a date up to 90 days ahead. */
  pinMaxDays: 90,
  /** F10 owner type `announcement`: attachments per announcement. */
  attachments: 5,
  /** Rule D8: daily reminders per recipient, and the pause between manual ones. */
  reminders: 3,
  remindEveryMinutes: 60,
  /** Rule D7: pinned announcements shown on the home page before "More announcements". */
  homePinned: 3,
} as const;

/* Polls (rule D11) */

export const POLL_LIMITS = {
  questionMin: 3,
  questionMax: 200,
  optionLabel: 100,
  optionsMin: 2,
  optionsMax: 10,
  /** A poll closes 1 hour to 90 days after the announcement is sent. */
  closeMinHours: 1,
  closeMaxDays: 90,
  /** `poll_closing` goes this long before closing, to polls that run at least `closingMinRunHours`. */
  closingLeadHours: 24,
  closingMinRunHours: 48,
} as const;

/** Who sees the counts: everyone once they voted (or the poll closed), or the author only. */
export const POLL_RESULTS_VISIBILITY = ['everyone_after_voting', 'author_only'] as const;

export const pollResultsVisibilitySchema = z
  .enum(POLL_RESULTS_VISIBILITY)
  .meta({ id: 'PollResultsVisibility' });

export type PollResultsVisibility = z.infer<typeof pollResultsVisibilitySchema>;

/** A poll as the author writes it; the options get their ids when stored. */
export const pollInputSchema = z
  .object({
    question: z.string().trim().min(POLL_LIMITS.questionMin).max(POLL_LIMITS.questionMax),
    options: z
      .array(z.string().trim().min(1).max(POLL_LIMITS.optionLabel))
      .min(POLL_LIMITS.optionsMin)
      .max(POLL_LIMITS.optionsMax)
      .refine((labels) => new Set(labels).size === labels.length, {
        message: 'Two options have the same label',
      }),
    multiple: z.boolean().default(false),
    anonymous: z.boolean().default(false),
    results: pollResultsVisibilitySchema.default('everyone_after_voting'),
    /** 1 hour to 90 days after sending (checked when sent or scheduled); null: closed by hand. */
    closesAt: instantSchema.nullable().default(null),
  })
  .meta({ id: 'PollInput' });

export type PollInput = z.infer<typeof pollInputSchema>;

/** Rule D11: whether a poll sent at `sentAt` may close at `closesAt`. */
export function isPollCloseTime(closesAt: Date, sentAt: Date): boolean {
  const ms = closesAt.getTime() - sentAt.getTime();
  return ms >= POLL_LIMITS.closeMinHours * 3_600_000 && ms <= POLL_LIMITS.closeMaxDays * 86_400_000;
}

/**
 * Rule D11: when `poll_closing` is due, one day before closing; null when the poll runs less
 * than two days or closes by hand.
 */
export function pollClosingReminderAt(sentAt: Date, closesAt: Date | null): Date | null {
  if (!closesAt) return null;
  if (closesAt.getTime() - sentAt.getTime() < POLL_LIMITS.closingMinRunHours * 3_600_000) {
    return null;
  }
  return new Date(closesAt.getTime() - POLL_LIMITS.closingLeadHours * 3_600_000);
}

/** `PUT /announcements/:id/poll/vote`: the caller's whole vote, which replaces the previous one. */
export const pollVoteSchema = z
  .object({
    optionIds: z
      .array(z.uuid())
      .min(1)
      .max(POLL_LIMITS.optionsMax)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'An option is listed twice' }),
  })
  .meta({ id: 'PollVote' });

export type PollVote = z.infer<typeof pollVoteSchema>;

/** A link in an announcement: `https:` only. */
const httpsUrlSchema = z
  .string()
  .trim()
  .pipe(z.url({ protocol: /^https$/ }).max(ANNOUNCEMENT_LIMITS.linkUrl));

/* The body: a TipTap document limited to the allowed nodes and marks (rule D13). */

/**
 * TipTap's name of the emphasis mark. The web renders it as a highlight, never slanted: Arabic is
 * not italicized (brand/identity.md).
 */
export const EMPHASIS_MARK = 'italic';

const markSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bold') }),
  z.object({ type: z.literal(EMPHASIS_MARK) }),
  z.object({
    type: z.literal('link'),
    attrs: z.object({
      href: z
        .string()
        .trim()
        .pipe(z.url({ protocol: /^(https|mailto)$/ }).max(ANNOUNCEMENT_LIMITS.linkUrl)),
    }),
  }),
]);

const textNodeSchema = z.object({
  type: z.literal('text'),
  text: z.string().min(1),
  marks: z.array(markSchema).max(3).optional(),
});

const inlineContent = z.array(textNodeSchema).optional();

const paragraphSchema = z.object({ type: z.literal('paragraph'), content: inlineContent });

const headingSchema = z.object({
  type: z.literal('heading'),
  attrs: z.object({ level: z.literal(3) }),
  content: inlineContent,
});

export type ListNode =
  | { type: 'bulletList'; content: ListItemNode[] }
  | { type: 'orderedList'; attrs?: { start?: number }; content: ListItemNode[] };

export type ListItemNode = {
  type: 'listItem';
  content: (z.infer<typeof paragraphSchema> | ListNode)[];
};

const listItemSchema: z.ZodType<ListItemNode> = z.lazy(() =>
  z.object({
    type: z.literal('listItem'),
    content: z.array(z.union([paragraphSchema, listSchema])).min(1),
  }),
);

const listSchema: z.ZodType<ListNode> = z.lazy(() =>
  z.union([
    z.object({ type: z.literal('bulletList'), content: z.array(listItemSchema).min(1) }),
    z.object({
      type: z.literal('orderedList'),
      attrs: z.object({ start: z.number().int().min(1).optional() }).optional(),
      content: z.array(listItemSchema).min(1),
    }),
  ]),
);

const blockSchema = z.union([paragraphSchema, headingSchema, listSchema]);

type BodyNode = { type: string; text?: string; content?: readonly BodyNode[] };

/** The blocks of a body as plain text, one per line; list items each on their own line. */
function blocksText(nodes: readonly BodyNode[]): string[] {
  return nodes.flatMap((node) => {
    if (node.type === 'paragraph' || node.type === 'heading') {
      return [(node.content ?? []).map((child) => child.text ?? '').join('')];
    }
    return blocksText(node.content ?? []);
  });
}

/**
 * Rule D13: an announcement's body. Unknown nodes, marks and attributes are refused or dropped
 * (Zod objects strip unknown keys), so only the allowed document is stored and rendered.
 */
export const announcementBodySchema = z
  .object({ type: z.literal('doc'), content: z.array(blockSchema).min(1) })
  .refine((body) => announcementText(body).trim().length > 0, { message: 'The body is empty' })
  .refine((body) => announcementText(body).length <= ANNOUNCEMENT_LIMITS.bodyText, {
    message: `The body holds more than ${ANNOUNCEMENT_LIMITS.bodyText} characters`,
  })
  .meta({ id: 'AnnouncementBody' });

export type AnnouncementBody = z.infer<typeof announcementBodySchema>;

/** The body as plain text: blocks on their own lines (pushes, emails and search, rule D13). */
export function announcementText(body: { content: readonly BodyNode[] }): string {
  return blocksText(body.content).join('\n');
}

/** Rule D13: the body's first 140 characters as one line of plain text. */
export function announcementExcerpt(body: { content: readonly BodyNode[] }): string {
  const text = announcementText(body).replace(/\s+/g, ' ').trim();
  return text.length <= 140 ? text : `${text.slice(0, 139)}…`;
}

/* Inputs */

const titleSchema = z
  .string()
  .trim()
  .min(ANNOUNCEMENT_LIMITS.titleMin)
  .max(ANNOUNCEMENT_LIMITS.titleMax);

const linkLabelSchema = z.string().trim().min(1).max(ANNOUNCEMENT_LIMITS.linkLabel);

export const announcementFieldsSchema = z.object({
  title: titleSchema,
  body: announcementBodySchema,
  linkUrl: httpsUrlSchema.nullable(),
  linkLabel: linkLabelSchema.nullable(),
  priority: notificationPrioritySchema,
  /** Rule D3: a critical announcement always requires it. */
  requiresAck: z.boolean(),
  audience: audienceSchema,
  /** Rule D7: needs `announcements.manage` covering every recipient. */
  pinnedUntil: calendarDateSchema.nullable(),
  /** Rule D11: one optional poll; locked once sent and voted on. */
  poll: pollInputSchema.nullable(),
});

/** Rule D3: critical forces the acknowledgement. */
export const ackOfCritical = <T extends { priority?: string; requiresAck?: boolean }>(
  input: T,
): T => (input.priority === 'critical' ? { ...input, requiresAck: true } : input);

export const labelNeedsLink = (input: { linkUrl?: string | null; linkLabel?: string | null }) =>
  !input.linkLabel || !!input.linkUrl;

export const labelNeedsLinkIssue = { message: 'A link label needs a link', path: ['linkLabel'] };

/** How a new announcement leaves the editor (rules D3, D5). */
export const ANNOUNCEMENT_SEND_MODES = ['now', 'schedule', 'draft'] as const;

export const createAnnouncementSchema = announcementFieldsSchema
  .partial({ linkUrl: true, linkLabel: true, pinnedUntil: true, poll: true })
  .extend({
    send: z.enum(ANNOUNCEMENT_SEND_MODES),
    /** Required with `schedule`: 5 minutes to 90 days ahead (checked when stored). */
    scheduledAt: instantSchema.optional(),
  })
  .refine((input) => input.send !== 'schedule' || !!input.scheduledAt, {
    message: 'A scheduled announcement needs its time',
    path: ['scheduledAt'],
  })
  .refine(labelNeedsLink, labelNeedsLinkIssue)
  .transform(ackOfCritical)
  .meta({ id: 'CreateAnnouncement' });

export type CreateAnnouncement = z.infer<typeof createAnnouncementSchema>;

export type CreateAnnouncementInput = z.input<typeof createAnnouncementSchema>;

/**
 * Rule D10: a draft or scheduled announcement changes in full; a sent one only its title, body,
 * link, pin and its existing poll until someone votes (`LOCKED_FIELD` otherwise). `notifyAgain`
 * re-notifies a sent one.
 */
export const updateAnnouncementSchema = announcementFieldsSchema
  .partial()
  .extend({
    /** A scheduled announcement's new time. */
    scheduledAt: instantSchema.optional(),
    notifyAgain: z.boolean().optional(),
  })
  .refine(labelNeedsLink, labelNeedsLinkIssue)
  .transform(ackOfCritical)
  .meta({ id: 'UpdateAnnouncement' });

export type UpdateAnnouncement = z.infer<typeof updateAnnouncementSchema>;

export type UpdateAnnouncementInput = z.input<typeof updateAnnouncementSchema>;

/** The fields a sent announcement still changes (rule D10). */
export const SENT_ANNOUNCEMENT_FIELDS = [
  'title',
  'body',
  'linkUrl',
  'linkLabel',
  'pinnedUntil',
  'poll',
  'notifyAgain',
] as const satisfies readonly (keyof UpdateAnnouncement)[];

/** `POST /announcements/:id/send`: a draft goes now, or at `scheduledAt` (rule D5). */
export const sendAnnouncementSchema = z
  .object({ scheduledAt: instantSchema.optional() })
  .meta({ id: 'SendAnnouncement' });

export type SendAnnouncement = z.infer<typeof sendAnnouncementSchema>;

/** Rule D5: whether `at` is 5 minutes to 90 days after `now`. */
export function isSchedulable(at: Date, now: Date): boolean {
  const ms = at.getTime() - now.getTime();
  return (
    ms >= ANNOUNCEMENT_LIMITS.scheduleMinMinutes * 60_000 &&
    ms <= ANNOUNCEMENT_LIMITS.scheduleMaxDays * 86_400_000
  );
}

/* Responses */

/**
 * A poll as the caller may see it (rule D11). Counts show to the author and holders of
 * `announcements.manage` `all`, and to recipients once they voted or the poll closed when the
 * results are for everyone; the voters' names only to the author and managers, never for an
 * anonymous poll.
 */
export const announcementPollSchema = z
  .object({
    question: z.string(),
    multiple: z.boolean(),
    anonymous: z.boolean(),
    results: pollResultsVisibilitySchema,
    closesAt: z.iso.datetime().nullable(),
    closedAt: z.iso.datetime().nullable(),
    /** Closed by hand or by time; no more votes. */
    closed: z.boolean(),
    options: z.array(
      z.object({
        id: z.uuid(),
        label: z.string(),
        /** Null when the caller may not see the results. */
        votes: z.number().int().min(0).nullable(),
        /** Null unless the caller may see named votes. */
        voters: z.array(personSchema).nullable(),
      }),
    ),
    /** People who voted; null when the caller may not see the results. */
    voters: z.number().int().min(0).nullable(),
    /** The caller's own choice; empty when they have not voted. */
    myVote: z.array(z.uuid()),
    /** What the caller may do (the API enforces each). */
    rights: z.object({ vote: z.boolean(), close: z.boolean() }),
  })
  .meta({ id: 'AnnouncementPoll' });

export type AnnouncementPoll = z.infer<typeof announcementPollSchema>;

/** The caller's own receipt; null for a caller who is not a recipient. */
const receiptSchema = z
  .object({ openedAt: z.iso.datetime().nullable(), acknowledgedAt: z.iso.datetime().nullable() })
  .nullable();

/** Recipients, openings and acknowledgements (rule D9); for the author and managers only. */
export const announcementTotalsSchema = z
  .object({
    recipients: z.number().int().min(0),
    opened: z.number().int().min(0),
    acknowledged: z.number().int().min(0),
  })
  .meta({ id: 'AnnouncementTotals' });

export type AnnouncementTotals = z.infer<typeof announcementTotalsSchema>;

export const announcementSummarySchema = z
  .object({
    id: z.uuid(),
    author: personSchema,
    title: z.string(),
    excerpt: z.string(),
    priority: notificationPrioritySchema,
    requiresAck: z.boolean(),
    status: announcementStatusSchema,
    scheduledAt: z.iso.datetime().nullable(),
    sentAt: z.iso.datetime().nullable(),
    pinnedUntil: calendarDateSchema.nullable(),
    editedAt: z.iso.datetime().nullable(),
    /** Edge case 17: the scheduled send found nobody in the audience and left it a draft. */
    unsentAt: z.iso.datetime().nullable(),
    withdrawnAt: z.iso.datetime().nullable(),
    receipt: receiptSchema,
    totals: announcementTotalsSchema.nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'AnnouncementSummary' });

export type AnnouncementSummary = z.infer<typeof announcementSummarySchema>;

export const announcementSchema = announcementSummarySchema
  .extend({
    body: announcementBodySchema,
    linkUrl: z.string().nullable(),
    linkLabel: z.string().nullable(),
    /** For the author and holders of `announcements.manage` `all` only. */
    audience: audienceSchema.nullable(),
    renotifiedAt: z.iso.datetime().nullable(),
    withdrawnBy: personSchema.nullable(),
    poll: announcementPollSchema.nullable(),
    /** What the caller may do with it (the API enforces each). */
    rights: z.object({
      edit: z.boolean(),
      withdraw: z.boolean(),
      receipts: z.boolean(),
      acknowledge: z.boolean(),
    }),
  })
  .meta({ id: 'Announcement' });

export type Announcement = z.infer<typeof announcementSchema>;

/** `received`: the caller's; `sent`: written by the caller; `all`: `announcements.manage` `all`. */
export const ANNOUNCEMENT_VIEWS = ['received', 'sent', 'all'] as const;

export const announcementListQuerySchema = pageQuerySchema.extend({
  view: z.enum(ANNOUNCEMENT_VIEWS).default('received'),
  status: queryListSchema(announcementStatusSchema).optional(),
  /** Matches the title. */
  search: z.string().trim().min(1).max(100).optional(),
});

export type AnnouncementListQuery = z.infer<typeof announcementListQuerySchema>;

export const announcementPageSchema = pageSchema(announcementSummarySchema).meta({
  id: 'AnnouncementPage',
  description: 'Announcements, newest first (sent, else scheduled, else created)',
});

export type AnnouncementPage = z.infer<typeof announcementPageSchema>;

/** Rules D6, D7: the caller's pinned announcements and their unacknowledged critical ones. */
export const announcementHomeSchema = z
  .object({
    /** Newest first; the home page shows three before "More announcements". */
    pinned: z.array(announcementSummarySchema),
    /** Oldest first, shown one by one. */
    critical: z.array(announcementSchema),
  })
  .meta({ id: 'AnnouncementHome' });

export type AnnouncementHome = z.infer<typeof announcementHomeSchema>;

export const ANNOUNCEMENT_RECEIPT_FILTERS = ['all', 'not_opened', 'not_acknowledged'] as const;

export const announcementReceiptsQuerySchema = z.object({
  filter: z.enum(ANNOUNCEMENT_RECEIPT_FILTERS).default('all'),
});

export type AnnouncementReceiptsQuery = z.infer<typeof announcementReceiptsQuerySchema>;

/** Rule D9: each recipient with their times; an archived one stays (edge case 16). */
export const announcementReceiptsSchema = z
  .object({
    totals: announcementTotalsSchema,
    items: z.array(
      z.object({
        user: personSchema.extend({ archived: z.boolean() }),
        openedAt: z.iso.datetime().nullable(),
        acknowledgedAt: z.iso.datetime().nullable(),
        remindersSent: z.number().int().min(0),
      }),
    ),
  })
  .meta({ id: 'AnnouncementReceipts' });

export type AnnouncementReceipts = z.infer<typeof announcementReceiptsSchema>;

export const remindAnnouncementResultSchema = z
  .object({ reminded: z.number().int().min(0) })
  .meta({ id: 'RemindAnnouncementResult' });

export type RemindAnnouncementResult = z.infer<typeof remindAnnouncementResultSchema>;

/** The audience of a stored announcement, read back from its JSON. */
export function storedAudience(value: unknown): Audience {
  return audienceSchema.parse(value);
}
