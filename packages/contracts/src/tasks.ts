import { z } from 'zod';
import {
  approvalRequestStateSchema,
  clientDecisionSchema,
  responseChannelSchema,
} from './approvals.js';
import {
  businessDate,
  businessInstant,
  type CalendarDate,
  calendarDateSchema,
  type HolidayRange,
  type TimeOfDay,
  timeOfDaySchema,
  workDaysBetween,
} from './dates.js';
import { type DepartmentCode, departmentCodeSchema } from './departments.js';
import { extraWorkBillingSchema } from './extra-work.js';
import { fileItemNameSchema } from './files.js';
import { assigneeLeaveSchema } from './hr.js';
import { clientRefSchema, engagementRefSchema, personSchema } from './images.js';
import {
  pageQuerySchema,
  pageSchema,
  queryBooleanSchema,
  queryListSchema,
  sortOrderSchema,
} from './lists.js';
import { NOTIFICATION_EXCERPT_MAX } from './notifications.js';
import { deliverableKindSchema } from './retainers.js';
import {
  mentionedUserIds,
  mentionTextSchema,
  type RichTextDoc,
  replaceMentions,
  richTextFromPlain,
  richTextPlain,
  richTextSchema,
} from './rich-text.js';
import {
  departmentBriefFields,
  estimateMinutesSchema,
  type TaskBriefFields,
  taskBriefFieldsSchema,
} from './task-briefs.js';
import { httpUrlSchema, optionalText } from './text.js';
import {
  revisionDecisionSchema,
  TASK_STATUSES,
  type TaskStatus,
  taskStatusSchema,
} from './workflow.js';

/*
 * The task engine (spec F06, ADR 0016): one workflow for every department, requests between
 * departments, dependencies and client revisions counted against a limit. Review snapshots, the
 * medical review stage and client responses are spec F09 (ADR 0020). Subtasks, their run modes
 * and stages are spec F06B (ADR 0041).
 */

export const TASK_TYPES = ['work', 'client_request'] as const;

export const taskTypeSchema = z.enum(TASK_TYPES).meta({ id: 'TaskType' });

export type TaskType = z.infer<typeof taskTypeSchema>;

// The statuses and revision decisions live in `workflow.ts`: notification snapshots name them.
export {
  REVISION_DECISIONS,
  type RevisionDecision,
  revisionDecisionSchema,
  TASK_STATUSES,
  type TaskStatus,
  taskStatusSchema,
} from './workflow.js';

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

/** `medical`: a return by the medical reviewer (F09 rule 5); never counted, like `internal`. */
export const REVISION_SOURCES = ['internal', 'client', 'medical'] as const;

export const revisionSourceSchema = z.enum(REVISION_SOURCES).meta({ id: 'RevisionSource' });

export type RevisionSource = z.infer<typeof revisionSourceSchema>;

/** The stages of `internal_review` (F09, ADR 0020): `medical` only for healthcare clients. */
export const REVIEW_STAGES = ['internal', 'medical'] as const;

export const reviewStageSchema = z.enum(REVIEW_STAGES).meta({ id: 'ReviewStage' });

export type ReviewStage = z.infer<typeof reviewStageSchema>;

export const REVIEW_OUTCOMES = ['passed', 'returned'] as const;

export const reviewOutcomeSchema = z.enum(REVIEW_OUTCOMES).meta({ id: 'ReviewOutcome' });

export type ReviewOutcome = z.infer<typeof reviewOutcomeSchema>;

/** The text the client reads and approves with the files (F09 rule 7). */
export const CLIENT_TEXT_MAX = 10_000;

/** Limits of what one task holds (spec F06); the API answers `LIMIT_REACHED` past them. */
export const TASK_LIMITS = {
  dependencies: 10,
  checklist: 20,
  links: 30,
  revisionLimit: 20,
  /** Non-archived acceptance criteria (F06B rule C6). */
  criteria: 15,
  /** Files attached to one comment, question or reply (F06B rule B2). */
  attachments: 10,
} as const;

/** F06B: the text of a brief and of a comment, question or reply (rules B2 and C1). */
export const TASK_TEXT_MAX = { brief: 20_000, comment: 4000 } as const;

/** A row of a task's thread: a comment (and a reply) or a question (F06B part B). */
export const TASK_COMMENT_KINDS = ['comment', 'question'] as const;

export const taskCommentKindSchema = z.enum(TASK_COMMENT_KINDS).meta({ id: 'TaskCommentKind' });

export type TaskCommentKind = z.infer<typeof taskCommentKindSchema>;

export const QUESTION_STATUSES = ['open', 'answered'] as const;

export const questionStatusSchema = z.enum(QUESTION_STATUSES).meta({ id: 'QuestionStatus' });

export type QuestionStatus = z.infer<typeof questionStatusSchema>;

/** A row of a task's checklist: an F06 item, or an acceptance criterion (F06B rule C6). */
export const CHECKLIST_ITEM_KINDS = ['checklist', 'criterion'] as const;

export type ChecklistItemKind = (typeof CHECKLIST_ITEM_KINDS)[number];

/** F06B rule B8: work hours a question stays open before its reminder and its escalation. */
export const QUESTION_TIMING_HOURS = { reminder: 24, escalation: 48 } as const;

export const DEFAULT_REVISION_LIMIT = 2;

/** How a parent runs its subtasks (F06B rule A3): one after another, all at once, or by stages. */
export const SUBTASK_RUN_MODES = ['sequential', 'parallel', 'stages'] as const;

export const subtaskRunModeSchema = z.enum(SUBTASK_RUN_MODES).meta({ id: 'SubtaskRunMode' });

export type SubtaskRunMode = z.infer<typeof subtaskRunModeSchema>;

/**
 * Where a dependency comes from: set by hand (F06 rule 3), or written by the system from the
 * parent's run mode and order (`run`, F06B rule A3), never edited by hand.
 */
export const DEPENDENCY_SOURCES = ['manual', 'run'] as const;

export type DependencySource = (typeof DEPENDENCY_SOURCES)[number];

/** Limits of a parent (F06B); the API answers `LIMIT_REACHED` past them. */
export const SUBTASK_LIMITS = {
  /** Non-cancelled subtasks of one parent. */
  subtasks: 30,
  /** Non-archived stages of one parent. */
  stages: 10,
} as const;

/** What a task brings at creation (F06B rule C3 and part B); `LIMIT_REACHED` past them. */
export const CREATE_LIMITS = {
  /** Files of the task and its new subtasks. */
  files: 20,
  questions: 10,
} as const;

/** The estimate a subtask without one counts for when dates are suggested (F06B rule A5). */
export const DEFAULT_ESTIMATE_MINUTES = 120;

/** An over-limit revision without a decision is reminded on this work day after it (spec P2A rule 8). */
export const OVER_LIMIT_REMINDER_WORK_DAYS = 2;

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
  | 'withdraw'
  | 'resume'
  | 'resubmit'
  | 'deliver'
  | 'approve_subtask'
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
    case 'awaiting_client>internal_review':
      return 'withdraw';
    case 'revisions>in_progress':
      return 'resume';
    case 'revisions>internal_review':
      return 'resubmit';
    case 'approved>delivered':
      return 'deliver';
    // F06B rule A7: approving a subtask delivers it to its parent.
    case 'internal_review>delivered':
      return 'approve_subtask';
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

/**
 * The title of the extra work item an over-limit revision becomes (rule 10). Stored in Arabic,
 * the language of the records, and shown as is by the decision dialog.
 */
export const revisionExtraWorkTitle = (revisionNumber: number, taskTitle: string): string =>
  `التعديل ${revisionNumber}: ${taskTitle}`;

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
 * `client` is client scope, `creator` is being the task's creator. `parentReviewer`: the task is a
 * subtask and the caller is its parent's assignee but not its own (F06B rule A7);
 * `parentManager`: the task is a subtask and the caller manages its parent's subtasks (manage
 * scope on the parent, or its assignee), so they may cancel it (F06B, Roles).
 */
export type TaskRights = {
  work: boolean;
  manage: boolean;
  assign: boolean;
  client: boolean;
  creator: boolean;
  parentReviewer: boolean;
  parentManager: boolean;
};

/** The parts of a task the workflow looks at. */
export type TaskState = {
  status: TaskStatus;
  /** The stage of `internal_review`; null in every other status. */
  reviewStage: ReviewStage | null;
  assigneeId: string | null;
  hasClient: boolean;
  needsClientApproval: boolean;
  blocked: boolean;
  /** A subtask: reviewed by its parent's assignee too, delivered on approval, never with the client. */
  subtask: boolean;
};

/**
 * Whether the caller may make this move on the task (rules 1, 2, 3, 8, 13; archived excluded).
 * In the medical stage (F09 rule 4) manage scope may only return or cancel: the pass belongs to
 * the medical reviewers, through their own route. A subtask (F06B rule A7) is approved straight
 * to delivered, by manage scope or its parent's assignee, and never goes to the client.
 */
export function canMakeTaskMove(task: TaskState, move: TaskMove, rights: TaskRights): boolean {
  const reviews = rights.manage || (task.subtask && rights.parentReviewer);
  switch (move) {
    case 'start':
      // A blocked task starts only with an override by assign scope (rule 3, actions table).
      return !!task.assigneeId && (task.blocked ? rights.assign : rights.work);
    case 'submit':
    case 'resume':
    case 'resubmit':
      return rights.work;
    case 'return':
      return reviews;
    case 'send_to_client':
      return (
        rights.manage && !task.subtask && task.needsClientApproval && task.reviewStage !== 'medical'
      );
    case 'approve':
      return (
        rights.manage &&
        !task.subtask &&
        !task.needsClientApproval &&
        task.reviewStage !== 'medical'
      );
    case 'approve_subtask':
      return task.subtask && reviews;
    case 'withdraw':
      return rights.manage;
    case 'client_approved':
    case 'client_changes':
    case 'reopen_client':
      return rights.client && task.hasClient && !task.subtask;
    case 'deliver':
      return rights.work || rights.client;
    case 'reopen_internal':
    case 'reopen':
      return rights.manage;
    case 'cancel':
      return (
        rights.manage ||
        (task.subtask && rights.parentManager) ||
        (rights.creator && task.status === 'new' && task.assigneeId === null)
      );
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

// Subtasks (F06B part A)

/** A live subtask as the run sees it; `stagePosition` is its stage's position in `stages` mode. */
export type RunSubtask = { id: string; position: number; stagePosition: number | null };

/**
 * Rule A3: the `run` dependencies the mode and the order imply, as task → the task it waits on.
 * The caller passes the live subtasks only (neither cancelled nor archived), so a sequence skips
 * them; in `stages` mode a stage without live subtasks is skipped too (edge case 5).
 */
export function runDependencies(
  mode: SubtaskRunMode,
  subtasks: readonly RunSubtask[],
): { taskId: string; dependsOnId: string }[] {
  const ordered = [...subtasks].sort((a, b) => a.position - b.position);
  if (mode === 'parallel') return [];
  if (mode === 'sequential') {
    return ordered.slice(1).map((subtask, index) => ({
      taskId: subtask.id,
      dependsOnId: (ordered[index] as RunSubtask).id,
    }));
  }
  const stages = new Map<number, RunSubtask[]>();
  for (const subtask of ordered) {
    const stage = subtask.stagePosition ?? 0;
    stages.set(stage, [...(stages.get(stage) ?? []), subtask]);
  }
  const groups = [...stages.entries()].sort(([a], [b]) => a - b).map(([, group]) => group);
  return groups.slice(1).flatMap((group, index) =>
    group.flatMap((subtask) =>
      (groups[index] as RunSubtask[]).map((before) => ({
        taskId: subtask.id,
        dependsOnId: before.id,
      })),
    ),
  );
}

/**
 * Rule A5: suggested due dates, one per subtask in the order given. The work days from `from` to
 * the parent's due date (Fridays and `holidays` skipped) are shared in proportion to each
 * estimate (`DEFAULT_ESTIMATE_MINUTES` without one): one after another when sequential, one date
 * per stage (by its longest subtask) in stages, and the parent's due date minus one work day when
 * parallel. Without a work day in the range, every date is the parent's.
 */
export function suggestSubtaskDates(input: {
  mode: SubtaskRunMode;
  from: CalendarDate;
  parentDueDate: CalendarDate;
  holidays?: readonly HolidayRange[];
  subtasks: readonly { estimateMinutes: number | null; stageIndex?: number | null }[];
}): CalendarDate[] {
  const days = workDaysBetween(input.from, input.parentDueDate, input.holidays);
  const last = days[days.length - 1];
  if (!last) return input.subtasks.map(() => input.parentDueDate);
  if (input.mode === 'parallel') {
    const before = days.filter((day) => day < input.parentDueDate);
    return input.subtasks.map(() => before[before.length - 1] ?? last);
  }
  const weight = (subtask: { estimateMinutes: number | null }) =>
    subtask.estimateMinutes ?? DEFAULT_ESTIMATE_MINUTES;
  // Sequential: each subtask is a step of its own; stages: a step per stage, by its longest.
  const stepOf = input.subtasks.map((subtask, index) =>
    input.mode === 'stages' ? (subtask.stageIndex ?? 0) : index,
  );
  const steps = [...new Set(stepOf)].sort((a, b) => a - b);
  const weights = steps.map((step) =>
    Math.max(...input.subtasks.filter((_, index) => stepOf[index] === step).map(weight)),
  );
  const total = weights.reduce((sum, value) => sum + value, 0);
  let done = 0;
  const dateOfStep = new Map<number, CalendarDate>();
  steps.forEach((step, index) => {
    done += weights[index] as number;
    const at = Math.min(days.length, Math.max(1, Math.ceil((done / total) * days.length)));
    dateOfStep.set(step, days[at - 1] as CalendarDate);
  });
  return stepOf.map((step) => dateOfStep.get(step) ?? last);
}

/** Rule A9: delivered subtasks against the non-cancelled, non-archived ones. */
export function subtaskProgress(subtasks: readonly { status: TaskStatus; archived: boolean }[]): {
  delivered: number;
  total: number;
} {
  const live = subtasks.filter((s) => !s.archived && s.status !== 'cancelled');
  return {
    delivered: live.filter((s) => s.status === 'delivered').length,
    total: live.length,
  };
}

// Inputs

export const taskTitleSchema = z.string().trim().min(1).max(160);

export const MAX_COMMENT_MENTIONS = 20;

/** F06B rule C1: the brief as rich text, without mentions; `brief` keeps its plain extract. */
export const taskBriefDocSchema = richTextSchema({ maxText: TASK_TEXT_MAX.brief }).meta({
  id: 'TaskBriefDoc',
});

export type TaskBriefDoc = z.infer<typeof taskBriefDocSchema>;

/**
 * F06B rule B2: a comment, question or reply, with mention nodes (F06 rule 16); `body` keeps its
 * plain extract with `@{userId}` tokens. The API checks that mentioned users are active.
 */
export const taskCommentDocSchema = mentionTextSchema({ maxText: TASK_TEXT_MAX.comment })
  .refine((doc) => mentionedUserIds(richTextPlain(doc)).length <= MAX_COMMENT_MENTIONS, {
    message: `At most ${MAX_COMMENT_MENTIONS} people are mentioned in one comment`,
  })
  .meta({ id: 'TaskCommentDoc' });

export type TaskCommentDoc = z.infer<typeof taskCommentDocSchema>;

/**
 * F06B rule C1: the stored brief and its document from an input's `briefDoc` (the plain text
 * written from it) or plain `brief` (a paragraph per line); undefined when neither is given.
 */
export function briefColumns(input: {
  brief?: string | null;
  briefDoc?: TaskBriefDoc | null;
}): { brief: string | null; briefDoc: RichTextDoc | null } | undefined {
  if (input.briefDoc !== undefined) {
    return input.briefDoc
      ? { brief: richTextPlain(input.briefDoc), briefDoc: input.briefDoc }
      : { brief: null, briefDoc: null };
  }
  if (input.brief === undefined) return undefined;
  return input.brief
    ? { brief: input.brief, briefDoc: richTextFromPlain(input.brief) }
    : { brief: null, briefDoc: null };
}

const checklistTextSchema = z.string().trim().min(1).max(200);

const uniqueIds = z.array(z.uuid()).transform((ids) => [...new Set(ids)]);

export const createTaskLinkSchema = z
  .object({ url: httpUrlSchema, label: optionalText(120).optional() })
  .meta({ id: 'CreateTaskLink' });

export type CreateTaskLink = z.infer<typeof createTaskLinkSchema>;

/** Held uploads (F10 rule 1) attached to a comment, a question or a reply (F06B rule B2). */
const commentFilesSchema = z
  .array(z.object({ uploadId: z.uuid() }))
  .max(TASK_LIMITS.attachments)
  .refine((files) => new Set(files.map((file) => file.uploadId)).size === files.length, {
    message: 'An upload is listed once',
  })
  .default([]);

/** Rule B1: a question to one person or one department. */
export const taskQuestionInputSchema = z
  .object({
    bodyDoc: taskCommentDocSchema,
    addressedUserId: z.uuid().optional(),
    addressedDepartment: departmentCodeSchema.optional(),
    files: commentFilesSchema,
  })
  .refine((input) => !input.addressedUserId !== !input.addressedDepartment, {
    message: 'A question is addressed to one person or one department',
    path: ['addressedUserId'],
  })
  .meta({ id: 'TaskQuestionInput' });

export type TaskQuestionInput = z.infer<typeof taskQuestionInputSchema>;

export type TaskQuestionInputValue = z.input<typeof taskQuestionInputSchema>;

const stageNameSchema = z.string().trim().min(1).max(80);

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
  /** F06B rule C7: the department's brief fields; checked against the department's kind. */
  briefFields: taskBriefFieldsSchema.nullable(),
  /** F06B rule C8: the estimate in minutes, a multiple of 30. */
  estimateMinutes: estimateMinutesSchema.nullable(),
});

/** Rule C7 on an input: the brief fields belong to the department's kind. */
function checkBriefFields(
  input: { department: DepartmentCode; briefFields?: TaskBriefFields | null },
  ctx: z.RefinementCtx,
  path: (string | number)[] = [],
): void {
  const result = departmentBriefFields(input.department, input.briefFields);
  if ('problem' in result)
    ctx.addIssue({
      code: 'custom',
      path: [...path, 'briefFields', result.problem],
      message: 'Not a brief field of this department',
    });
}

/** F06B rule C3: the roles a file takes at creation. */
export const CREATE_FILE_ROLES = ['reference', 'deliverable'] as const;

/**
 * F06B rule C3: a held upload (F10 rule 1) attached when the task is saved, as a reference (a
 * moodboard) or as the first version of a deliverable.
 */
export const createTaskFileSchema = z
  .object({
    uploadId: z.uuid(),
    role: z.enum(CREATE_FILE_ROLES).default('reference'),
    /** The item's name; the upload's file name when left out. */
    name: fileItemNameSchema.optional(),
  })
  .meta({ id: 'CreateTaskFile' });

export type CreateTaskFile = z.infer<typeof createTaskFileSchema>;

const criteriaInputSchema = z.array(checklistTextSchema).max(TASK_LIMITS.criteria).default([]);

/**
 * F06B rule C2: a subtask created with its parent. It takes the parent's client and engagement;
 * `stageIndex` points into the parent's `stages` while it runs by stages, null otherwise.
 */
export const createTaskSubtaskSchema = z
  .object({
    title: taskTitleSchema,
    brief: optionalText(5000).optional(),
    briefDoc: taskBriefDocSchema.nullable().optional(),
    briefFields: taskBriefFieldsSchema.nullable().default(null),
    department: departmentCodeSchema,
    /** Null leaves it in the department's queue. */
    assigneeId: z.uuid().nullable().default(null),
    dueDate: calendarDateSchema,
    dueTime: timeOfDaySchema.nullable().optional(),
    priority: taskPrioritySchema.default('normal'),
    estimateMinutes: estimateMinutesSchema.nullable().default(null),
    stageIndex: z
      .number()
      .int()
      .min(0)
      .max(SUBTASK_LIMITS.stages - 1)
      .nullable()
      .default(null),
    checklist: z.array(checklistTextSchema).max(TASK_LIMITS.checklist).default([]),
    criteria: criteriaInputSchema,
    files: z.array(createTaskFileSchema).default([]),
  })
  .meta({ id: 'CreateTaskSubtask' });

export type CreateTaskSubtask = z.infer<typeof createTaskSubtaskSchema>;

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
    /** F06B rule C1: the brief as rich text; when set, `brief` is written from it. */
    briefDoc: taskBriefDocSchema.nullable().optional(),
    briefFields: taskBriefFieldsSchema.nullable().default(null),
    estimateMinutes: estimateMinutesSchema.nullable().default(null),
    /** F06B rule C6: acceptance criteria, ticked before review. */
    criteria: criteriaInputSchema,
    /** F06B rule A3: required with subtasks (sequential when left out), dropped without. */
    runMode: subtaskRunModeSchema.optional(),
    /** F06B: the stages, in order, while the task runs by stages. */
    stages: z
      .array(z.object({ name: stageNameSchema }))
      .max(SUBTASK_LIMITS.stages)
      .default([]),
    subtasks: z.array(createTaskSubtaskSchema).max(SUBTASK_LIMITS.subtasks).default([]),
    /** F06B rule C3: files of the task itself; a subtask's files go in its `files`. */
    files: z.array(createTaskFileSchema).default([]),
    /** F06B rule B1: questions asked with the task. */
    questions: z.array(taskQuestionInputSchema).max(CREATE_LIMITS.questions).default([]),
    /** F06B rule D2: the task template the draft came from; the run is recorded with the tasks. */
    templateId: z.uuid().optional(),
  })
  .partial({ brief: true, dueTime: true, requestedByContactId: true, requestedOn: true })
  .extend({
    requestScope: requestScopeSchema.optional(),
    /** F17 rule B17: assign despite the assignee's leave on the due date (audited). */
    acceptLeave: z.boolean().optional(),
  })
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
    checkBriefFields(task, ctx);
    const byStages = task.runMode === 'stages' && task.subtasks.length > 0;
    if (task.stages.length > 0 && !byStages)
      ctx.addIssue({
        code: 'custom',
        path: ['stages'],
        message: 'Stages go with subtasks run by stages',
      });
    task.subtasks.forEach((subtask, index) => {
      checkBriefFields(subtask, ctx, ['subtasks', index]);
      const stage = subtask.stageIndex;
      if (byStages ? stage === null || stage >= task.stages.length : stage !== null)
        ctx.addIssue({
          code: 'custom',
          path: ['subtasks', index, 'stageIndex'],
          message: byStages ? 'Choose a stage of the task' : 'Stages apply only by stages',
        });
    });
    const files = [...task.files, ...task.subtasks.flatMap((subtask) => subtask.files)];
    if (files.length > CREATE_LIMITS.files)
      ctx.addIssue({
        code: 'custom',
        path: ['files'],
        message: `At most ${CREATE_LIMITS.files} files at creation`,
      });
    const uploads = [
      ...files.map((file) => file.uploadId),
      ...task.questions.flatMap((question) => question.files.map((file) => file.uploadId)),
    ];
    if (new Set(uploads).size !== uploads.length)
      ctx.addIssue({ code: 'custom', path: ['files'], message: 'An upload is listed once' });
  })
  .transform((task) => ({
    ...task,
    needsClientApproval: task.clientId ? (task.needsClientApproval ?? true) : false,
    requestScope:
      task.type === 'client_request' ? (task.requestScope ?? ('in_scope' as const)) : undefined,
    runMode: task.subtasks.length > 0 ? (task.runMode ?? ('sequential' as const)) : undefined,
  }))
  .meta({ id: 'CreateTask' });

export type CreateTask = z.infer<typeof createTaskSchema>;

export type CreateTaskInput = z.input<typeof createTaskSchema>;

/**
 * Any subset of the create fields except the type (fixed at creation, rule 11); dependencies,
 * checklist and links have their own endpoints. `assigneeId` and `department` need assign scope,
 * `requestScope` client scope. The API checks the links against the stored ones. `acceptLeave`
 * (F17 rule B17) keeps an assignee or a due date that falls on the assignee's leave.
 * `moveSubtasks` (F06B rule A5) brings the subtasks due after a parent's new due date to it.
 * `briefDoc` (rule C1) replaces `brief` with its plain extract; null clears both.
 */
export const updateTaskSchema = taskFieldsSchema
  .partial()
  .extend({
    acceptLeave: z.boolean().optional(),
    moveSubtasks: z.boolean().optional(),
    /** F06B rule C1: the brief as rich text; when set, `brief` is written from it. */
    briefDoc: taskBriefDocSchema.nullable().optional(),
  })
  .meta({ id: 'UpdateTask' });

export type UpdateTask = z.infer<typeof updateTaskSchema>;

export type UpdateTaskInput = z.input<typeof updateTaskSchema>;

/**
 * F06B rule A2: a subtask added to an open parent. It takes the parent's client and engagement;
 * `stageId` is required while the parent runs by stages, and `position` (1 = first) puts it among
 * the others, last when left out. An assignee needs assign scope for the department, or is the
 * caller in their own department; without one it waits in the department's queue.
 */
export const createSubtaskSchema = taskFieldsSchema
  .pick({ title: true, department: true, priority: true, dueDate: true })
  .extend({
    brief: optionalText(5000).optional(),
    assigneeId: z.uuid().nullable().default(null),
    priority: taskPrioritySchema.default('normal'),
    dueTime: timeOfDaySchema.nullable().optional(),
    checklist: z.array(checklistTextSchema).default([]),
    position: z.number().int().min(1).optional(),
    stageId: z.uuid().nullable().optional(),
    acceptLeave: z.boolean().optional(),
    briefDoc: taskBriefDocSchema.nullable().optional(),
    briefFields: taskBriefFieldsSchema.nullable().default(null),
    estimateMinutes: estimateMinutesSchema.nullable().default(null),
    criteria: criteriaInputSchema,
    files: z.array(createTaskFileSchema).max(CREATE_LIMITS.files).default([]),
    /**
     * F06B rule B11: a question or comment of the parent or of one of its subtasks, turned into
     * this subtask; its attachments are copied as references.
     */
    fromCommentId: z.uuid().optional(),
  })
  .superRefine((subtask, ctx) => checkBriefFields(subtask, ctx))
  .meta({ id: 'CreateSubtask' });

export type CreateSubtask = z.infer<typeof createSubtaskSchema>;

export type CreateSubtaskInput = z.input<typeof createSubtaskSchema>;

/**
 * Rule A4: every non-archived subtask once, in the new order, each with its stage (null unless
 * the parent runs by stages); `INVALID_ORDER` otherwise.
 */
export const subtaskOrderSchema = z
  .object({
    items: z
      .array(z.object({ id: z.uuid(), stageId: z.uuid().nullable() }))
      .max(SUBTASK_LIMITS.subtasks * 2),
  })
  .meta({ id: 'SubtaskOrder' });

export type SubtaskOrder = z.infer<typeof subtaskOrderSchema>;

export const subtaskRunModeInputSchema = z
  .object({ runMode: subtaskRunModeSchema })
  .meta({ id: 'SubtaskRunModeInput' });

export type SubtaskRunModeInput = z.infer<typeof subtaskRunModeInputSchema>;

/** A stage of a parent; `position` (1 = first) puts it among the others, last when left out. */
export const createTaskStageSchema = z
  .object({ name: stageNameSchema, position: z.number().int().min(1).optional() })
  .meta({ id: 'CreateTaskStage' });

export type CreateTaskStage = z.infer<typeof createTaskStageSchema>;

export const updateTaskStageSchema = z
  .object({ name: stageNameSchema.optional(), position: z.number().int().min(1).optional() })
  .meta({ id: 'UpdateTaskStage' });

export type UpdateTaskStage = z.infer<typeof updateTaskStageSchema>;

/** Rule A10: delivered subtasks reopened while the parent is in revisions, each with a note. */
export const reopenSubtasksSchema = z
  .object({
    items: z
      .array(z.object({ id: z.uuid(), note: z.string().trim().min(1).max(2000) }))
      .min(1)
      .max(SUBTASK_LIMITS.subtasks)
      .refine((items) => new Set(items.map((item) => item.id)).size === items.length, {
        message: 'A subtask is listed once',
      }),
  })
  .meta({ id: 'ReopenSubtasks' });

export type ReopenSubtasks = z.infer<typeof reopenSubtasksSchema>;

/** Rule A12: the note a subtask hands over to the next ones; blank clears it. */
export const handoverNoteInputSchema = z
  .object({ note: optionalText(2000) })
  .meta({ id: 'HandoverNoteInput' });

export type HandoverNoteInput = z.infer<typeof handoverNoteInputSchema>;

/**
 * A move to `status`. `note` is required by the moves of `taskMoveNeedsNote` (what must change,
 * or the reason); `revisionSource` may confirm a reopen from delivered (`client` → revisions,
 * `internal` → in progress); `contactId` names who answered for the client and is required when
 * recording a client response (F09 rule 16); `contentToken` is the one the reviewer was shown and
 * is required by an internal pass (F09 rule 1).
 */
export const taskStatusChangeSchema = z
  .object({
    status: taskStatusSchema,
    note: optionalText(2000).optional(),
    revisionSource: revisionSourceSchema.optional(),
    contactId: z.uuid().nullable().optional(),
    contentToken: z.string().max(64).optional(),
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

export const MEDICAL_DECISIONS = ['approve', 'return'] as const;

/** The medical reviewer's answer on a task in the medical stage (F09 rules 4 and 5). */
export const medicalReviewSchema = z
  .object({
    decision: z.enum(MEDICAL_DECISIONS),
    note: optionalText(2000).optional(),
  })
  .refine((review) => review.decision !== 'return' || !!review.note, {
    message: 'A return needs a note',
    path: ['note'],
  })
  .meta({ id: 'MedicalReview' });

export type MedicalReview = z.infer<typeof medicalReviewSchema>;

export type MedicalReviewInput = z.input<typeof medicalReviewSchema>;

/** Plain text with line breaks; blank clears it. */
export const taskClientTextInputSchema = z
  .object({ clientText: optionalText(CLIENT_TEXT_MAX) })
  .meta({ id: 'TaskClientTextInput' });

export type TaskClientTextInput = z.infer<typeof taskClientTextInputSchema>;

/**
 * F09 rule 1: a token of what a review looks at, the latest version of each deliverable and the
 * text for the client. It only tells whether the content changed, so a plain 64-bit FNV-1a hash
 * is enough.
 */
export function reviewContentToken(
  versionIds: readonly string[],
  clientText: string | null,
): string {
  const content = JSON.stringify([[...versionIds].sort(), clientText ?? '']);
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < content.length; index++) {
    hash ^= BigInt(content.charCodeAt(index));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

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

const namedSchema = z.object({ id: z.uuid(), name: z.string() });

const archivablePersonSchema = personSchema.extend({ archived: z.boolean() });
const archivableContactSchema = namedSchema.extend({ archived: z.boolean() });

export const taskSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    type: taskTypeSchema,
    department: departmentCodeSchema,
    /** `inDepartment` is false after the assignee left the department (edge case 4). */
    assignee: archivablePersonSchema.extend({ inDepartment: z.boolean() }).nullable(),
    status: taskStatusSchema,
    /** The stage of `internal_review` (F09); null in every other status. */
    reviewStage: reviewStageSchema.nullable(),
    priority: taskPrioritySchema,
    dueDate: calendarDateSchema,
    dueTime: timeOfDaySchema.nullable(),
    overdue: z.boolean(),
    blocked: z.boolean(),
    client: clientRefSchema.nullable(),
    project: engagementRefSchema.nullable(),
    milestone: namedSchema.nullable(),
    retainer: engagementRefSchema.nullable(),
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
    /** The post this task produces media for (F08): the client approves the post, not the task. */
    postId: z.uuid().nullable(),
    /** The parent of a subtask (F06B rule A13); null on a top-level task. */
    parent: z.object({ id: z.uuid(), title: z.string() }).nullable(),
    /** A parent's delivered subtasks against its live ones (rule A9); null without subtasks. */
    progress: z
      .object({ delivered: z.number().int().min(0), total: z.number().int().min(0) })
      .nullable(),
    /**
     * Open questions of the task and, on a parent, of its subtasks (F06B rule B7, edge case 13);
     * `inSubtasks` is the subtasks' share of `total`.
     */
    openQuestions: z.object({
      total: z.number().int().min(0),
      inSubtasks: z.number().int().min(0),
    }),
    /** F06B rule C8: the estimate in minutes; null without one. */
    estimateMinutes: z.number().int().nullable(),
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
    /** `run`: written from the parent's run mode and order (F06B), never edited by hand. */
    source: z.enum(DEPENDENCY_SOURCES),
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
    contact: archivableContactSchema.nullable(),
    overLimit: z.boolean(),
    decision: revisionDecisionSchema.nullable(),
    decisionNote: z.string().nullable(),
    extraWork: z.object({ id: z.uuid(), title: z.string() }).nullable(),
    decidedBy: personSchema.nullable(),
    decidedAt: z.iso.datetime().nullable(),
    /** Null for changes the client asked for through an approval link (F09). */
    author: personSchema.nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'TaskRevision' });

export type TaskRevision = z.infer<typeof taskRevisionSchema>;

/** A file version of a review snapshot, with its file's current name. */
export const reviewVersionSchema = z
  .object({
    id: z.uuid(),
    fileItemId: z.uuid(),
    name: z.string(),
    number: z.number().int().min(1),
  })
  .meta({ id: 'ReviewVersion' });

export type ReviewVersion = z.infer<typeof reviewVersionSchema>;

/** A pass or a return of a review; a pass carries the snapshot it approved (F09 rule 2). */
export const taskReviewSchema = z
  .object({
    id: z.uuid(),
    stage: reviewStageSchema,
    outcome: reviewOutcomeSchema,
    note: z.string().nullable(),
    /** Null for the system pass when a client stops being healthcare (F09 rule 18). */
    reviewer: personSchema.nullable(),
    /** Passes only: one version per deliverable. */
    versions: z.array(reviewVersionSchema),
    /** Passes only: the text for the client as it was approved. */
    clientText: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'TaskReview' });

export type TaskReview = z.infer<typeof taskReviewSchema>;

/** The client's answer on a snapshot, from an approval link or recorded by hand. */
export const taskClientResponseSchema = z
  .object({
    id: z.uuid(),
    decision: clientDecisionSchema,
    channel: responseChannelSchema,
    contact: archivableContactSchema,
    note: z.string().nullable(),
    /** The versions answered: the snapshot's. */
    versions: z.array(reviewVersionSchema),
    /** Manual responses only. */
    recordedBy: personSchema.nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'TaskClientResponse' });

export type TaskClientResponse = z.infer<typeof taskClientResponseSchema>;

/** The approval request holding the pending item of a task or a post (F09 rule 8). */
export const pendingApprovalSchema = z.object({
  requestId: z.uuid(),
  state: approvalRequestStateSchema,
  issuedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});

/** A final deliverable of a subtask, as a handover lists it (F06B rule A12). */
const handoverFileSchema = z.object({ fileItemId: z.uuid(), name: z.string() });

/** One delivered subtask in a handover: who did it, their note and their finals. */
export const handoverEntrySchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    assignee: personSchema.nullable(),
    note: z.string().nullable(),
    finals: z.array(handoverFileSchema),
  })
  .meta({ id: 'HandoverEntry' });

export type HandoverEntry = z.infer<typeof handoverEntrySchema>;

/** A stage of a parent; `handover` lists its delivered subtasks once it is finished (rule A12). */
export const taskStageSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    position: z.number().int().min(1),
    /** Every non-cancelled subtask of it is delivered, and it has at least one. */
    finished: z.boolean(),
    handover: z.array(handoverEntrySchema).nullable(),
  })
  .meta({ id: 'TaskStage' });

export type TaskStage = z.infer<typeof taskStageSchema>;

/** A subtask in its parent's Subtasks section. */
export const subtaskSchema = taskSchema
  .extend({
    position: z.number().int().min(1),
    stageId: z.uuid().nullable(),
    /** The unfinished tasks it waits on now, run and manual (rule A3). */
    waitingOn: z.array(z.object({ id: z.uuid(), title: z.string() })),
    handoverNote: z.string().nullable(),
  })
  .meta({ id: 'Subtask' });

export type Subtask = z.infer<typeof subtaskSchema>;

/** A parent's run mode, its non-archived stages and subtasks, each by position. */
export const taskSubtasksSchema = z
  .object({
    runMode: subtaskRunModeSchema.nullable(),
    stages: z.array(taskStageSchema),
    subtasks: z.array(subtaskSchema),
  })
  .meta({ id: 'TaskSubtasks' });

export type TaskSubtasks = z.infer<typeof taskSubtasksSchema>;

export const taskPermissionsSchema = z
  .object({
    canEdit: z.boolean(),
    canAssign: z.boolean(),
    canWork: z.boolean(),
    canReview: z.boolean(),
    canRecordClientResponse: z.boolean(),
    canDecideRevision: z.boolean(),
    /** A medical reviewer other than the assignee, on a task in the medical stage. */
    canMedicalReview: z.boolean(),
    canWithdrawFromClient: z.boolean(),
    canEditClientText: z.boolean(),
    /** Client scope on a task ready to send (F09 rule 8). */
    canSendForApproval: z.boolean(),
    canCancel: z.boolean(),
    canReopen: z.boolean(),
    canArchive: z.boolean(),
    /** Add, reorder and cancel subtasks, edit stages, change the run mode (F06B, Roles). */
    canManageSubtasks: z.boolean(),
    /** "Reopen subtasks" while the parent is in revisions (rule A10). */
    canReopenSubtasks: z.boolean(),
    /** Write the subtask's handover note (rule A12). */
    canWriteHandover: z.boolean(),
    /** Add, edit, order and archive acceptance criteria (rule C6). */
    canEditCriteria: z.boolean(),
    /** Tick and untick acceptance criteria: the assignee, department managers, manage scope. */
    canTickCriteria: z.boolean(),
    /** "Save as template": assign scope on a top-level task (F06B rule D1). */
    canSaveTemplate: z.boolean(),
  })
  .meta({ id: 'TaskPermissions', description: 'What the caller may do, for the UI' });

export type TaskPermissions = z.infer<typeof taskPermissionsSchema>;

export const taskDetailSchema = taskSchema
  .extend({
    brief: z.string().nullable(),
    /** The brief as rich text (F06B rule C1); null without a brief. */
    briefDoc: taskBriefDocSchema.nullable(),
    /** The department's brief fields (F06B rule C7); null when none is filled. */
    briefFields: taskBriefFieldsSchema.nullable(),
    needsClientApproval: z.boolean(),
    clientRequest: z
      .object({
        contact: archivableContactSchema.nullable(),
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
    /** Non-archived acceptance criteria, by position (F06B rule C6). */
    criteria: z.array(taskChecklistItemSchema),
    /** Non-archived links, oldest first. */
    links: z.array(taskLinkSchema),
    /** Non-archived file items of the task (F10). */
    fileCounts: z.object({
      deliverables: z.number().int().min(0),
      references: z.number().int().min(0),
    }),
    /** Oldest first. */
    revisionHistory: z.array(taskRevisionSchema),
    /** What the client reads and approves with the files (F09 rule 7). */
    clientText: z.string().nullable(),
    /** Of the latest version of each deliverable and the text for the client (F09 rule 1). */
    contentToken: z.string(),
    /** The pass that put the task in `awaiting_client` or `approved`: what was sent. */
    clearedReview: taskReviewSchema.nullable(),
    /** Oldest first. */
    reviewHistory: z.array(taskReviewSchema),
    /** Oldest first. */
    clientResponses: z.array(taskClientResponseSchema),
    /** The approval request holding the task's pending item. */
    pendingApproval: pendingApprovalSchema.nullable(),
    /** The parent of a subtask, with its status (F06B). */
    parent: z.object({ id: z.uuid(), title: z.string(), status: taskStatusSchema }).nullable(),
    /** A parent's run mode, stages and subtasks; empty on a subtask (F06B part A). */
    runMode: subtaskRunModeSchema.nullable(),
    stages: z.array(taskStageSchema),
    subtasks: z.array(subtaskSchema),
    /** A subtask's note to the next ones (rule A12); null on a top-level task. */
    handoverNote: z.string().nullable(),
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

/**
 * F06B rule D2: a task template turned into the wizard's draft, as a create payload: dates from
 * the start date in work days, default assignees only where the caller may assign.
 */
const draftItemSchema = z.object({
  title: z.string(),
  brief: z.string().nullable(),
  briefDoc: taskBriefDocSchema.nullable(),
  briefFields: taskBriefFieldsSchema.nullable(),
  department: departmentCodeSchema,
  /** A default assignee the caller may set and still a member; null for the queue. */
  assigneeId: z.uuid().nullable(),
  dueDate: calendarDateSchema,
  priority: taskPrioritySchema,
  estimateMinutes: z.number().int().nullable(),
  checklist: z.array(z.string()),
  criteria: z.array(z.string()),
});

export const taskTemplateDraftSchema = draftItemSchema
  .extend({
    templateId: z.uuid(),
    needsClientApproval: z.boolean(),
    revisionLimit: z.number().int().min(0),
    runMode: subtaskRunModeSchema.nullable(),
    stages: z.array(z.object({ name: z.string() })),
    subtasks: z.array(draftItemSchema.extend({ stageIndex: z.number().int().min(0).nullable() })),
  })
  .meta({ id: 'TaskTemplateDraft' });

export type TaskTemplateDraft = z.infer<typeof taskTemplateDraftSchema>;

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
  /** `true`: tasks linked to a post (F08); `false`: the others. */
  linkedToPost: queryBooleanSchema.optional(),
  dueFrom: calendarDateSchema.optional(),
  dueTo: calendarDateSchema.optional(),
  createdBy: z.literal('me').optional(),
  /** `me`: tasks the caller may review (manage scope), for My tasks' "to review". */
  reviewer: z.literal('me').optional(),
  /** Tasks in this stage of internal review (F09). */
  reviewStage: reviewStageSchema.optional(),
  /** `true` lists archived tasks only; needs `tasks.manage` with scope all. */
  archived: queryBooleanSchema.default(false),
  /** The subtasks of one parent (F06B rule A13). */
  parentId: z.uuid().optional(),
  /** `true` hides subtasks ("Hide subtasks"). */
  topLevel: queryBooleanSchema.optional(),
  /** `true`: tasks with an open question, their own or a subtask's (F06B rule B7). */
  hasOpenQuestions: queryBooleanSchema.optional(),
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

// Comments and questions

/**
 * A comment as a notification shows it (F14): mentions as `@name`, whitespace collapsed, cut to
 * `NOTIFICATION_EXCERPT_MAX` characters with an ellipsis.
 */
export function commentExcerpt(body: string, nameOf: (userId: string) => string): string {
  const text = replaceMentions(body, (id) => `@${nameOf(id)}`)
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > NOTIFICATION_EXCERPT_MAX
    ? `${text.slice(0, NOTIFICATION_EXCERPT_MAX - 1)}…`
    : text;
}

/** A comment, or a reply to the question `questionId` (F06B rule B3). */
export const taskCommentInputSchema = z
  .object({
    bodyDoc: taskCommentDocSchema,
    questionId: z.uuid().optional(),
    files: commentFilesSchema,
  })
  .meta({ id: 'TaskCommentInput' });

export type TaskCommentInput = z.infer<typeof taskCommentInputSchema>;

export type TaskCommentInputValue = z.input<typeof taskCommentInputSchema>;

/** The author edits the text only; a question's addressee changes by forwarding (rule B13). */
export const taskCommentUpdateSchema = z
  .object({ bodyDoc: taskCommentDocSchema })
  .meta({ id: 'TaskCommentUpdate' });

export type TaskCommentUpdate = z.infer<typeof taskCommentUpdateSchema>;

/** Rule B5: a department question forwarded to one of its members. */
export const forwardQuestionSchema = z.object({ userId: z.uuid() }).meta({ id: 'ForwardQuestion' });

export type ForwardQuestion = z.infer<typeof forwardQuestionSchema>;

export const taskCommentListQuerySchema = pageQuerySchema.extend({
  /** `question`: the questions only ("Open questions" filter). */
  kind: taskCommentKindSchema.optional(),
  /** Questions in this state only. */
  status: questionStatusSchema.optional(),
});

export type TaskCommentListQuery = z.infer<typeof taskCommentListQuerySchema>;

export type TaskCommentListQueryInput = z.input<typeof taskCommentListQuerySchema>;

/** A file attached to a comment, a question or a reply (F06B rule B2), at its only version. */
export const taskAttachmentSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    versionId: z.uuid(),
    mimeType: z.string(),
    sizeBytes: z.number().int().min(1),
    /** Images have a thumbnail once their preview is ready (F10). */
    previewReady: z.boolean(),
  })
  .meta({ id: 'TaskAttachment' });

export type TaskAttachment = z.infer<typeof taskAttachmentSchema>;

const commentFieldsSchema = z.object({
  id: z.uuid(),
  kind: taskCommentKindSchema,
  author: archivablePersonSchema,
  /** Plain text with `@{userId}` tokens; null once removed (the UI shows "comment removed"). */
  body: z.string().nullable(),
  /** The rich text; null once removed. */
  bodyDoc: taskCommentDocSchema.nullable(),
  /** The users the body mentions, with their current names (edge case 14). */
  mentions: z.array(archivablePersonSchema),
  /** Empty once removed. */
  attachments: z.array(taskAttachmentSchema),
  /** The question a reply answers; null on comments and questions. */
  questionId: z.uuid().nullable(),
  /** The subtask it was turned into (rule B11). */
  convertedTask: z.object({ id: z.uuid(), title: z.string() }).nullable(),
  editedAt: z.iso.datetime().nullable(),
  removed: z.boolean(),
  createdAt: z.iso.datetime(),
  /** The caller wrote it and the task is not read-only. */
  canEdit: z.boolean(),
  /** The caller wrote it or holds `tasks.manage` with scope all, and the task is not read-only. */
  canRemove: z.boolean(),
  /** The caller may turn it into a subtask (rule B11). */
  canConvert: z.boolean(),
});

export const taskReplySchema = commentFieldsSchema.meta({ id: 'TaskReply' });

export type TaskReply = z.infer<typeof taskReplySchema>;

/** A question's state (rules B1–B5). */
export const taskQuestionStateSchema = z
  .object({
    /** The person asked, or the member a department question was forwarded to. */
    addressee: archivablePersonSchema
      .extend({
        /** False when a forwarded member left the department (edge case 15). */
        inDepartment: z.boolean(),
      })
      .nullable(),
    /** Set for a department question; kept when it is forwarded. */
    department: departmentCodeSchema.nullable(),
    status: questionStatusSchema,
    answeredBy: personSchema.nullable(),
    answeredAt: z.iso.datetime().nullable(),
    canAnswer: z.boolean(),
    canReopen: z.boolean(),
    canForward: z.boolean(),
  })
  .meta({ id: 'TaskQuestionState' });

export type TaskQuestionState = z.infer<typeof taskQuestionStateSchema>;

export const taskCommentSchema = commentFieldsSchema
  .extend({
    /** Questions only. */
    question: taskQuestionStateSchema.nullable(),
    /** A question's replies, oldest first; empty on comments. */
    replies: z.array(taskReplySchema),
  })
  .meta({ id: 'TaskComment' });

export type TaskComment = z.infer<typeof taskCommentSchema>;

export const taskCommentPageSchema = pageSchema(taskCommentSchema).meta({
  id: 'TaskCommentPage',
  description: 'Comments and questions, oldest first, each question with its replies',
});

export type TaskCommentPage = z.infer<typeof taskCommentPageSchema>;

export const myQuestionsQuerySchema = pageQuerySchema.extend({
  status: questionStatusSchema.default('open'),
});

export type MyQuestionsQuery = z.infer<typeof myQuestionsQuerySchema>;

export type MyQuestionsQueryInput = z.input<typeof myQuestionsQuerySchema>;

/** Rule B7: a question waiting for the caller's answer, with its task. */
export const myQuestionSchema = taskCommentSchema
  .extend({
    task: z.object({ id: z.uuid(), title: z.string(), status: taskStatusSchema }),
  })
  .meta({ id: 'MyQuestion' });

export type MyQuestion = z.infer<typeof myQuestionSchema>;

export const myQuestionPageSchema = pageSchema(myQuestionSchema).meta({
  id: 'MyQuestionPage',
  description: 'Oldest asked first',
});

export type MyQuestionPage = z.infer<typeof myQuestionPageSchema>;
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
  /** `true` hides subtasks (F06B rule A13). */
  topLevel: queryBooleanSchema.optional(),
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
        /**
         * F06B rule C8: estimated minutes of the person's open tasks due in the week, counting
         * `DEFAULT_ESTIMATE_MINUTES` for each task without an estimate.
         */
        estimatedMinutes: z.number().int().min(0),
        /** Of those tasks, the ones without an estimate. */
        unestimatedCount: z.number().int().min(0),
        /**
         * The work minutes of the person's F17 schedule in the week, after approved leave and
         * holidays; null without an employee file (edge case 21).
         */
        capacityMinutes: z.number().int().min(0).nullable(),
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
    /** In the medical stage and not the caller's own; null without `approvals.review_medical`. */
    medicalReview: z.number().int().min(0).nullable(),
    /** Ready to send to the client (F09 rule 8) under the caller's client scope; null without it. */
    readyToSend: z.number().int().min(0).nullable(),
    /** Open tasks the caller created for someone else or for a department queue. */
    requestedByMe: z.number().int().min(0),
    /** Open unassigned tasks in the departments the caller manages; null for non-managers. */
    unassignedInMyDepartments: z.number().int().min(0).nullable(),
    /** Open questions waiting for the caller's answer (F06B rule B7). */
    questionsWaiting: z.number().int().min(0),
  })
  .meta({ id: 'MyTaskSummary' });

export type MyTaskSummary = z.infer<typeof myTaskSummarySchema>;

// Readiness (F06B rule C5)

export const READINESS_WARNINGS = [
  'assignee_on_leave',
  'assignee_overloaded',
  'due_on_day_off',
  'brief_missing',
  'no_criteria',
] as const;

export const readinessWarningCodeSchema = z
  .enum(READINESS_WARNINGS)
  .meta({ id: 'ReadinessWarningCode' });

export type ReadinessWarningCode = z.infer<typeof readinessWarningCodeSchema>;

/** One task of a draft as the readiness check reads it. */
const readinessItemSchema = z.object({
  department: departmentCodeSchema,
  assigneeId: z.uuid().nullable().default(null),
  dueDate: calendarDateSchema,
  dueTime: timeOfDaySchema.nullable().optional(),
  estimateMinutes: estimateMinutesSchema.nullable().default(null),
  hasBrief: z.boolean().default(false),
  hasBriefFields: z.boolean().default(false),
  hasReferences: z.boolean().default(false),
  hasCriteria: z.boolean().default(false),
});

/**
 * A draft before it is saved, or an existing task before it is assigned or re-dated (`taskId`
 * leaves its own estimate out of the assignee's week). Subtasks never need client approval.
 */
export const taskReadinessInputSchema = readinessItemSchema
  .extend({
    needsClientApproval: z.boolean().default(false),
    taskId: z.uuid().optional(),
    subtasks: z.array(readinessItemSchema).max(SUBTASK_LIMITS.subtasks).default([]),
  })
  .meta({ id: 'TaskReadinessInput' });

export type TaskReadinessInput = z.infer<typeof taskReadinessInputSchema>;

export type TaskReadinessInputValue = z.input<typeof taskReadinessInputSchema>;

/** A warning never blocks (v2-scope); `subtaskIndex` is null for the task itself. */
export const readinessWarningSchema = z
  .object({
    subtaskIndex: z.number().int().min(0).nullable(),
    code: readinessWarningCodeSchema,
    /** `assignee_on_leave`: the approved leaves covering the due date. */
    leaves: z.array(assigneeLeaveSchema).optional(),
    /** `assignee_overloaded`: the week's estimated minutes with this task, and the capacity. */
    estimatedMinutes: z.number().int().min(0).optional(),
    capacityMinutes: z.number().int().min(0).optional(),
    /** `due_on_day_off`: the next work day. */
    suggestedDate: calendarDateSchema.optional(),
  })
  .meta({ id: 'ReadinessWarning' });

export type ReadinessWarning = z.infer<typeof readinessWarningSchema>;

export const taskReadinessSchema = z
  .object({ warnings: z.array(readinessWarningSchema) })
  .meta({ id: 'TaskReadiness' });

export type TaskReadiness = z.infer<typeof taskReadinessSchema>;

/**
 * Rule C5, the checks that need no database: brief missing (no text, no field, no reference),
 * and no acceptance criteria on a task that needs client approval (shown last).
 */
export function draftWarnings(input: TaskReadinessInput): ReadinessWarning[] {
  const briefMissing = (item: z.infer<typeof readinessItemSchema>) =>
    !item.hasBrief && !item.hasBriefFields && !item.hasReferences;
  const warnings: ReadinessWarning[] = [];
  if (briefMissing(input)) warnings.push({ subtaskIndex: null, code: 'brief_missing' });
  input.subtasks.forEach((subtask, index) => {
    if (briefMissing(subtask)) warnings.push({ subtaskIndex: index, code: 'brief_missing' });
  });
  if (input.needsClientApproval && !input.hasCriteria)
    warnings.push({ subtaskIndex: null, code: 'no_criteria' });
  return warnings;
}

// The tree (F06B rule D4)

export const taskTreeQuerySchema = z
  .object({ projectId: z.uuid().optional(), retainerCycleId: z.uuid().optional() })
  .refine((query) => !query.projectId !== !query.retainerCycleId, {
    message: 'A project or a retainer cycle',
    path: ['projectId'],
  });

export type TaskTreeQuery = z.infer<typeof taskTreeQuerySchema>;

const treeNodeSchema = taskSchema.pick({
  id: true,
  title: true,
  department: true,
  assignee: true,
  status: true,
  dueDate: true,
  dueTime: true,
  overdue: true,
  blocked: true,
  estimateMinutes: true,
});

export const taskTreeNodeSchema = treeNodeSchema
  .extend({
    runMode: subtaskRunModeSchema.nullable(),
    /** Non-archived subtasks, by position. */
    subtasks: z.array(treeNodeSchema),
  })
  .meta({ id: 'TaskTreeNode' });

export type TaskTreeNode = z.infer<typeof taskTreeNodeSchema>;

export const taskTreeSchema = z
  .object({
    /** Milestones by position, then tasks without one (`milestone` null); a cycle has one group. */
    groups: z.array(
      z.object({
        milestone: namedSchema.nullable(),
        tasks: z.array(taskTreeNodeSchema),
      }),
    ),
    /** "Waits for" arrows from the tree's tasks; `dependsOnId` may be outside the tree. */
    edges: z.array(
      z.object({ taskId: z.uuid(), dependsOnId: z.uuid(), source: z.enum(DEPENDENCY_SOURCES) }),
    ),
    /** Tasks outside the tree that tree tasks wait for (edge case 11). */
    outside: z.array(z.object({ id: z.uuid(), title: z.string(), status: taskStatusSchema })),
    bottleneckId: z.uuid().nullable(),
  })
  .meta({ id: 'TaskTree' });

export type TaskTree = z.infer<typeof taskTreeSchema>;

/** A task as the bottleneck search reads it. */
export interface BottleneckNode {
  id: string;
  open: boolean;
  blocked: boolean;
  dueDate: CalendarDate;
  dueTime: TimeOfDay | null;
  overdue: boolean;
}

/**
 * Rule D4: the open, unblocked task on which the most open tasks wait, directly or through
 * others. Ties go to the earliest due date (and time), then the overdue one. Null when nothing
 * waits on an open task.
 */
export function bottleneck(
  nodes: readonly BottleneckNode[],
  edges: readonly { taskId: string; dependsOnId: string }[],
): string | null {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const dependents = new Map<string, string[]>();
  for (const edge of edges) {
    dependents.set(edge.dependsOnId, [...(dependents.get(edge.dependsOnId) ?? []), edge.taskId]);
  }
  const waiting = (id: string): number => {
    const seen = new Set<string>([id]);
    const queue = [id];
    let open = 0;
    while (queue.length > 0) {
      for (const next of dependents.get(queue.shift() as string) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
        if (byId.get(next)?.open) open += 1;
      }
    }
    return open;
  };
  let best: { node: BottleneckNode; count: number } | null = null;
  for (const node of nodes) {
    if (!node.open || node.blocked) continue;
    const count = waiting(node.id);
    if (count === 0) continue;
    if (!best || count > best.count) {
      best = { node, count };
      continue;
    }
    if (count < best.count) continue;
    const due = `${node.dueDate} ${node.dueTime ?? '24:00'}`;
    const bestDue = `${best.node.dueDate} ${best.node.dueTime ?? '24:00'}`;
    if (due < bestDue || (due === bestDue && node.overdue && !best.node.overdue)) {
      best = { node, count };
    }
  }
  return best?.node.id ?? null;
}
