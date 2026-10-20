import { z } from 'zod';
import { CLIENT_DECISIONS } from './approvals.js';
import { calendarDateSchema, timeOfDaySchema } from './dates.js';
import { departmentCodeSchema } from './departments.js';
import { clientEmailKindSchema } from './email-basics.js';
import { pageQuerySchema, pageSchema, queryBooleanSchema } from './lists.js';
import { currencySchema, minorAmountSchema, signedMinorAmountSchema } from './money.js';
import {
  BEHIND_ALERT_DAYS,
  deliverableKindSchema,
  RETAINER_LIMITS,
  termEndActionSchema,
} from './retainers.js';

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
  'retainer_term_renewed',
  'retainer_cycle_report_ready',
  'retainer_amendment_pending',
  'retainer_amendment_decided',
  'quote_approval_requested',
  'quote_approval_decided',
  'quote_accepted',
  'invoice_overdue',
  'invoice_paid',
  'ad_budget_low',
  'email_failed',
  'lead_assigned',
  'lead_won',
  'lead_follow_up_overdue',
  'lead_follow_up_due',
  'push_device_lost',
] as const;

export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES).meta({ id: 'NotificationType' });

export type NotificationType = z.infer<typeof notificationTypeSchema>;

export const NOTIFICATION_CATEGORIES = [
  'tasks',
  'reminders',
  'calendar',
  'clients_projects',
  'account',
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
  /** The recipient's own account (F16 `push_device_lost`): opens My account. */
  'user',
] as const;

export const notificationSubjectTypeSchema = z
  .enum(NOTIFICATION_SUBJECTS)
  .meta({ id: 'NotificationSubjectType' });

export type NotificationSubjectType = z.infer<typeof notificationSubjectTypeSchema>;

/** Category, subject and whether a user may mute the type; action-required types may not. */
const CATALOG: Record<
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
  retainer_term_renewed: { category: 'reminders', subject: 'retainer', mutable: true },
  retainer_cycle_report_ready: {
    category: 'clients_projects',
    subject: 'retainer',
    mutable: true,
  },
  retainer_amendment_pending: {
    category: 'clients_projects',
    subject: 'retainer',
    mutable: false,
  },
  retainer_amendment_decided: {
    category: 'clients_projects',
    subject: 'retainer',
    mutable: false,
  },
  quote_approval_requested: { category: 'clients_projects', subject: 'quote', mutable: false },
  quote_approval_decided: { category: 'clients_projects', subject: 'quote', mutable: false },
  quote_accepted: { category: 'clients_projects', subject: 'quote', mutable: true },
  invoice_overdue: { category: 'reminders', subject: 'invoice', mutable: true },
  invoice_paid: { category: 'clients_projects', subject: 'invoice', mutable: true },
  ad_budget_low: { category: 'reminders', subject: 'client', mutable: true },
  /** F14 email rule 23: opens the email's document; its subject type is given with the notice. */
  email_failed: { category: 'clients_projects', subject: 'client', mutable: false },
  lead_assigned: { category: 'clients_projects', subject: 'lead', mutable: false },
  lead_won: { category: 'clients_projects', subject: 'lead', mutable: true },
  lead_follow_up_overdue: { category: 'reminders', subject: 'lead', mutable: false },
  lead_follow_up_due: { category: 'reminders', subject: 'lead', mutable: false },
  push_device_lost: { category: 'account', subject: 'user', mutable: true },
};

/*
 * F16 (ADR 0037): priorities and the default push and email modes of each type. Priorities are
 * code, not settings: push urgency and, later, escalation depend on them.
 */

export const NOTIFICATION_PRIORITIES = [
  'critical',
  'important',
  'normal',
  'informational',
] as const;

export const notificationPrioritySchema = z
  .enum(NOTIFICATION_PRIORITIES)
  .meta({ id: 'NotificationPriority' });

export type NotificationPriority = z.infer<typeof notificationPrioritySchema>;

/**
 * How a channel (push, email) reaches a type: `required` always, `on` until the user turns it
 * off, `off` until the user turns it on, `unavailable` never.
 */
export const CHANNEL_MODES = ['required', 'on', 'off', 'unavailable'] as const;

export const channelModeSchema = z.enum(CHANNEL_MODES).meta({ id: 'ChannelMode' });

export type ChannelMode = z.infer<typeof channelModeSchema>;

/** The delivery channels a user chooses per type; the app channel follows the mute rule (F14). */
export const NOTIFICATION_CHANNELS = ['push', 'email'] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

type Channels = { priority: NotificationPriority; push: ChannelMode; email: ChannelMode };

const important = (email: ChannelMode = 'off'): Channels => ({
  priority: 'important',
  push: 'on',
  email,
});
const normal = (email: ChannelMode = 'off'): Channels => ({
  priority: 'normal',
  push: 'on',
  email,
});
const critical = (email: ChannelMode = 'on'): Channels => ({
  priority: 'critical',
  push: 'required',
  email,
});
const informational: Channels = { priority: 'informational', push: 'off', email: 'off' };

/** Spec F16, "Notification types": the priority and the default modes of each type. */
const CHANNELS: Record<NotificationType, Channels> = {
  task_assigned: important('on'),
  task_mentioned: important('on'),
  task_returned: important(),
  task_review_requested: important(),
  task_medical_review_requested: important(),
  task_awaiting_client: important(),
  task_over_limit: important(),
  approval_responded: important('on'),
  approval_no_response: important(),
  approval_expired: important(),
  task_changed: normal(),
  task_commented: normal(),
  task_file_added: normal(),
  task_requested: important(),
  /** The managers' notice about unassigned tasks is important (`notificationPriority`). */
  tasks_generated: normal(),
  task_approved: normal(),
  task_opened: normal(),
  request_finished: normal(),
  post_returned: important(),
  post_review_requested: important(),
  post_medical_review_requested: important(),
  post_awaiting_client: important(),
  post_assigned: important(),
  post_approved: normal(),
  post_task_ready: normal(),
  post_task_unlinked: important(),
  shoot_booked: normal(),
  shoot_dropped: normal(),
  shoot_changed: important(),
  meeting_invited: normal(),
  meeting_dropped: normal(),
  meeting_changed: important(),
  task_due_soon: important('on'),
  task_overdue: critical(),
  task_overdue_escalated: critical(),
  task_over_limit_pending: critical('required'),
  post_publish_today: important(),
  post_publish_overdue: critical(),
  shoot_upcoming: important(),
  shoot_not_closed: important(),
  meeting_upcoming: normal(),
  client_account_manager_assigned: important(),
  project_manager_assigned: important(),
  retainer_renewal_due: important(),
  /** The final reminder is critical and pushed always (`notificationPriority`, `pushModeOf`). */
  retainer_behind: important(),
  retainer_term_renewed: normal(),
  retainer_cycle_report_ready: important(),
  retainer_amendment_pending: important(),
  retainer_amendment_decided: normal(),
  quote_approval_requested: important(),
  quote_approval_decided: important(),
  quote_accepted: normal(),
  invoice_overdue: critical('required'),
  invoice_paid: normal('on'),
  ad_budget_low: important(),
  email_failed: important(),
  lead_assigned: important(),
  lead_won: normal(),
  lead_follow_up_due: important(),
  lead_follow_up_overdue: critical(),
  push_device_lost: informational,
};

/** Each type with its category, subject, mute rule, priority and default channel modes. */
export const NOTIFICATION_CATALOG = Object.fromEntries(
  NOTIFICATION_TYPES.map((type) => [type, { ...CATALOG[type], ...CHANNELS[type] }]),
) as Record<NotificationType, (typeof CATALOG)[NotificationType] & Channels>;

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
    /** The end action of the retainer's last term; null without a term (F05B T11). */
    endAction: termEndActionSchema.nullable().optional(),
  }),
  /** F05C R1: a cycle closed and its report is ready for the account manager. */
  retainer_cycle_report_ready: z.object({
    retainer: nameSchema,
    client: nameSchema,
    cycleId: z.uuid(),
    cycle: z.number().int().min(1),
    periodStart: calendarDateSchema,
    periodEnd: calendarDateSchema,
    /** The cycle's final delivery rate, whole percent; null with nothing committed. */
    deliveryRate: z.number().int().min(0).max(100).nullable(),
  }),
  /** F05B T7: the job scheduled the next term of a term that renews. */
  retainer_term_renewed: z.object({
    retainer: nameSchema,
    client: nameSchema,
    termNumber: z.number().int().min(1),
    /** F05C: the term's first and last day. */
    startDate: calendarDateSchema.optional(),
    endDate: calendarDateSchema.optional(),
    /** Notifications sent before F05C name the term's first and last months instead. */
    startMonth: calendarDateSchema.optional(),
    endMonth: calendarDateSchema.optional(),
  }),
  /** F05B A4: an amendment that reduces agreed amounts waits for the General Manager. */
  retainer_amendment_pending: z.object({
    retainer: nameSchema,
    client: nameSchema,
    number: z.number().int().min(1),
    /** Negative: the reduction over the cycles it affects. */
    moneyDeltaMinor: signedMinorAmountSchema,
    currency: currencySchema,
    creator: nameSchema,
  }),
  /** F05B A4: the General Manager approved or rejected the creator's amendment. */
  retainer_amendment_decided: z.object({
    retainer: nameSchema,
    number: z.number().int().min(1),
    approved: z.boolean(),
    note: z.string().nullable(),
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
  /** F14 email rule 23: a client email the recipient sent failed for good. */
  email_failed: z.object({
    kind: clientEmailKindSchema,
    client: nameSchema,
    /** The document's number, or the report's month; null for the statement and budget notices. */
    document: nameSchema.nullable(),
    recipients: z.array(nameSchema).min(1),
  }),
  /** F03 rule 6: someone else made the recipient the lead's owner. */
  lead_assigned: leadData,
  /** F03 rule 10: the lead was converted into (or linked to) a client. */
  lead_won: leadData.extend({ client: nameSchema }),
  /** F03 A12 rule 19: two full work days passed without a new follow-up date. */
  lead_follow_up_overdue: leadData.extend({ followUpOn: calendarDateSchema, owner: nameSchema }),
  /** F03 A12 rule 18: the follow-up date is reached. */
  lead_follow_up_due: leadData.extend({ followUpOn: calendarDateSchema }),
  /** F16 rule A13: the push service refused a device's subscription for good. */
  push_device_lost: z.object({ device: nameSchema }),
} satisfies Record<NotificationType, z.ZodType>;

export type NotificationData<Type extends NotificationType> = z.infer<
  (typeof NOTIFICATION_DATA_SCHEMAS)[Type]
>;

/** A type with its snapshot, as modules pass it to `NotificationCenter.notify`. */
export type NotificationContent = {
  [Type in NotificationType]: { type: Type; data: NotificationData<Type> };
}[NotificationType];

/**
 * The priority a notification snapshots (spec F16, "Notification types"): the type's, except the
 * final `retainer_behind` reminder (critical) and the managers' `tasks_generated` (important).
 */
export function notificationPriority(content: NotificationContent): NotificationPriority {
  if (content.type === 'retainer_behind' && content.data.final) return 'critical';
  if (content.type === 'tasks_generated' && content.data.unassigned) return 'important';
  return NOTIFICATION_CATALOG[content.type].priority;
}

/** The mode of a channel for a notification: the catalog default (policies arrive with F16 B). */
export function channelModeOf(
  content: NotificationContent,
  channel: NotificationChannel,
): ChannelMode {
  if (channel === 'push' && content.type === 'retainer_behind' && content.data.final) {
    return 'required';
  }
  return NOTIFICATION_CATALOG[content.type][channel];
}

/**
 * F16 rule B3: a channel is on for a user when it is `required`, never when `unavailable`, and
 * otherwise as the user's override says, else as the mode's default.
 */
export function effectiveChannel(mode: ChannelMode, override: boolean | undefined): boolean {
  if (mode === 'required') return true;
  if (mode === 'unavailable') return false;
  return override ?? mode === 'on';
}

/** A user's overrides of one channel: only the types where they depart from the default. */
export const channelOverridesSchema = z.partialRecord(notificationTypeSchema, z.boolean());

export type ChannelOverrides = z.infer<typeof channelOverridesSchema>;

/**
 * The overrides that make `chosen` the user's set of types on a channel, against the catalog
 * defaults. `required` and `unavailable` types cannot be chosen: their earlier override is kept,
 * so it applies again if the mode changes back (F16 edge case 7).
 */
export function channelOverrides(
  channel: NotificationChannel,
  chosen: ReadonlySet<NotificationType>,
  previous: ChannelOverrides,
): ChannelOverrides {
  const overrides: ChannelOverrides = {};
  for (const type of NOTIFICATION_TYPES) {
    const mode = NOTIFICATION_CATALOG[type][channel];
    if (mode === 'required' || mode === 'unavailable') {
      if (previous[type] !== undefined) overrides[type] = previous[type];
      continue;
    }
    if (chosen.has(type) !== (mode === 'on')) overrides[type] = chosen.has(type);
  }
  return overrides;
}

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
        /** F16: the type's fixed priority. */
        priority: notificationPrioritySchema,
        /** F16 rule B3: whether the type is pushed to the user's devices. */
        push: z.boolean(),
        pushMode: channelModeSchema,
        /** F14 email rule 2 and F16 rule B3: the effective choice; nothing is emailed while `emailLocked`. */
        email: z.boolean(),
        emailMode: channelModeSchema,
        /** Muted in the app, so nothing is created to push or email. */
        emailLocked: z.boolean(),
      }),
    ),
    /** F14 email rule 11: the morning digest. */
    digestEnabled: z.boolean(),
  })
  .meta({ id: 'NotificationSettings' });

export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

/**
 * The API refuses non-mutable types with `NOT_MUTABLE` (rule 3), a channel list that leaves out a
 * `required` type with `CHANNEL_REQUIRED` and one that holds an `unavailable` type with
 * `CHANNEL_UNAVAILABLE` (F16 rule B1). `emailTypes`, `pushTypes` and `digestEnabled` stay as they
 * are when left out. The API stores the lists as overrides of the defaults (F16 rule B3).
 */
export const updateNotificationSettingsSchema = z
  .object({
    mutedTypes: z.array(notificationTypeSchema).max(NOTIFICATION_TYPES.length),
    /** F14 email rule 2: every type may be emailed, including those that cannot be muted. */
    emailTypes: z.array(notificationTypeSchema).max(NOTIFICATION_TYPES.length).optional(),
    /** F16 rule A7: the types pushed to the user's devices. */
    pushTypes: z.array(notificationTypeSchema).max(NOTIFICATION_TYPES.length).optional(),
    digestEnabled: z.boolean().optional(),
  })
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

/** F14 email rules 3–8: a notification waits to be emailed, was emailed, or was not needed. */
export const NOTIFICATION_EMAIL_STATES = ['pending', 'sent', 'skipped'] as const;

export type NotificationEmailState = (typeof NOTIFICATION_EMAIL_STATES)[number];
