import { z } from 'zod';
import {
  businessDate,
  businessInstant,
  type CalendarDate,
  calendarDateSchema,
  type TimeOfDay,
  timeOfDaySchema,
} from './dates.js';
import { departmentCodeSchema } from './departments.js';
import { extraWorkBillingSchema } from './extra-work.js';
import {
  pageQuerySchema,
  pageSchema,
  queryBooleanSchema,
  queryListSchema,
  sortOrderSchema,
} from './lists.js';
import { deliverableKindSchema } from './retainers.js';
import { httpUrlSchema, optionalText } from './text.js';
import { WORKFLOW_STATUSES } from './workflow.js';

/*
 * The task engine (spec F06, ADR 0016): one workflow for every department, requests between
 * departments, dependencies and client revisions counted against a limit.
 */

export const TASK_TYPES = ['work', 'client_request'] as const;

export const taskTypeSchema = z.enum(TASK_TYPES).meta({ id: 'TaskType' });

export type TaskType = z.infer<typeof taskTypeSchema>;

/** The unified workflow plus `cancelled`. */
export const TASK_STATUSES = [...WORKFLOW_STATUSES, 'cancelled'] as const;

export const taskStatusSchema = z.enum(TASK_STATUSES).meta({ id: 'TaskStatus' });

export type TaskStatus = z.infer<typeof taskStatusSchema>;

/** "Open": any status except delivered and cancelled. */
export const OPEN_TASK_STATUSES = [
  'new',
  'in_progress',
  'internal_review',
  'awaiting_client',
  'revisions',
  'approved',
] as const satisfies readonly TaskStatus[];

export function isTaskOpen(status: TaskStatus): boolean {
  return (OPEN_TASK_STATUSES as readonly TaskStatus[]).includes(status);
}

/** "Finished", for dependencies: approved or delivered. */
export function isTaskFinished(status: TaskStatus): boolean {
  return status === 'approved' || status === 'delivered';
}

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

export const taskPrioritySchema = z.enum(TASK_PRIORITIES).meta({ id: 'TaskPriority' });

export type TaskPriority = z.infer<typeof taskPrioritySchema>;

export const REQUEST_SCOPES = ['in_scope', 'out_of_scope'] as const;

export const requestScopeSchema = z.enum(REQUEST_SCOPES).meta({ id: 'RequestScope' });

export type RequestScope = z.infer<typeof requestScopeSchema>;

export const REVISION_SOURCES = ['internal', 'client'] as const;

export const revisionSourceSchema = z.enum(REVISION_SOURCES).meta({ id: 'RevisionSource' });

export type RevisionSource = z.infer<typeof revisionSourceSchema>;

export const REVISION_DECISIONS = ['free', 'extra_work'] as const;

export const revisionDecisionSchema = z.enum(REVISION_DECISIONS).meta({ id: 'RevisionDecision' });

export type RevisionDecision = z.infer<typeof revisionDecisionSchema>;

/** Limits of what one task holds (spec F06); the API answers `LIMIT_REACHED` past them. */
export const TASK_LIMITS = {
  dependencies: 10,
  checklist: 20,
  links: 30,
  revisionLimit: 20,
} as const;

export const DEFAULT_REVISION_LIMIT = 2;

// Workflow

/** A named move of the workflow (spec F06, "Task status"). */
export type TaskMove =
  | 'start'
  | 'submit'
  | 'return'
  | 'send_to_client'
  | 'approve'
  | 'client_approved'
  | 'client_changes'
  | 'resume'
  | 'resubmit'
  | 'deliver'
  | 'reopen_client'
  | 'reopen_internal'
  | 'cancel'
  | 'reopen';

/** The move from one status to another, or null when the workflow has none. */
export function taskMove(from: TaskStatus, to: TaskStatus): TaskMove | null {
  if (to === 'cancelled') return isTaskOpen(from) ? 'cancel' : null;
  switch (`${from}>${to}`) {
    case 'new>in_progress':
      return 'start';
    case 'in_progress>internal_review':
      return 'submit';
    case 'internal_review>revisions':
      return 'return';
    case 'internal_review>awaiting_client':
      return 'send_to_client';
    case 'internal_review>approved':
      return 'approve';
    case 'awaiting_client>approved':
      return 'client_approved';
    case 'awaiting_client>revisions':
    case 'approved>revisions':
      return 'client_changes';
    case 'revisions>in_progress':
      return 'resume';
    case 'revisions>internal_review':
      return 'resubmit';
    case 'approved>delivered':
      return 'deliver';
    case 'delivered>revisions':
      return 'reopen_client';
    case 'delivered>in_progress':
      return 'reopen_internal';
    case 'cancelled>in_progress':
    case 'cancelled>new':
      return 'reopen';
    default:
      return null;
  }
}

/** Moves that need a note: what must change, or why (rule 1). */
export function taskMoveNeedsNote(move: TaskMove): boolean {
  return [
    'return',
    'client_changes',
    'reopen_client',
    'reopen_internal',
    'cancel',
    'reopen',
  ].includes(move);
}

/** Moves that record a revision, and its source (rule 9). */
export function revisionSourceOf(move: TaskMove): RevisionSource | null {
  if (move === 'return') return 'internal';
  if (move === 'client_changes' || move === 'reopen_client') return 'client';
  return null;
}

/**
 * What the caller may do on one task, worked out by the API from their scopes (spec F06,
 * "Scopes on tasks"): `work` is `tasks.work`, `manage` is manage scope, `assign` is assign scope,
 * `client` is client scope, `creator` is being the task's creator.
 */
export type TaskRights = {
  work: boolean;
  manage: boolean;
  assign: boolean;
  client: boolean;
  creator: boolean;
};

/** The parts of a task the workflow looks at. */
export type TaskState = {
  status: TaskStatus;
  assigneeId: string | null;
  hasClient: boolean;
  needsClientApproval: boolean;
  blocked: boolean;
};

/** Whether the caller may make this move on the task (rules 1, 2, 3, 8, 13; archived excluded). */
export function canMakeTaskMove(task: TaskState, move: TaskMove, rights: TaskRights): boolean {
  switch (move) {
    case 'start':
      // A blocked task starts only with an override by assign scope (rule 3, actions table).
      return !!task.assigneeId && (task.blocked ? rights.assign : rights.work);
    case 'submit':
    case 'resume':
    case 'resubmit':
      return rights.work;
    case 'return':
      return rights.manage;
    case 'send_to_client':
      return rights.manage && task.needsClientApproval;
    case 'approve':
      return rights.manage && !task.needsClientApproval;
    case 'client_approved':
    case 'client_changes':
    case 'reopen_client':
      return rights.client && task.hasClient;
    case 'deliver':
      return rights.work || rights.client;
    case 'reopen_internal':
    case 'reopen':
      return rights.manage;
    case 'cancel':
      return rights.manage || (rights.creator && task.status === 'new' && task.assigneeId === null);
  }
}

/** Where reopening a cancelled task goes: back to work, or to the queue when unassigned. */
const reopenTarget = (task: TaskState): TaskStatus => (task.assigneeId ? 'in_progress' : 'new');

/** Every status the caller may move the task to, in workflow order (for the UI). */
export function allowedTaskTransitions(task: TaskState, rights: TaskRights): TaskStatus[] {
  return TASK_STATUSES.filter((to) => {
    if (task.status === 'cancelled' && to !== 'cancelled' && to !== reopenTarget(task))
      return false;
    const move = taskMove(task.status, to);
    return move !== null && canMakeTaskMove(task, move, rights);
  });
}

// Dependencies and due dates

/** A dependency as the blocked rule sees it. */
export type DependencyState = { status: TaskStatus; archived: boolean };

/** Rule 3: blocked while a non-archived, non-cancelled dependency is not finished. */
export function isTaskBlocked(dependencies: readonly DependencyState[]): boolean {
  return dependencies.some(
    (d) => !d.archived && d.status !== 'cancelled' && !isTaskFinished(d.status),
  );
}

/**
 * Rule 4: whether making `taskId` depend on `dependsOn` closes a cycle. `edges` maps each task to
 * the tasks it already depends on; the current edges of `taskId` are ignored.
 */
export function createsDependencyCycle(
  taskId: string,
  dependsOn: readonly string[],
  edges: ReadonlyMap<string, readonly string[]>,
): boolean {
  const seen = new Set<string>();
  const stack = [...dependsOn];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(edges.get(id) ?? []));
  }
  return false;
}

/**
 * Rule 12: open and past its due date in Asia/Damascus: after `dueTime` when set, else after the
 * end of the day.
 */
export function isTaskOverdue(
  task: { status: TaskStatus; dueDate: CalendarDate; dueTime: TimeOfDay | null },
  now: Date = new Date(),
): boolean {
  if (!isTaskOpen(task.status)) return false;
  if (task.dueTime) return now.getTime() > businessInstant(task.dueDate, task.dueTime).getTime();
  return businessDate(now) > task.dueDate;
}

// Inputs

export const taskTitleSchema = z.string().trim().min(1).max(160);

const checklistTextSchema = z.string().trim().min(1).max(200);

const uniqueIds = z.array(z.uuid()).transform((ids) => [...new Set(ids)]);

export const createTaskLinkSchema = z
  .object({ url: httpUrlSchema, label: optionalText(120).optional() })
  .meta({ id: 'CreateTaskLink' });

export type CreateTaskLink = z.infer<typeof createTaskLinkSchema>;

const taskFieldsSchema = z.object({
  title: taskTitleSchema,
  brief: optionalText(5000),
  department: departmentCodeSchema,
  /** Null leaves the task in the department's unassigned queue. */
  assigneeId: z.uuid().nullable(),
  priority: taskPrioritySchema,
  dueDate: calendarDateSchema,
  /** Overdue starts after this time instead of at the end of the day. */
  dueTime: timeOfDaySchema.nullable(),
  /** Null for an internal agency task. */
  clientId: z.uuid().nullable(),
  projectId: z.uuid().nullable(),
  milestoneId: z.uuid().nullable(),
  retainerCycleId: z.uuid().nullable(),
  cycleLineId: z.uuid().nullable(),
  /** Forced false without a client (rule 8). */
  needsClientApproval: z.boolean(),
  revisionLimit: z.number().int().min(0).max(TASK_LIMITS.revisionLimit),
  /** Client requests only: a non-archived contact of the client (`UNKNOWN_CONTACT`). */
  requestedByContactId: z.uuid().nullable(),
  /** Client requests only: not in the future; today when left out. */
  requestedOn: calendarDateSchema,
  /** Client requests only; `out_of_scope` creates an extra work item (rule 11). */
  requestScope: requestScopeSchema,
});

type LinkFields = {
  clientId?: string | null;
  projectId?: string | null;
  milestoneId?: string | null;
  retainerCycleId?: string | null;
  cycleLineId?: string | null;
};

/**
 * The links a task holds hang together: client ⊃ project ⊃ milestone, client ⊃ cycle ⊃ line, and
 * never a project and a retainer at once. Returns the first field that breaks it, or null. The API
 * runs it on the stored task merged with an update (`INVALID_LINK`).
 */
export function taskLinkProblem(task: LinkFields): keyof LinkFields | null {
  if ((task.projectId || task.retainerCycleId) && !task.clientId) return 'clientId';
  if (task.projectId && task.retainerCycleId) return 'retainerCycleId';
  if (task.milestoneId && !task.projectId) return 'milestoneId';
  if (task.cycleLineId && !task.retainerCycleId) return 'cycleLineId';
  return null;
}

/**
 * The API checks what needs the database: assignee (rule 6), links (rule 7), dates (rule 12),
 * dependencies (rule 4) and the limits of `TASK_LIMITS`.
 */
export const createTaskSchema = taskFieldsSchema
  .extend({
    type: taskTypeSchema.default('work'),
    assigneeId: z.uuid().nullable().default(null),
    priority: taskPrioritySchema.default('normal'),
    clientId: z.uuid().nullable().default(null),
    projectId: z.uuid().nullable().default(null),
    milestoneId: z.uuid().nullable().default(null),
    retainerCycleId: z.uuid().nullable().default(null),
    cycleLineId: z.uuid().nullable().default(null),
    /** True when left out and the task has a client. */
    needsClientApproval: z.boolean().optional(),
    revisionLimit: taskFieldsSchema.shape.revisionLimit.default(DEFAULT_REVISION_LIMIT),
    dependsOn: uniqueIds.default([]),
    checklist: z.array(checklistTextSchema).default([]),
    links: z.array(createTaskLinkSchema).default([]),
  })
  .partial({ brief: true, dueTime: true, requestedByContactId: true, requestedOn: true })
  .extend({ requestScope: requestScopeSchema.optional() })
  .superRefine((task, ctx) => {
    const problem = taskLinkProblem(task);
    if (problem)
      ctx.addIssue({ code: 'custom', path: [problem], message: 'The task links do not match' });
    if (task.type === 'client_request' && !task.clientId)
      ctx.addIssue({
        code: 'custom',
        path: ['clientId'],
        message: 'A client request needs a client',
      });
    if (
      task.type !== 'client_request' &&
      (task.requestedByContactId || task.requestedOn || task.requestScope)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['type'],
        message: 'Request fields belong to client requests only',
      });
  })
  .transform((task) => ({
    ...task,
    needsClientApproval: task.clientId ? (task.needsClientApproval ?? true) : false,
    requestScope:
      task.type === 'client_request' ? (task.requestScope ?? ('in_scope' as const)) : undefined,
  }))
  .meta({ id: 'CreateTask' });

export type CreateTask = z.infer<typeof createTaskSchema>;

export type CreateTaskInput = z.input<typeof createTaskSchema>;

/**
 * Any subset of the create fields except the type (fixed at creation, rule 11); dependencies,
 * checklist and links have their own endpoints. `assigneeId` and `department` need assign scope,
 * `requestScope` client scope. The API checks the links against the stored ones.
 */
export const updateTaskSchema = taskFieldsSchema.partial().meta({ id: 'UpdateTask' });

export type UpdateTask = z.infer<typeof updateTaskSchema>;

export type UpdateTaskInput = z.input<typeof updateTaskSchema>;

/**
 * A move to `status`. `note` is required by the moves of `taskMoveNeedsNote` (what must change,
 * or the reason); `revisionSource` may confirm a reopen from delivered (`client` → revisions,
 * `internal` → in progress); `contactId` names who answered for the client.
 */
export const taskStatusChangeSchema = z
  .object({
    status: taskStatusSchema,
    note: optionalText(2000).optional(),
    revisionSource: revisionSourceSchema.optional(),
    contactId: z.uuid().nullable().optional(),
    overrideDependencies: z.boolean().default(false),
    reason: optionalText(500).optional(),
  })
  .refine((change) => !change.overrideDependencies || !!change.reason, {
    message: 'Starting a blocked task needs a reason',
    path: ['reason'],
  })
  .refine((change) => change.status !== 'cancelled' || (change.note?.length ?? 0) <= 500, {
    message: 'A cancel reason is at most 500 characters',
    path: ['note'],
  })
  .meta({ id: 'TaskStatusChange' });

export type TaskStatusChange = z.infer<typeof taskStatusChangeSchema>;

export type TaskStatusChangeInput = z.input<typeof taskStatusChangeSchema>;

/** Every dependency of the task at once; at most `TASK_LIMITS.dependencies`. */
export const taskDependenciesInputSchema = z
  .object({ dependsOn: uniqueIds })
  .meta({ id: 'TaskDependenciesInput' });

export type TaskDependenciesInput = z.infer<typeof taskDependenciesInputSchema>;

export const revisionDecisionInputSchema = z
  .object({ decision: revisionDecisionSchema, note: optionalText(300).optional() })
  .refine((input) => input.decision !== 'free' || !!input.note, {
    message: 'A free revision needs a reason',
    path: ['note'],
  })
  .meta({ id: 'RevisionDecisionInput' });

export type RevisionDecisionInput = z.infer<typeof revisionDecisionInputSchema>;

// Responses

const personSchema = z.object({ id: z.uuid(), name: z.string() });

const archivablePersonSchema = personSchema.extend({ archived: z.boolean() });

export const taskSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    type: taskTypeSchema,
    department: departmentCodeSchema,
    /** `inDepartment` is false after the assignee left the department (edge case 4). */
    assignee: archivablePersonSchema.extend({ inDepartment: z.boolean() }).nullable(),
    status: taskStatusSchema,
    priority: taskPrioritySchema,
    dueDate: calendarDateSchema,
    dueTime: timeOfDaySchema.nullable(),
    overdue: z.boolean(),
    blocked: z.boolean(),
    client: personSchema.nullable(),
    project: personSchema.nullable(),
    milestone: personSchema.nullable(),
    retainer: personSchema.nullable(),
    cycle: z
      .object({ id: z.uuid(), periodStart: calendarDateSchema, periodEnd: calendarDateSchema })
      .nullable(),
    cycleLine: z
      .object({ id: z.uuid(), kind: deliverableKindSchema, label: z.string().nullable() })
      .nullable(),
    checklist: z.object({ done: z.number().int().min(0), total: z.number().int().min(0) }),
    revisions: z.object({ clientCount: z.number().int().min(0), limit: z.number().int().min(0) }),
    /** An over-limit client revision waits for the account manager's decision (rule 10). */
    overLimitPending: z.boolean(),
  })
  .meta({ id: 'Task' });

export type Task = z.infer<typeof taskSchema>;

export const taskDependencySchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    department: departmentCodeSchema,
    status: taskStatusSchema,
    finished: z.boolean(),
    /** Archived or cancelled dependencies no longer block and are shown struck through. */
    archived: z.boolean(),
  })
  .meta({ id: 'TaskDependency' });

export type TaskDependency = z.infer<typeof taskDependencySchema>;

export const taskDependencyListSchema = z
  .object({ items: z.array(taskDependencySchema) })
  .meta({ id: 'TaskDependencyList', description: 'The tasks this task waits on' });

export type TaskDependencyList = z.infer<typeof taskDependencyListSchema>;

export const taskChecklistItemSchema = z
  .object({
    id: z.uuid(),
    text: z.string(),
    position: z.number().int().min(1),
    done: z.boolean(),
    doneAt: z.iso.datetime().nullable(),
    doneBy: personSchema.nullable(),
  })
  .meta({ id: 'TaskChecklistItem' });

export type TaskChecklistItem = z.infer<typeof taskChecklistItemSchema>;

export const taskLinkSchema = z
  .object({
    id: z.uuid(),
    url: z.string(),
    label: z.string().nullable(),
    addedBy: personSchema,
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'TaskLink' });

export type TaskLink = z.infer<typeof taskLinkSchema>;

export const taskRevisionSchema = z
  .object({
    id: z.uuid(),
    source: revisionSourceSchema,
    /** Client revisions only: 1, 2, 3… */
    number: z.number().int().min(1).nullable(),
    note: z.string(),
    contact: archivablePersonSchema.nullable(),
    overLimit: z.boolean(),
    decision: revisionDecisionSchema.nullable(),
    decisionNote: z.string().nullable(),
    extraWork: z.object({ id: z.uuid(), title: z.string() }).nullable(),
    decidedBy: personSchema.nullable(),
    decidedAt: z.iso.datetime().nullable(),
    author: personSchema,
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'TaskRevision' });

export type TaskRevision = z.infer<typeof taskRevisionSchema>;

export const taskPermissionsSchema = z
  .object({
    canEdit: z.boolean(),
    canAssign: z.boolean(),
    canWork: z.boolean(),
    canReview: z.boolean(),
    canRecordClientResponse: z.boolean(),
    canDecideRevision: z.boolean(),
    canCancel: z.boolean(),
    canReopen: z.boolean(),
    canArchive: z.boolean(),
  })
  .meta({ id: 'TaskPermissions', description: 'What the caller may do, for the UI' });

export type TaskPermissions = z.infer<typeof taskPermissionsSchema>;

export const taskDetailSchema = taskSchema
  .extend({
    brief: z.string().nullable(),
    needsClientApproval: z.boolean(),
    clientRequest: z
      .object({
        contact: archivablePersonSchema.nullable(),
        requestedOn: calendarDateSchema,
        scope: requestScopeSchema,
        extraWork: z
          .object({ id: z.uuid(), title: z.string(), billingStatus: extraWorkBillingSchema })
          .nullable(),
      })
      .nullable(),
    /** The tasks this one waits on. */
    dependencies: z.array(taskDependencySchema),
    /** The tasks waiting on this one. */
    dependents: z.array(taskDependencySchema),
    /** Non-archived items, by position. */
    checklistItems: z.array(taskChecklistItemSchema),
    /** Non-archived links, oldest first. */
    links: z.array(taskLinkSchema),
    /** Oldest first. */
    revisionHistory: z.array(taskRevisionSchema),
    /** Null for a task the system created (an automatic template run, F07). */
    createdBy: personSchema.nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    startedAt: z.iso.datetime().nullable(),
    deliveredAt: z.iso.datetime().nullable(),
    cancelledAt: z.iso.datetime().nullable(),
    cancelReason: z.string().nullable(),
    archivedAt: z.iso.datetime().nullable(),
    /** Archived, or its client, project or retainer is archived (rule 17). */
    readOnly: z.boolean(),
    permissions: taskPermissionsSchema,
    allowedTransitions: z.array(taskStatusSchema),
  })
  .meta({ id: 'TaskDetail' });

export type TaskDetail = z.infer<typeof taskDetailSchema>;

// Lists

export const TASK_SORTS = ['dueDate', 'priority', 'createdAt', 'updatedAt'] as const;

export const taskListQuerySchema = pageQuerySchema.extend({
  /** Matches the title. */
  search: z.string().trim().min(1).max(100).optional(),
  status: queryListSchema(taskStatusSchema).default([...OPEN_TASK_STATUSES]),
  department: queryListSchema(departmentCodeSchema).optional(),
  assigneeId: z.union([z.uuid(), z.literal('me')]).optional(),
  unassigned: queryBooleanSchema.optional(),
  clientId: z.uuid().optional(),
  /** `true`: tasks without a client. */
  internal: queryBooleanSchema.optional(),
  projectId: z.uuid().optional(),
  milestoneId: z.uuid().optional(),
  retainerId: z.uuid().optional(),
  cycleLineId: z.uuid().optional(),
  type: taskTypeSchema.optional(),
  priority: queryListSchema(taskPrioritySchema).optional(),
  overdue: queryBooleanSchema.optional(),
  blocked: queryBooleanSchema.optional(),
  overLimit: queryBooleanSchema.optional(),
  dueFrom: calendarDateSchema.optional(),
  dueTo: calendarDateSchema.optional(),
  createdBy: z.literal('me').optional(),
  /** `me`: tasks the caller may review (manage scope), for My tasks' "to review". */
  reviewer: z.literal('me').optional(),
  /** `true` lists archived tasks only; needs `tasks.manage` with scope all. */
  archived: queryBooleanSchema.default(false),
  sort: z.enum(TASK_SORTS).default('dueDate'),
  order: sortOrderSchema.default('asc'),
});

export type TaskListQuery = z.infer<typeof taskListQuerySchema>;

export type TaskListQueryInput = z.input<typeof taskListQuerySchema>;

export const taskPageSchema = pageSchema(taskSchema).meta({ id: 'TaskPage' });

export type TaskPage = z.infer<typeof taskPageSchema>;

// Checklist and links

export const createTaskChecklistItemSchema = z
  .object({ text: checklistTextSchema })
  .meta({ id: 'CreateTaskChecklistItem' });

export type CreateTaskChecklistItem = z.infer<typeof createTaskChecklistItemSchema>;

/** Rename, tick (`done: true`) or untick an item. */
export const updateTaskChecklistItemSchema = z
  .object({ text: checklistTextSchema.optional(), done: z.boolean().optional() })
  .meta({ id: 'UpdateTaskChecklistItem' });

export type UpdateTaskChecklistItem = z.infer<typeof updateTaskChecklistItemSchema>;

/** Every non-archived item of the task once, in the new order (`INVALID_ORDER` otherwise). */
export const taskChecklistOrderSchema = z
  .object({ ids: z.array(z.uuid()) })
  .meta({ id: 'TaskChecklistOrder' });

export type TaskChecklistOrder = z.infer<typeof taskChecklistOrderSchema>;

export const taskChecklistSchema = z
  .object({ items: z.array(taskChecklistItemSchema) })
  .meta({ id: 'TaskChecklist', description: 'Non-archived items, by position' });

export type TaskChecklist = z.infer<typeof taskChecklistSchema>;

// Comments

/** A mention in a comment body: `@{userId}`, shown with the user's current name. */
const MENTION_TOKEN =
  /@\{([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\}/g;

export const MAX_COMMENT_MENTIONS = 20;

/** The distinct users a comment body mentions, in order of first mention, lowercased. */
export function mentionedUserIds(body: string): string[] {
  return [
    ...new Set(
      [...body.matchAll(MENTION_TOKEN)].map((match) => (match[1] as string).toLowerCase()),
    ),
  ];
}

/** Rule 16: plain text with line breaks; the API checks that mentioned users are active. */
export const taskCommentInputSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1)
      .max(4000)
      .refine((body) => mentionedUserIds(body).length <= MAX_COMMENT_MENTIONS, {
        message: `At most ${MAX_COMMENT_MENTIONS} people are mentioned in one comment`,
      }),
  })
  .meta({ id: 'TaskCommentInput' });

export type TaskCommentInput = z.infer<typeof taskCommentInputSchema>;

export const taskCommentSchema = z
  .object({
    id: z.uuid(),
    author: archivablePersonSchema,
    /** Null once removed: the UI shows "comment removed" in its place. */
    body: z.string().nullable(),
    /** The users the body mentions, with their current names (edge case 14). */
    mentions: z.array(archivablePersonSchema),
    editedAt: z.iso.datetime().nullable(),
    removed: z.boolean(),
    createdAt: z.iso.datetime(),
    /** The caller wrote it and the task is not read-only. */
    canEdit: z.boolean(),
    /** The caller wrote it or holds `tasks.manage` with scope all, and the task is not read-only. */
    canRemove: z.boolean(),
  })
  .meta({ id: 'TaskComment' });

export type TaskComment = z.infer<typeof taskCommentSchema>;

export const taskCommentPageSchema = pageSchema(taskCommentSchema).meta({ id: 'TaskCommentPage' });

export type TaskCommentPage = z.infer<typeof taskCommentPageSchema>;

// Views

/** The statuses the board shows as columns; cancelled tasks are left out. */
export const BOARD_STATUSES = TASK_STATUSES.filter(
  (status): status is Exclude<TaskStatus, 'cancelled'> => status !== 'cancelled',
);

export const BOARD_LIMITS = {
  /** Cards per column; the rest are in the list. */
  cards: 200,
  /** The delivered column holds tasks delivered in the last days. */
  deliveredDays: 14,
} as const;

/** Departments of the board and the workload: the ones the caller manages, else their own. */
const viewDepartmentsSchema = queryListSchema(departmentCodeSchema).optional();

export const taskBoardQuerySchema = z.object({
  department: viewDepartmentsSchema,
  assigneeId: z.union([z.uuid(), z.literal('me')]).optional(),
  clientId: z.uuid().optional(),
});

export type TaskBoardQuery = z.infer<typeof taskBoardQuerySchema>;

export type TaskBoardQueryInput = z.input<typeof taskBoardQuerySchema>;

export const taskBoardSchema = z
  .object({
    /** The departments shown: the filter, or its default. */
    departments: z.array(departmentCodeSchema),
    columns: z.array(
      z.object({
        status: taskStatusSchema,
        /** At most `BOARD_LIMITS.cards`, by due date. */
        items: z.array(taskSchema),
        total: z.number().int().min(0),
      }),
    ),
  })
  .meta({ id: 'TaskBoard' });

export type TaskBoard = z.infer<typeof taskBoardSchema>;

export const taskWorkloadQuerySchema = z.object({
  department: viewDepartmentsSchema,
  /** Any day of the week to show (Saturday to Friday); this week when left out. */
  week: calendarDateSchema.optional(),
});

export type TaskWorkloadQuery = z.infer<typeof taskWorkloadQuerySchema>;

export type TaskWorkloadQueryInput = z.input<typeof taskWorkloadQuerySchema>;

export const taskWorkloadSchema = z
  .object({
    week: z.object({ from: calendarDateSchema, to: calendarDateSchema }),
    departments: z.array(departmentCodeSchema),
    /**
     * Each non-archived member of those departments, by name. Counts cover all of the person's
     * open tasks, in any department.
     */
    people: z.array(
      z.object({
        user: personSchema,
        /** The shown departments the person belongs to. */
        departments: z.array(departmentCodeSchema),
        overdue: z.number().int().min(0),
        dueThisWeek: z.number().int().min(0),
        open: z.number().int().min(0),
      }),
    ),
    /** Open tasks nobody is assigned to, per shown department. */
    unassigned: z.array(
      z.object({ department: departmentCodeSchema, count: z.number().int().min(0) }),
    ),
  })
  .meta({ id: 'TaskWorkload' });

export type TaskWorkload = z.infer<typeof taskWorkloadSchema>;

/** Counts for the sections of My tasks; each open task of the caller is in one due section. */
export const myTaskSummarySchema = z
  .object({
    overdue: z.number().int().min(0),
    today: z.number().int().min(0),
    /** Due after today, up to the end of this week (Friday). */
    thisWeek: z.number().int().min(0),
    later: z.number().int().min(0),
    /** Waiting on others: blocked, or awaiting the client. */
    waiting: z.number().int().min(0),
    /** In internal review, under the caller's manage scope. */
    toReview: z.number().int().min(0),
    /** Open tasks the caller created for someone else or for a department queue. */
    requestedByMe: z.number().int().min(0),
    /** Open unassigned tasks in the departments the caller manages; null for non-managers. */
    unassignedInMyDepartments: z.number().int().min(0).nullable(),
  })
  .meta({ id: 'MyTaskSummary' });

export type MyTaskSummary = z.infer<typeof myTaskSummarySchema>;
