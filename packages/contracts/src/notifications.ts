import { z } from 'zod';
import { CLIENT_DECISIONS } from './approvals.js';
import { calendarDateSchema, timeOfDaySchema } from './dates.js';
import { departmentCodeSchema } from './departments.js';
import { pageQuerySchema, pageSchema, queryBooleanSchema } from './lists.js';
import { minorAmountSchema, signedMinorAmountSchema } from './money.js';
import { BEHIND_ALERT_DAYS, deliverableKindSchema, RETAINER_LIMITS } from './retainers.js';

/*
 * In-app notifications (spec F14, ADR 0018): a fixed catalog of types, each rendered by the web
 * app from its type and a display snapshot (`data`); nothing user-facing is stored as text.
 */

/**
 * Every notification type, in first-match order: when one change gives a recipient several
 * types, only the earliest in this list is kept (spec F14, "Notification types").
 */
export const NOTIFICATION_TYPES = [
  'task_assigned',
  'task_mentioned',
  'task_returned',
  'task_review_requested',
  'task_medical_review_requested',
  'task_awaiting_client',
  'task_over_limit',
  'approval_responded',
  'approval_no_response',
  'approval_expired',
  'task_changed',
  'task_commented',
  'task_file_added',
  'task_requested',
  'tasks_generated',
  'task_approved',
  'task_opened',
  'request_finished',
  'post_returned',
  'post_review_requested',
  'post_medical_review_requested',
  'post_awaiting_client',
  'post_assigned',
  'post_approved',
  'post_task_ready',
  'post_task_unlinked',
  'shoot_booked',
  'shoot_dropped',
  'shoot_changed',
  'meeting_invited',
  'meeting_dropped',
  'meeting_changed',
  'task_due_soon',
  'task_overdue',
  'task_overdue_escalated',
  'task_over_limit_pending',
  'post_publish_today',
  'post_publish_overdue',
  'shoot_upcoming',
  'shoot_not_closed',
  'meeting_upcoming',
  'client_account_manager_assigned',
  'project_manager_assigned',
  'retainer_renewal_due',
  'retainer_behind',
  'quote_approval_requested',
  'quote_approval_decided',
  'quote_accepted',
  'invoice_overdue',
  'invoice_paid',
  'ad_budget_low',
  'lead_assigned',
  'lead_won',
  'lead_follow_up_overdue',
  'lead_follow_up_due',
] as const;

export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES).meta({ id: 'NotificationType' });

export type NotificationType = z.infer<typeof notificationTypeSchema>;

export const NOTIFICATION_CATEGORIES = [
  'tasks',
  'reminders',
  'calendar',
  'clients_projects',
] as const;

export const notificationCategorySchema = z
  .enum(NOTIFICATION_CATEGORIES)
  .meta({ id: 'NotificationCategory' });

export type NotificationCategory = z.infer<typeof notificationCategorySchema>;

/** The records a notification opens. */
export const NOTIFICATION_SUBJECTS = [
  'task',
  'client',
  'project',
  'retainer',
  'template_run',
  'approval_request',
  'post',
  'shoot',
  'meeting',
  'quote',
  'invoice',
  'lead',
] as const;

export const notificationSubjectTypeSchema = z
  .enum(NOTIFICATION_SUBJECTS)
  .meta({ id: 'NotificationSubjectType' });

export type NotificationSubjectType = z.infer<typeof notificationSubjectTypeSchema>;

/** Category, subject and whether a user may mute the type; action-required types may not. */
export const NOTIFICATION_CATALOG: Record<
  NotificationType,
  { category: NotificationCategory; subject: NotificationSubjectType; mutable: boolean }
> = {
  task_assigned: { category: 'tasks', subject: 'task', mutable: false },
  task_mentioned: { category: 'tasks', subject: 'task', mutable: true },
  task_returned: { category: 'tasks', subject: 'task', mutable: false },
  task_review_requested: { category: 'tasks', subject: 'task', mutable: false },
  task_medical_review_requested: { category: 'tasks', subject: 'task', mutable: false },
  task_awaiting_client: { category: 'tasks', subject: 'task', mutable: false },
  task_over_limit: { category: 'tasks', subject: 'task', mutable: false },
  post_returned: { category: 'tasks', subject: 'post', mutable: false },
  post_review_requested: { category: 'tasks', subject: 'post', mutable: false },
  post_medical_review_requested: { category: 'tasks', subject: 'post', mutable: false },
  post_awaiting_client: { category: 'tasks', subject: 'post', mutable: false },
  post_assigned: { category: 'tasks', subject: 'post', mutable: true },
  post_approved: { category: 'tasks', subject: 'post', mutable: false },
  post_task_ready: { category: 'tasks', subject: 'post', mutable: true },
  post_task_unlinked: { category: 'tasks', subject: 'post', mutable: false },
  shoot_booked: { category: 'calendar', subject: 'shoot', mutable: true },
  shoot_dropped: { category: 'calendar', subject: 'shoot', mutable: true },
  shoot_changed: { category: 'calendar', subject: 'shoot', mutable: true },
  shoot_upcoming: { category: 'calendar', subject: 'shoot', mutable: true },
  shoot_not_closed: { category: 'calendar', subject: 'shoot', mutable: false },
  meeting_invited: { category: 'calendar', subject: 'meeting', mutable: true },
  meeting_dropped: { category: 'calendar', subject: 'meeting', mutable: true },
  meeting_changed: { category: 'calendar', subject: 'meeting', mutable: true },
  meeting_upcoming: { category: 'calendar', subject: 'meeting', mutable: true },
  approval_responded: { category: 'tasks', subject: 'approval_request', mutable: false },
  approval_no_response: { category: 'reminders', subject: 'approval_request', mutable: false },
  approval_expired: { category: 'reminders', subject: 'approval_request', mutable: false },
  task_changed: { category: 'tasks', subject: 'task', mutable: true },
  task_commented: { category: 'tasks', subject: 'task', mutable: true },
  task_file_added: { category: 'tasks', subject: 'task', mutable: true },
  task_requested: { category: 'tasks', subject: 'task', mutable: false },
  tasks_generated: { category: 'tasks', subject: 'template_run', mutable: false },
  task_approved: { category: 'tasks', subject: 'task', mutable: true },
  task_opened: { category: 'tasks', subject: 'task', mutable: true },
  request_finished: { category: 'tasks', subject: 'task', mutable: true },
  task_due_soon: { category: 'reminders', subject: 'task', mutable: true },
  task_overdue: { category: 'reminders', subject: 'task', mutable: false },
  task_overdue_escalated: { category: 'reminders', subject: 'task', mutable: false },
  task_over_limit_pending: { category: 'reminders', subject: 'task', mutable: false },
  post_publish_today: { category: 'reminders', subject: 'post', mutable: true },
  post_publish_overdue: { category: 'reminders', subject: 'post', mutable: false },
  client_account_manager_assigned: {
    category: 'clients_projects',
    subject: 'client',
    mutable: false,
  },
  project_manager_assigned: { category: 'clients_projects', subject: 'project', mutable: false },
  retainer_renewal_due: { category: 'reminders', subject: 'retainer', mutable: true },
  retainer_behind: { category: 'reminders', subject: 'retainer', mutable: false },
  quote_approval_requested: { category: 'clients_projects', subject: 'quote', mutable: false },
  quote_approval_decided: { category: 'clients_projects', subject: 'quote', mutable: false },
  quote_accepted: { category: 'clients_projects', subject: 'quote', mutable: true },
  invoice_overdue: { category: 'reminders', subject: 'invoice', mutable: true },
  invoice_paid: { category: 'clients_projects', subject: 'invoice', mutable: true },
  ad_budget_low: { category: 'reminders', subject: 'client', mutable: true },
  lead_assigned: { category: 'clients_projects', subject: 'lead', mutable: false },
  lead_won: { category: 'clients_projects', subject: 'lead', mutable: true },
  lead_follow_up_overdue: { category: 'reminders', subject: 'lead', mutable: false },
  lead_follow_up_due: { category: 'reminders', subject: 'lead', mutable: false },
};

export function isMutableNotificationType(type: NotificationType): boolean {
  return NOTIFICATION_CATALOG[type].mutable;
}

/** The types of one category. */
export function notificationTypesOf(category: NotificationCategory): NotificationType[] {
  return NOTIFICATION_TYPES.filter((type) => NOTIFICATION_CATALOG[type].category === category);
}

/**
 * Rule 2: for each recipient and subject, keeps only the items of the earliest type in
 * `NOTIFICATION_TYPES`. Items about other subjects, and several items of the kept type (a
 * template run's notice as assignee and as department manager), all stay, in their order.
 */
export function firstMatchPerRecipient<
  Item extends { recipientId: string; subjectId: string; type: NotificationType },
>(items: readonly Item[]): Item[] {
  const rank = (type: NotificationType) => NOTIFICATION_TYPES.indexOf(type);
  const key = (item: Item) => `${item.recipientId}:${item.subjectId}`;
  const best = new Map<string, number>();
  for (const item of items) {
    best.set(key(item), Math.min(best.get(key(item)) ?? Infinity, rank(item.type)));
  }
  return items.filter((item) => rank(item.type) === best.get(key(item)));
}

/* Display snapshots, one schema per type. */

export const NOTIFICATION_EXCERPT_MAX = 140;

const nameSchema = z.string();

/** The task as it was when the notification was sent. */
const taskSnapshotSchema = z.object({
  title: nameSchema,
  department: departmentCodeSchema,
  client: nameSchema.nullable(),
  project: nameSchema.nullable(),
});

const taskData = z.object({ task: taskSnapshotSchema });

const commentData = taskData.extend({
  excerpt: z.string().max(NOTIFICATION_EXCERPT_MAX),
});

const dueSchema = z.object({ dueDate: calendarDateSchema, dueTime: timeOfDaySchema.nullable() });

export const TASK_CHANGES = ['due', 'cancelled', 'archived', 'taken_away'] as const;

export const REVIEW_SOURCES = ['internal', 'client', 'medical'] as const;

const reviewSourceSchema = z.enum(REVIEW_SOURCES);

/**
 * Why a task left its post without being unlinked by hand (F08 rule 8); `reopened`: a delivered
 * task of a published post went back to work (edge case 9).
 */
export const POST_TASK_UNLINK_REASONS = ['cancelled', 'archived', 'reopened'] as const;

export type PostTaskUnlinkReason = (typeof POST_TASK_UNLINK_REASONS)[number];

/** An approval request as it was when the notification was sent (F09). */
const approvalData = z.object({ client: nameSchema, contact: nameSchema });

/** The post as it was when the notification was sent (F08). */
const postData = z.object({
  post: z.object({
    title: nameSchema,
    client: nameSchema,
    publishDate: calendarDateSchema,
    publishTime: timeOfDaySchema.nullable(),
  }),
});

/** A lead as it was when the notification was sent (F03): its display name. */
const leadData = z.object({ lead: nameSchema });

/** A shoot as it was when the notification was sent (F11). */
const shootData = z.object({
  shoot: z.object({
    title: nameSchema,
    client: nameSchema.nullable(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    location: z.string(),
  }),
});

/** A meeting as it was when the notification was sent (F11). */
const meetingData = z.object({
  meeting: z.object({
    title: nameSchema,
    client: nameSchema.nullable(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
  }),
});

/** A quote as it was when the notification was sent (F04). */
const quoteData = z.object({
  quote: z.object({ displayNumber: nameSchema, title: nameSchema, client: nameSchema }),
});

/** An invoice as it was when the notification was sent (F13). */
const invoiceData = z.object({
  invoice: z.object({ displayNumber: nameSchema, client: nameSchema }),
});

/** What changed on a scheduled shoot that its crew is told about. */
export const SHOOT_CHANGES = ['time', 'location', 'lead'] as const;

/** What changed on a meeting that its people are told about. */
export const MEETING_CHANGES = ['time', 'place', 'link'] as const;

/** Why someone left a shoot or a meeting. */
export const CALENDAR_DROP_CAUSES = ['cancelled', 'removed'] as const;

export const NOTIFICATION_DATA_SCHEMAS = {
  task_assigned: taskData,
  task_mentioned: commentData,
  task_returned: taskData.extend({ source: reviewSourceSchema }),
  task_review_requested: taskData,
  task_medical_review_requested: taskData,
  task_awaiting_client: taskData,
  task_over_limit: taskData,
  post_returned: postData.extend({ source: reviewSourceSchema }),
  post_review_requested: postData,
  post_medical_review_requested: postData,
  post_awaiting_client: postData,
  post_assigned: postData,
  post_approved: postData.extend({ source: reviewSourceSchema }),
  /** A linked task was approved by its department: its final files are the post's media. */
  post_task_ready: postData.extend({ taskTitle: nameSchema }),
  /** A linked task was cancelled or archived, which unlinks it (F08 rule 8). */
  post_task_unlinked: postData.extend({
    taskTitle: nameSchema,
    reason: z.enum(POST_TASK_UNLINK_REASONS),
  }),
  shoot_booked: shootData,
  shoot_dropped: shootData.extend({ cause: z.enum(CALENDAR_DROP_CAUSES) }),
  shoot_changed: shootData.extend({ changes: z.array(z.enum(SHOOT_CHANGES)).min(1) }),
  shoot_upcoming: shootData,
  shoot_not_closed: shootData,
  meeting_invited: meetingData,
  meeting_dropped: meetingData.extend({ cause: z.enum(CALENDAR_DROP_CAUSES) }),
  meeting_changed: meetingData.extend({ changes: z.array(z.enum(MEETING_CHANGES)).min(1) }),
  meeting_upcoming: meetingData,
  /** Merged per request like `task_commented`: the latest decision, `count` decisions. */
  approval_responded: approvalData.extend({ decision: z.enum(CLIENT_DECISIONS) }),
  approval_no_response: approvalData,
  approval_expired: approvalData,
  task_changed: taskData.extend({
    change: z.enum(TASK_CHANGES),
    /** For `due`: the due date before and after the change. */
    from: dueSchema.nullable(),
    to: dueSchema.nullable(),
  }),
  task_commented: commentData,
  /** Merged like `task_commented`: the latest file name, `count` files (F10). */
  task_file_added: taskData.extend({ file: nameSchema }),
  task_requested: taskData,
  tasks_generated: z.object({
    template: nameSchema,
    count: z.number().int().min(1),
    department: departmentCodeSchema,
    /** True for the managers' notice about the department's unassigned tasks. */
    unassigned: z.boolean(),
    client: nameSchema.nullable(),
    project: nameSchema.nullable(),
    retainer: nameSchema.nullable(),
  }),
  task_approved: taskData.extend({ source: reviewSourceSchema }),
  task_opened: taskData,
  request_finished: taskData.extend({ outcome: z.enum(['delivered', 'cancelled']) }),
  task_due_soon: taskData.extend(dueSchema.shape),
  task_overdue: taskData.extend(dueSchema.shape),
  task_overdue_escalated: taskData.extend(dueSchema.shape).extend({
    assignee: nameSchema.nullable(),
  }),
  /** P2A rule 10: an over-limit revision still waits for its decision. */
  task_over_limit_pending: taskData.extend({
    revisionNumber: z.number().int().min(1),
    recordedOn: calendarDateSchema,
  }),
  post_publish_today: postData,
  post_publish_overdue: postData,
  client_account_manager_assigned: z.object({ client: nameSchema }),
  project_manager_assigned: z.object({ project: nameSchema, client: nameSchema }),
  retainer_renewal_due: z.object({
    retainer: nameSchema,
    client: nameSchema,
    renewalDate: calendarDateSchema,
    /** 0 once the renewal date is reached. */
    daysLeft: z.number().int().min(0),
  }),
  /** P2A rule 6: the lines of an open cycle that are behind, by position. */
  retainer_behind: z.object({
    retainer: nameSchema,
    client: nameSchema,
    periodEnd: calendarDateSchema,
    daysLeft: z.number().int().min(1).max(BEHIND_ALERT_DAYS),
    /** The last reminder, at `BEHIND_FINAL_DAYS` or fewer. */
    final: z.boolean(),
    lines: z
      .array(
        z.object({
          kind: deliverableKindSchema,
          label: z.string().nullable(),
          delivered: z.number().int().min(0),
          committed: z.number().int().min(1),
          /** Approved but not yet counted (P2A rule 7). */
          ready: z.number().int().min(0),
        }),
      )
      .min(1)
      .max(RETAINER_LIMITS.cycleLines),
  }),
  /** F04 rule 7: a draft's discount waits for the General Manager. */
  quote_approval_requested: quoteData,
  quote_approval_decided: quoteData.extend({
    decision: z.enum(['approve', 'return']),
    note: z.string().nullable(),
  }),
  /** F04 A11: the engagements an accepted quote created or renewed. */
  quote_accepted: quoteData.extend({
    project: nameSchema.nullable(),
    retainer: nameSchema.nullable(),
  }),
  /** F13 A10: when the invoice becomes overdue, then every 7 days while it stays overdue. */
  invoice_overdue: invoiceData.extend({ daysOverdue: z.number().int().min(1) }),
  /** F13 rule 23: the invoice is fully paid. */
  invoice_paid: invoiceData,
  /** F12 A11: the balance fell below the threshold, then every 7 days while it stays below. */
  ad_budget_low: z.object({
    client: nameSchema,
    balanceMinor: signedMinorAmountSchema,
    thresholdMinor: minorAmountSchema,
  }),
  /** F03 rule 6: someone else made the recipient the lead's owner. */
  lead_assigned: leadData,
  /** F03 rule 10: the lead was converted into (or linked to) a client. */
  lead_won: leadData.extend({ client: nameSchema }),
  /** F03 A12 rule 19: two full work days passed without a new follow-up date. */
  lead_follow_up_overdue: leadData.extend({ followUpOn: calendarDateSchema, owner: nameSchema }),
  /** F03 A12 rule 18: the follow-up date is reached. */
  lead_follow_up_due: leadData.extend({ followUpOn: calendarDateSchema }),
} satisfies Record<NotificationType, z.ZodType>;

export type NotificationData<Type extends NotificationType> = z.infer<
  (typeof NOTIFICATION_DATA_SCHEMAS)[Type]
>;

/** A type with its snapshot, as modules pass it to `NotificationCenter.notify`. */
export type NotificationContent = {
  [Type in NotificationType]: { type: Type; data: NotificationData<Type> };
}[NotificationType];

/* Responses. */

const notificationBaseSchema = z.object({
  id: z.uuid(),
  /** Null for the daily job and automatic runs. */
  actor: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  subject: z.object({ type: notificationSubjectTypeSchema, id: z.uuid() }),
  /** Merged `task_commented`, `task_file_added` and `approval_responded` notifications count their items (rule 5); otherwise 1. */
  count: z.number().int().min(1),
  read: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const notificationSchema = z
  .discriminatedUnion(
    'type',
    NOTIFICATION_TYPES.map((type) =>
      notificationBaseSchema.extend({
        type: z.literal(type),
        data: NOTIFICATION_DATA_SCHEMAS[type],
      }),
    ) as unknown as [NotificationVariant, ...NotificationVariant[]],
  )
  .meta({ id: 'Notification' });

type NotificationVariant = {
  [Type in NotificationType]: z.ZodObject<
    typeof notificationBaseSchema.shape & {
      type: z.ZodLiteral<Type>;
      data: (typeof NOTIFICATION_DATA_SCHEMAS)[Type];
    }
  >;
}[NotificationType];

export type Notification = z.infer<typeof notificationSchema>;

export const notificationListQuerySchema = pageQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  unread: queryBooleanSchema.optional(),
  category: notificationCategorySchema.optional(),
});

export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

export const notificationPageSchema = pageSchema(notificationSchema).meta({
  id: 'NotificationPage',
  description: 'Newest `updatedAt` first',
});

export type NotificationPage = z.infer<typeof notificationPageSchema>;

export const unreadCountSchema = z
  .object({ count: z.number().int().min(0) })
  .meta({ id: 'NotificationUnreadCount' });

export type UnreadCount = z.infer<typeof unreadCountSchema>;

export const readAllResultSchema = z
  .object({ updated: z.number().int().min(0) })
  .meta({ id: 'NotificationReadAllResult' });

export type ReadAllResult = z.infer<typeof readAllResultSchema>;

/** The payload of a `notification` event on the stream. */
export const notificationStreamEventSchema = z
  .object({ notification: notificationSchema, unreadCount: z.number().int().min(0) })
  .meta({ id: 'NotificationStreamEvent' });

export type NotificationStreamEvent = z.infer<typeof notificationStreamEventSchema>;

/** The stream closes after this long so the session is checked again (ADR 0018). */
export const NOTIFICATION_STREAM_LIFETIME_MS = 15 * 60 * 1000;

export const NOTIFICATION_STREAM_PING_MS = 25 * 1000;

/* Settings. */

export const notificationSettingsSchema = z
  .object({
    types: z.array(
      z.object({
        type: notificationTypeSchema,
        category: notificationCategorySchema,
        mutable: z.boolean(),
        muted: z.boolean(),
      }),
    ),
  })
  .meta({ id: 'NotificationSettings' });

export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

/** The API refuses non-mutable types with `NOT_MUTABLE` (rule 3). */
export const updateNotificationSettingsSchema = z
  .object({ mutedTypes: z.array(notificationTypeSchema).max(NOTIFICATION_TYPES.length) })
  .meta({ id: 'UpdateNotificationSettings' });

export type UpdateNotificationSettings = z.infer<typeof updateNotificationSettingsSchema>;

/** Read notifications are deleted this many days after they were read (rule 13). */
export const NOTIFICATION_RETENTION_DAYS = 90;

/** Idempotency keys of the daily job (rule 8). */
export const NOTIFICATION_REMINDER_KINDS = [
  'due_soon',
  'overdue',
  'overdue_escalated',
  'renewal_due',
  'renewal_reached',
  'post_publish_today',
  'post_publish_overdue',
  'shoot_upcoming',
  'shoot_not_closed',
  'meeting_upcoming',
  'over_limit_pending',
  'cycle_behind',
  'cycle_behind_final',
  'invoice_overdue',
  'ad_budget_low',
  'lead_follow_up_due',
  'lead_follow_up_overdue',
] as const;

export type NotificationReminderKind = (typeof NOTIFICATION_REMINDER_KINDS)[number];
