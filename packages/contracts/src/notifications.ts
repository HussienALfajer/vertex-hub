import { z } from 'zod';
import { calendarDateSchema, timeOfDaySchema } from './dates.js';
import { departmentCodeSchema } from './departments.js';
import { pageQuerySchema, pageSchema, queryBooleanSchema } from './lists.js';

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
  'task_awaiting_client',
  'task_over_limit',
  'task_changed',
  'task_commented',
  'task_requested',
  'tasks_generated',
  'task_approved',
  'task_opened',
  'request_finished',
  'task_due_soon',
  'task_overdue',
  'task_overdue_escalated',
  'client_account_manager_assigned',
  'project_manager_assigned',
  'retainer_renewal_due',
] as const;

export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES).meta({ id: 'NotificationType' });

export type NotificationType = z.infer<typeof notificationTypeSchema>;

export const NOTIFICATION_CATEGORIES = ['tasks', 'reminders', 'clients_projects'] as const;

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
  task_awaiting_client: { category: 'tasks', subject: 'task', mutable: false },
  task_over_limit: { category: 'tasks', subject: 'task', mutable: false },
  task_changed: { category: 'tasks', subject: 'task', mutable: true },
  task_commented: { category: 'tasks', subject: 'task', mutable: true },
  task_requested: { category: 'tasks', subject: 'task', mutable: false },
  tasks_generated: { category: 'tasks', subject: 'template_run', mutable: false },
  task_approved: { category: 'tasks', subject: 'task', mutable: true },
  task_opened: { category: 'tasks', subject: 'task', mutable: true },
  request_finished: { category: 'tasks', subject: 'task', mutable: true },
  task_due_soon: { category: 'reminders', subject: 'task', mutable: true },
  task_overdue: { category: 'reminders', subject: 'task', mutable: false },
  task_overdue_escalated: { category: 'reminders', subject: 'task', mutable: false },
  client_account_manager_assigned: {
    category: 'clients_projects',
    subject: 'client',
    mutable: false,
  },
  project_manager_assigned: { category: 'clients_projects', subject: 'project', mutable: false },
  retainer_renewal_due: { category: 'reminders', subject: 'retainer', mutable: true },
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

export const REVIEW_SOURCES = ['internal', 'client'] as const;

const reviewSourceSchema = z.enum(REVIEW_SOURCES);

export const NOTIFICATION_DATA_SCHEMAS = {
  task_assigned: taskData,
  task_mentioned: commentData,
  task_returned: taskData.extend({ source: reviewSourceSchema }),
  task_review_requested: taskData,
  task_awaiting_client: taskData,
  task_over_limit: taskData,
  task_changed: taskData.extend({
    change: z.enum(TASK_CHANGES),
    /** For `due`: the due date before and after the change. */
    from: dueSchema.nullable(),
    to: dueSchema.nullable(),
  }),
  task_commented: commentData,
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
  client_account_manager_assigned: z.object({ client: nameSchema }),
  project_manager_assigned: z.object({ project: nameSchema, client: nameSchema }),
  retainer_renewal_due: z.object({
    retainer: nameSchema,
    client: nameSchema,
    renewalDate: calendarDateSchema,
    /** 0 once the renewal date is reached. */
    daysLeft: z.number().int().min(0),
  }),
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
  /** Merged `task_commented` notifications count the comments (rule 5); otherwise 1. */
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
] as const;

export type NotificationReminderKind = (typeof NOTIFICATION_REMINDER_KINDS)[number];
