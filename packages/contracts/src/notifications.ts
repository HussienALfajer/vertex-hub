import { z } from 'zod';
import { CLIENT_DECISIONS } from './approvals.js';
import {
  addDays,
  businessDate,
  businessInstant,
  type CalendarDate,
  calendarDateSchema,
  nextWorkDay,
  timeOfDaySchema,
  workDaysBetween,
} from './dates.js';
import { type DepartmentCode, departmentCodeSchema } from './departments.js';
import { clientEmailKindSchema } from './email-basics.js';
import { pageQuerySchema, pageSchema, queryBooleanSchema } from './lists.js';
import { currencySchema, minorAmountSchema, signedMinorAmountSchema } from './money.js';
import { postStatusSchema } from './post-values.js';
import {
  BEHIND_ALERT_DAYS,
  deliverableKindSchema,
  RETAINER_LIMITS,
  termEndActionSchema,
} from './retainers.js';
import type { Role } from './roles.js';
import { revisionDecisionSchema, taskStatusSchema } from './workflow.js';

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
  'task_delivered',
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
  'task_reopened',
  'task_revision_decided',
  'task_due_shortly',
  'post_published',
  'post_cancelled',
  'post_file_added',
  'post_publish_shortly',
  'approval_opened',
  'approval_completed',
  'shoot_starting',
  'meeting_starting',
  'shoot_completed',
  'push_device_lost',
  'action_reminder',
  'action_escalated',
  'action_escalated_top',
  // F16: the followers' status notices come last, after every other notice of the change.
  'task_progressed',
  'post_progressed',
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
  task_reopened: { category: 'tasks', subject: 'task', mutable: true },
  task_delivered: { category: 'tasks', subject: 'task', mutable: true },
  task_revision_decided: { category: 'tasks', subject: 'task', mutable: true },
  task_progressed: { category: 'tasks', subject: 'task', mutable: true },
  task_due_shortly: { category: 'reminders', subject: 'task', mutable: true },
  post_published: { category: 'tasks', subject: 'post', mutable: true },
  post_cancelled: { category: 'tasks', subject: 'post', mutable: true },
  post_file_added: { category: 'tasks', subject: 'post', mutable: true },
  post_progressed: { category: 'tasks', subject: 'post', mutable: true },
  post_publish_shortly: { category: 'reminders', subject: 'post', mutable: true },
  approval_opened: { category: 'tasks', subject: 'approval_request', mutable: true },
  approval_completed: { category: 'tasks', subject: 'approval_request', mutable: true },
  shoot_starting: { category: 'calendar', subject: 'shoot', mutable: true },
  meeting_starting: { category: 'calendar', subject: 'meeting', mutable: true },
  shoot_completed: { category: 'calendar', subject: 'shoot', mutable: true },
  /** F16 rule B11: the escalation steps open the original's record; its subject type is given. */
  action_reminder: { category: 'reminders', subject: 'task', mutable: false },
  action_escalated: { category: 'reminders', subject: 'task', mutable: false },
  action_escalated_top: { category: 'reminders', subject: 'task', mutable: false },
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
  task_reopened: normal(),
  task_delivered: informational,
  task_revision_decided: informational,
  task_progressed: normal(),
  task_due_shortly: important(),
  post_published: informational,
  post_cancelled: normal(),
  post_file_added: normal(),
  post_progressed: normal(),
  post_publish_shortly: important(),
  approval_opened: informational,
  approval_completed: normal(),
  shoot_starting: important(),
  meeting_starting: important(),
  shoot_completed: informational,
  action_reminder: important(),
  action_escalated: important('on'),
  action_escalated_top: critical(),
};

/*
 * F16 part B (ADR 0037): inboxes, resolution, grouping and escalation per type.
 */

/** "Needs you" (`action`): something the recipient must do; "For your information" (`info`). */
export const NOTIFICATION_BOXES = ['action', 'info'] as const;

export const notificationBoxSchema = z.enum(NOTIFICATION_BOXES).meta({ id: 'NotificationBox' });

export type NotificationBox = z.infer<typeof notificationBoxSchema>;

/**
 * Who a step of the escalation chain goes to (rule B11): the original's open recipients, the
 * managers of each one's primary department, the General Managers and Internal Operations
 * managers, the managers of a department, or the holders of a role.
 */
export type EscalationTarget =
  | { to: 'open_recipients' }
  | { to: 'managers' }
  | { to: 'top' }
  | { to: 'department'; department: DepartmentCode }
  | { to: 'role'; role: Role };

/**
 * When a step is due, counted from the day the original was created: after that many work days
 * or calendar days, or once the invoice has been overdue that many days (`invoice_overdue`).
 */
export type EscalationDelay = { workDays: number } | { days: number } | { daysOverdue: number };

export const ESCALATION_STEPS = [1, 2, 3] as const;

export type EscalationStepNumber = (typeof ESCALATION_STEPS)[number];

export interface EscalationStep {
  step: EscalationStepNumber;
  after: EscalationDelay;
  target: EscalationTarget;
}

/**
 * Rule B11: step 1 one work day after the original, step 2 one work day after step 1, step 3
 * two work days after step 2.
 */
const CHAIN: readonly EscalationStep[] = [
  { step: 1, after: { workDays: 1 }, target: { to: 'open_recipients' } },
  { step: 2, after: { workDays: 2 }, target: { to: 'managers' } },
  { step: 3, after: { workDays: 4 }, target: { to: 'top' } },
];

/** The type each step sends. */
export const ESCALATION_TYPES = {
  1: 'action_reminder',
  2: 'action_escalated',
  3: 'action_escalated_top',
} as const satisfies Record<EscalationStepNumber, NotificationType>;

interface Engine {
  box: NotificationBox;
  /** Resolves as `done` when its recipient opens it ("opened" in the type tables). */
  opened: boolean;
  /** Rule B9: merges into the recipient's unread, unresolved row of the same type and subject. */
  merges: boolean;
  /** Rule B11: the steps sent while the original stays unresolved; empty when it never escalates. */
  escalation: readonly EscalationStep[];
}

const info: Engine = { box: 'info', opened: false, merges: false, escalation: [] };
const action = (rest: Partial<Omit<Engine, 'box'>> = {}): Engine => ({
  ...info,
  box: 'action',
  ...rest,
});
const opened = action({ opened: true });
const chain = action({ escalation: CHAIN });
const merged: Engine = { ...info, merges: true };

/** Spec F16, "Notification types": box, "opened", "merges" and "escalates" of each type. */
const ENGINE: Record<NotificationType, Engine> = {
  task_assigned: action(),
  task_mentioned: opened,
  task_returned: action(),
  task_review_requested: chain,
  task_medical_review_requested: chain,
  task_awaiting_client: chain,
  task_over_limit: action(),
  approval_responded: action({ opened: true, merges: true }),
  approval_no_response: action(),
  approval_expired: action(),
  task_changed: merged,
  task_commented: merged,
  task_file_added: merged,
  task_requested: chain,
  /** The managers' notice about unassigned tasks is in "Needs you" (`notificationBox`). */
  tasks_generated: info,
  task_approved: info,
  task_opened: info,
  request_finished: info,
  post_returned: action(),
  post_review_requested: chain,
  post_medical_review_requested: chain,
  post_awaiting_client: chain,
  post_assigned: action(),
  post_approved: info,
  post_task_ready: info,
  post_task_unlinked: action(),
  shoot_booked: info,
  shoot_dropped: info,
  shoot_changed: info,
  meeting_invited: info,
  meeting_dropped: info,
  meeting_changed: info,
  task_due_soon: action(),
  task_overdue: action(),
  task_overdue_escalated: action({
    escalation: [{ step: 3, after: { workDays: 2 }, target: { to: 'top' } }],
  }),
  task_over_limit_pending: action(),
  post_publish_today: action(),
  post_publish_overdue: action({
    escalation: [
      {
        step: 2,
        after: { workDays: 2 },
        target: { to: 'department', department: 'content_management' },
      },
    ],
  }),
  shoot_upcoming: info,
  shoot_not_closed: action({
    escalation: [
      { step: 2, after: { workDays: 2 }, target: { to: 'department', department: 'photography' } },
    ],
  }),
  meeting_upcoming: info,
  client_account_manager_assigned: opened,
  project_manager_assigned: opened,
  retainer_renewal_due: action(),
  retainer_behind: action(),
  retainer_term_renewed: info,
  retainer_cycle_report_ready: opened,
  retainer_amendment_pending: action({ escalation: CHAIN.slice(0, 1) }),
  retainer_amendment_decided: info,
  quote_approval_requested: action({ escalation: CHAIN.slice(0, 1) }),
  quote_approval_decided: opened,
  quote_accepted: info,
  invoice_overdue: action({
    escalation: [
      { step: 3, after: { daysOverdue: 14 }, target: { to: 'role', role: 'general_manager' } },
    ],
  }),
  invoice_paid: info,
  ad_budget_low: action({
    escalation: [{ step: 2, after: { days: 7 }, target: { to: 'role', role: 'finance' } }],
  }),
  email_failed: action(),
  lead_assigned: opened,
  lead_won: info,
  lead_follow_up_due: action(),
  lead_follow_up_overdue: action(),
  push_device_lost: info,
  task_reopened: info,
  task_delivered: info,
  task_revision_decided: info,
  task_progressed: merged,
  task_due_shortly: action(),
  post_published: info,
  post_cancelled: info,
  post_file_added: merged,
  post_progressed: merged,
  post_publish_shortly: action(),
  approval_opened: info,
  approval_completed: info,
  shoot_starting: info,
  meeting_starting: info,
  shoot_completed: info,
  action_reminder: action(),
  action_escalated: action(),
  action_escalated_top: action(),
};

/**
 * Each type with its category, subject, mute rule, priority, default channel modes, box, and its
 * resolution, grouping and escalation rules.
 */
export const NOTIFICATION_CATALOG = Object.fromEntries(
  NOTIFICATION_TYPES.map((type) => [
    type,
    { ...CATALOG[type], ...CHANNELS[type], ...ENGINE[type] },
  ]),
) as Record<NotificationType, (typeof CATALOG)[NotificationType] & Channels & Engine>;

/** The types that escalate (rule B11). */
export const ESCALATING_TYPES = NOTIFICATION_TYPES.filter(
  (type) => NOTIFICATION_CATALOG[type].escalation.length > 0,
);

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

/** Rule B11: names of those an escalation waits on, before "n more". */
export const ESCALATION_NAMES_SHOWN = 10;

/** An escalation step: the original's type and snapshot, how long it waited, and on whom. */
const escalationData = z.object({
  originalType: notificationTypeSchema,
  /** The original's snapshot, valid for `originalType` (checked when the step is stored). */
  originalData: z.record(z.string(), z.unknown()),
  /** Work days since the original was created. */
  waitingWorkDays: z.number().int().min(0),
  /** The original's open recipients, by name. */
  waitingOn: z.array(nameSchema).min(1).max(ESCALATION_NAMES_SHOWN),
  /** Open recipients beyond those named. */
  waitingOnMore: z.number().int().min(0),
});

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
  /** F16 part C: a cancelled task went back to work. */
  task_reopened: taskData,
  /** The task was delivered; for the project manager and the account manager. */
  task_delivered: taskData,
  /** An over-limit client revision was decided: free, or billed as extra work. */
  task_revision_decided: taskData.extend({ decision: revisionDecisionSchema }),
  /** Merged per task for its followers: the latest status, `count` moves (rule B12). */
  task_progressed: taskData.extend({ status: taskStatusSchema }),
  /** Rule B13: two hours before the due time of an open, assigned task. */
  task_due_shortly: taskData.extend(dueSchema.shape),
  post_published: postData,
  post_cancelled: postData,
  /** Merged per post like `task_file_added`: the latest file name, `count` files. */
  post_file_added: postData.extend({ file: nameSchema }),
  /** Merged per post for its followers: the latest status, `count` moves. */
  post_progressed: postData.extend({ status: postStatusSchema }),
  /** Rule B13: two hours before the publish time of an approved or scheduled post. */
  post_publish_shortly: postData,
  /** Part C rule 2: the client opened the link for the first time. */
  approval_opened: approvalData,
  /** Every item of the request is answered. */
  approval_completed: approvalData,
  /** Rule B13: two hours before a scheduled shoot starts. */
  shoot_starting: shootData,
  /** Rule B13: fifteen minutes before a meeting starts; `joinUrl` when it has a link. */
  meeting_starting: meetingData.extend({ joinUrl: z.string().nullable() }),
  /** The shoot was closed. */
  shoot_completed: shootData,
  /** F16 rule B11 step 1: the original still waits on its recipients. */
  action_reminder: escalationData,
  /** Step 2: the managers of those it waits on (or the step's department or role). */
  action_escalated: escalationData,
  /** Step 3: the General Managers and Internal Operations managers (or the step's role). */
  action_escalated_top: escalationData,
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

/**
 * The type a notification snapshots its box from (spec F16, "Notification types"): the type's,
 * except the managers' `tasks_generated`, which waits on them.
 */
export function notificationBox(content: NotificationContent): NotificationBox {
  if (content.type === 'tasks_generated' && content.data.unassigned) return 'action';
  return NOTIFICATION_CATALOG[content.type].box;
}

/**
 * Rule B5: the type whose resolution closes an `action` notification: its own, or the
 * original's for an escalation step (rule B11); null in "For your information".
 */
export function resolutionTypeOf(content: NotificationContent): NotificationType | null {
  if (notificationBox(content) === 'info') return null;
  return isEscalationType(content.type)
    ? (content.data as EscalationData).originalType
    : content.type;
}

export type EscalationData = NotificationData<'action_reminder'>;

export function isEscalationType(type: NotificationType): boolean {
  return (Object.values(ESCALATION_TYPES) as NotificationType[]).includes(type);
}

/** Work days after `anchor`, up to and including `today`. */
export function workDaysSince(anchor: CalendarDate, today: CalendarDate): number {
  return workDaysBetween(addDays(anchor, 1), today).length;
}

/**
 * Rule B11: whether a step of an original created on `anchor` is due `today`. `daysOverdue` is
 * the original's own count on `anchor` (`invoice_overdue`).
 */
export function escalationDue(
  step: EscalationStep,
  anchor: CalendarDate,
  today: CalendarDate,
  daysOverdue = 0,
): boolean {
  const { after } = step;
  if ('workDays' in after) return workDaysSince(anchor, today) >= after.workDays;
  if ('days' in after) return addDays(anchor, after.days) <= today;
  return addDays(anchor, after.daysOverdue - daysOverdue) <= today;
}

/** A channel's modes set by management (rule B2); a type without one uses the catalog's. */
export type ChannelPolicy = Record<NotificationChannel, ChannelMode>;

export type ChannelPolicies = Partial<Record<NotificationType, ChannelPolicy>>;

/** Rule B1: the mode of a channel for a type, from its policy, else the catalog default. */
export function typeChannelMode(
  type: NotificationType,
  channel: NotificationChannel,
  policies: ChannelPolicies,
): ChannelMode {
  return policies[type]?.[channel] ?? NOTIFICATION_CATALOG[type][channel];
}

/**
 * The mode of a channel for a notification (rule B1): the type's policy, else the catalog
 * default, where the final `retainer_behind` reminder is always pushed.
 */
export function channelModeOf(
  content: NotificationContent,
  channel: NotificationChannel,
  policies: ChannelPolicies,
): ChannelMode {
  const policy = policies[content.type]?.[channel];
  if (policy) return policy;
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
 * The overrides that make `chosen` the user's set of types on a channel, against the current
 * modes. `required` and `unavailable` types cannot be chosen: their earlier override is kept,
 * so it applies again if the mode changes back (F16 edge case 7).
 */
export function channelOverrides(
  channel: NotificationChannel,
  chosen: ReadonlySet<NotificationType>,
  previous: ChannelOverrides,
  policies: ChannelPolicies,
): ChannelOverrides {
  const overrides: ChannelOverrides = {};
  for (const type of NOTIFICATION_TYPES) {
    const mode = typeChannelMode(type, channel, policies);
    if (mode === 'required' || mode === 'unavailable') {
      if (previous[type] !== undefined) overrides[type] = previous[type];
      continue;
    }
    if (chosen.has(type) !== (mode === 'on')) overrides[type] = chosen.has(type);
  }
  return overrides;
}

/* Inboxes, resolution and snooze (rules B5–B8). */

export const NOTIFICATION_INBOXES = ['needs_you', 'fyi', 'done', 'snoozed'] as const;

export const notificationInboxSchema = z
  .enum(NOTIFICATION_INBOXES)
  .meta({ id: 'NotificationInbox' });

export type NotificationInbox = z.infer<typeof notificationInboxSchema>;

/** `done`: the work was done; `void`: it no longer applies (rule B5). */
export const NOTIFICATION_RESOLUTIONS = ['done', 'void'] as const;

export const notificationResolutionSchema = z
  .enum(NOTIFICATION_RESOLUTIONS)
  .meta({ id: 'NotificationResolution' });

export type NotificationResolution = z.infer<typeof notificationResolutionSchema>;

/** A notification's state as the inboxes read it. */
export interface InboxState {
  recipientId: string;
  box: NotificationBox;
  snoozed: boolean;
  resolution: NotificationResolution | null;
  resolvedById: string | null;
}

/**
 * Rule B6: snoozed rows wait in "Snoozed"; rows resolved by their recipient, or void, are
 * "Done"; rows resolved by someone else, or by the system, are "For your information"; open
 * `action` rows are "Needs you".
 */
export function notificationInbox(state: InboxState): NotificationInbox {
  if (state.snoozed) return 'snoozed';
  if (state.resolution === 'void') return 'done';
  if (state.resolution === 'done') {
    return state.resolvedById === state.recipientId ? 'done' : 'fyi';
  }
  return state.box === 'action' ? 'needs_you' : 'fyi';
}

/** Rule B8: one hour, three hours, or the next work day at 09:00. */
export const SNOOZE_OPTIONS = ['1h', '3h', 'next_work_day'] as const;

export type SnoozeOption = (typeof SNOOZE_OPTIONS)[number];

export const SNOOZE_MORNING = '09:00';

export const snoozeNotificationSchema = z
  .object({ for: z.enum(SNOOZE_OPTIONS) })
  .meta({ id: 'SnoozeNotification' });

export type SnoozeNotification = z.infer<typeof snoozeNotificationSchema>;

/** When a row snoozed `now` for `option` wakes (rule B8). */
export function snoozeUntil(option: SnoozeOption, now: Date): Date {
  if (option === 'next_work_day') {
    return businessInstant(nextWorkDay(businessDate(now)), SNOOZE_MORNING);
  }
  return new Date(now.getTime() + (option === '1h' ? 1 : 3) * 60 * 60 * 1000);
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
  /*
   * F16: the defaults only cover notifications rendered before F16 into queued email jobs, which
   * the worker still sends after the deploy; the API always sets them.
   */
  /** The priority the notification was sent with; critical rows sort first (rule B6). */
  priority: notificationPrioritySchema.default('normal'),
  box: notificationBoxSchema.default('info'),
  /** Rule B6: the list it shows in, for its recipient. */
  inbox: notificationInboxSchema.default('fyi'),
  /** Rule B5: how and by whom it was closed; `by` is null for automatic resolution. */
  resolution: z
    .object({
      outcome: notificationResolutionSchema,
      by: z.object({ id: z.uuid(), name: z.string() }).nullable(),
      at: z.iso.datetime(),
    })
    .nullable()
    .default(null),
  /** Rule B8: when a snoozed notification wakes. */
  snoozedUntil: z.iso.datetime().nullable().default(null),
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
  /** Rule B6: one inbox; without it, every notification that is not snoozed. */
  inbox: notificationInboxSchema.optional(),
});

export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

export const notificationPageSchema = pageSchema(notificationSchema).meta({
  id: 'NotificationPage',
  description: 'Critical first, then newest `updatedAt` first (F16 rule B6)',
});

export type NotificationPage = z.infer<typeof notificationPageSchema>;

/**
 * F16 rule B6: unread notifications that are not snoozed, and the open "Needs you" ones (read or
 * not).
 */
export const unreadCountSchema = z
  .object({ count: z.number().int().min(0), needsYou: z.number().int().min(0) })
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
        /** Rule B1: the current mode, the policy's or the catalog default. */
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
    /** F16 rule B14: the morning push summary. */
    morningPush: z.boolean(),
  })
  .meta({ id: 'NotificationSettings' });

export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

/**
 * The API refuses non-mutable types with `NOT_MUTABLE` (rule 3), a channel list that leaves out a
 * `required` type with `CHANNEL_REQUIRED` and one that holds an `unavailable` type with
 * `CHANNEL_UNAVAILABLE` (F16 rule B1). `emailTypes`, `pushTypes`, `digestEnabled` and
 * `morningPush` stay as they are when left out. The API stores the lists as overrides of the defaults (F16 rule B3).
 */
export const updateNotificationSettingsSchema = z
  .object({
    mutedTypes: z.array(notificationTypeSchema).max(NOTIFICATION_TYPES.length),
    /** F14 email rule 2: every type may be emailed, including those that cannot be muted. */
    emailTypes: z.array(notificationTypeSchema).max(NOTIFICATION_TYPES.length).optional(),
    /** F16 rule A7: the types pushed to the user's devices. */
    pushTypes: z.array(notificationTypeSchema).max(NOTIFICATION_TYPES.length).optional(),
    digestEnabled: z.boolean().optional(),
    /** F16 rule B14. */
    morningPush: z.boolean().optional(),
  })
  .meta({ id: 'UpdateNotificationSettings' });

export type UpdateNotificationSettings = z.infer<typeof updateNotificationSettingsSchema>;

/* Channel policy (F16 rules B1–B2). */

/** One type's policy: its defaults and the modes in force; `updatedAt` null at the defaults. */
export const notificationPolicySchema = z
  .object({
    type: notificationTypeSchema,
    category: notificationCategorySchema,
    priority: notificationPrioritySchema,
    defaults: z.object({ push: channelModeSchema, email: channelModeSchema }),
    push: channelModeSchema,
    email: channelModeSchema,
    updatedBy: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    updatedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'NotificationPolicy' });

export type NotificationPolicy = z.infer<typeof notificationPolicySchema>;

export const notificationPolicyListSchema = z
  .object({ items: z.array(notificationPolicySchema) })
  .meta({ id: 'NotificationPolicyList', description: 'Every type, in catalog order' });

export type NotificationPolicyList = z.infer<typeof notificationPolicyListSchema>;

/** Rule B2: set both modes, or go back to the catalog defaults. */
export const updateNotificationPolicySchema = z
  .union([
    z.object({ push: channelModeSchema, email: channelModeSchema }).strict(),
    z.object({ reset: z.literal(true) }).strict(),
  ])
  .meta({ id: 'UpdateNotificationPolicy' });

export type UpdateNotificationPolicy = z.infer<typeof updateNotificationPolicySchema>;

/* Followers (F16 rule B12). */

/** The records users follow. */
export const FOLLOW_SUBJECTS = ['task', 'post'] as const;

export type FollowSubject = (typeof FOLLOW_SUBJECTS)[number];

/** `auto`: the creator, assignee, commenters and mentioned users; `manual`: by hand. */
export const FOLLOW_SOURCES = ['auto', 'manual'] as const;

export const updateFollowingSchema = z
  .object({ following: z.boolean() })
  .meta({ id: 'UpdateFollowing' });

export type UpdateFollowing = z.infer<typeof updateFollowingSchema>;

/** Whether the caller follows the record, and how many follow it. */
export const followingSchema = z
  .object({ following: z.boolean(), followers: z.number().int().min(0) })
  .meta({ id: 'Following' });

export type Following = z.infer<typeof followingSchema>;

/**
 * Read notifications are deleted this many days after they were read (rule 13), and resolved
 * ones this many days after they were resolved (F16 rule B15).
 */
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
  /** F16 rule B11: keyed by the original's subject and the day it was created. */
  'escalation_1',
  'escalation_2',
  'escalation_3',
] as const;

export type NotificationReminderKind = (typeof NOTIFICATION_REMINDER_KINDS)[number];

/** F14 email rules 3–8: a notification waits to be emailed, was emailed, or was not needed. */
export const NOTIFICATION_EMAIL_STATES = ['pending', 'sent', 'skipped'] as const;

export type NotificationEmailState = (typeof NOTIFICATION_EMAIL_STATES)[number];

/** F16 rule B13: the timed sources of the minute job, keyed in `timed_reminders`. */
export const TIMED_REMINDER_KINDS = [
  'task_due_shortly',
  'post_publish_shortly',
  'shoot_starting',
  'meeting_starting',
] as const;

export type TimedReminderKind = (typeof TIMED_REMINDER_KINDS)[number];

/** How long before its moment each timed reminder is sent. */
export const TIMED_REMINDER_LEAD_MINUTES: Record<TimedReminderKind, number> = {
  task_due_shortly: 120,
  post_publish_shortly: 120,
  shoot_starting: 120,
  meeting_starting: 15,
};

/**
 * A run this late after a reminder's send time still sends it; later, the reminder is skipped
 * (rule B13, edge case 15). Covers the few seconds or minutes a run can start late.
 */
export const TIMED_REMINDER_GRACE_MINUTES = 5;

/** `timed_reminders` rows are purged this many days after their moment. */
export const TIMED_REMINDER_RETENTION_DAYS = 30;

const MINUTE_MS = 60 * 1000;

/**
 * Rule B13: the moments a run at `now` sends reminders of `kind` for: after `from`, up to `to`.
 * A moment whose send time is more than the grace before `now` has passed and is skipped.
 */
export function timedReminderWindow(kind: TimedReminderKind, now: Date): { from: Date; to: Date } {
  const lead = TIMED_REMINDER_LEAD_MINUTES[kind] * MINUTE_MS;
  return {
    from: new Date(now.getTime() + lead - TIMED_REMINDER_GRACE_MINUTES * MINUTE_MS),
    to: new Date(now.getTime() + lead),
  };
}
