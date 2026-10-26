import type { NotificationResolution, NotificationType } from './notifications.js';
import type { PostStatus } from './post-values.js';
import { isTaskFinished, type ReviewStage, type TaskStatus } from './tasks.js';

/*
 * F16 rule B5 and part C, "Resolves when": what a change of a task or a post closes in "Needs
 * you". The owning module compares the record before and after the change and passes each rule
 * to `NotificationCenter`; events that are not a change of these fields (a mention answered, a
 * revision decided, an approval request sent) close their types where they happen.
 */

/** Types a change closes, with how (`done`: the work was done; `void`: it no longer applies). */
export interface ResolutionRule {
  types: readonly NotificationType[];
  outcome: NotificationResolution;
  /** Only these recipients' rows (the previous holder's on a reassignment); all when left out. */
  recipients?: readonly string[];
}

/** The fields of a task the resolution rules read. */
export interface TaskResolutionState {
  status: TaskStatus;
  reviewStage: ReviewStage | null;
  assigneeId: string | null;
  dueDate: string;
  dueTime: string | null;
  archived: boolean;
}

/** The action types about a task; cancelling or archiving it voids them all. */
export const TASK_ACTION_TYPES = [
  'task_assigned',
  'task_mentioned',
  'task_returned',
  'task_review_requested',
  'task_medical_review_requested',
  'task_awaiting_client',
  'task_over_limit',
  'task_requested',
  'task_due_soon',
  'task_overdue',
  'task_overdue_escalated',
  'task_over_limit_pending',
  'task_due_shortly',
  'subtask_turn',
  'subtask_handover',
  'subtasks_all_finished',
  'subtask_holding_next',
  'task_question_asked',
  'task_question_reminder',
  'task_question_escalated',
] as const satisfies readonly NotificationType[];

/**
 * F06B rule B10: a question's notifications; they close with the question, and the task's
 * delivery voids those still open (its questions stay open, their reminders stop).
 */
export const TASK_QUESTION_TYPES = [
  'task_question_asked',
  'task_question_reminder',
  'task_question_escalated',
] as const satisfies readonly NotificationType[];

/**
 * The reminders of a task's due date: done when it is finished, void when it is re-dated. An
 * overdue subtask holding the next one (F06B rule A14) is one of them.
 */
export const TASK_DUE_TYPES = [
  'task_due_soon',
  'task_overdue',
  'task_overdue_escalated',
  'task_due_shortly',
  'subtask_holding_next',
] as const satisfies readonly NotificationType[];

const inStage = (task: TaskResolutionState, stage: ReviewStage) =>
  task.status === 'internal_review' && (task.reviewStage ?? 'internal') === stage;

const closed = (task: TaskResolutionState) => task.archived || task.status === 'cancelled';

/** The rules of one change of a task, `void` first. */
export function taskResolutions(
  before: TaskResolutionState,
  after: TaskResolutionState,
): ResolutionRule[] {
  if (closed(after) && !closed(before)) return [{ types: TASK_ACTION_TYPES, outcome: 'void' }];
  const voided: NotificationType[] = [];
  const done: NotificationType[] = [];
  // The previous assignee's rows only: the new one's assignment is open work.
  const reassigned: ResolutionRule[] =
    before.assigneeId && before.assigneeId !== after.assigneeId
      ? [
          {
            types: ['task_assigned', 'task_returned'],
            outcome: 'void',
            recipients: [before.assigneeId],
          },
        ]
      : [];
  if (!before.assigneeId && after.assigneeId) done.push('task_requested');
  // F06B rule A6: an opened subtask is done with once it starts.
  if (before.status === 'new' && after.status !== 'new') {
    done.push('task_assigned', 'subtask_turn', 'subtask_handover');
  }
  if (inStage(before, 'internal') && !inStage(after, 'internal')) {
    done.push('task_review_requested');
  }
  // F06B rule A9: the parent went to review after its subtasks.
  if (!inStage(before, 'internal') && inStage(after, 'internal')) {
    done.push('subtasks_all_finished');
  }
  if (inStage(before, 'medical') && !inStage(after, 'medical')) {
    done.push('task_medical_review_requested');
  }
  if (before.status === 'awaiting_client' && after.status !== 'awaiting_client') {
    done.push('task_awaiting_client');
  }
  if (before.status === 'revisions' && after.status !== 'revisions') done.push('task_returned');
  if (before.status !== 'delivered' && after.status === 'delivered') {
    voided.push(...TASK_QUESTION_TYPES);
  }
  if (!isTaskFinished(before.status) && isTaskFinished(after.status)) {
    done.push(...TASK_DUE_TYPES);
  } else if (before.dueDate !== after.dueDate || before.dueTime !== after.dueTime) {
    voided.push(...TASK_DUE_TYPES);
  }
  return [...reassigned, ...rules(voided, done)];
}

/** The fields of a post the resolution rules read. */
export interface PostResolutionState {
  status: PostStatus;
  reviewStage: ReviewStage | null;
  responsibleId: string;
  publishDate: string;
  publishTime: string | null;
  archived: boolean;
}

/** The action types about a post; cancelling or archiving it voids them all. */
export const POST_ACTION_TYPES = [
  'post_returned',
  'post_review_requested',
  'post_medical_review_requested',
  'post_awaiting_client',
  'post_assigned',
  'post_task_unlinked',
  'post_publish_today',
  'post_publish_overdue',
  'post_publish_shortly',
] as const satisfies readonly NotificationType[];

/** The reminders of a post's publish date: done when it is published, void when re-dated. */
export const POST_PUBLISH_TYPES = [
  'post_publish_today',
  'post_publish_overdue',
  'post_publish_shortly',
] as const satisfies readonly NotificationType[];

const postInStage = (post: PostResolutionState, stage: ReviewStage) =>
  post.status === 'internal_review' && (post.reviewStage ?? 'internal') === stage;

const postClosed = (post: PostResolutionState) => post.archived || post.status === 'cancelled';

/** The rules of one change of a post, `void` first. */
export function postResolutions(
  before: PostResolutionState,
  after: PostResolutionState,
): ResolutionRule[] {
  if (postClosed(after) && !postClosed(before)) {
    return [{ types: POST_ACTION_TYPES, outcome: 'void' }];
  }
  const voided: NotificationType[] = [];
  const done: NotificationType[] = [];
  // The previous responsible's rows only: the new one's assignment is open work.
  const reassigned: ResolutionRule[] =
    before.responsibleId !== after.responsibleId
      ? [
          {
            types: ['post_returned', 'post_assigned'],
            outcome: 'void',
            recipients: [before.responsibleId],
          },
        ]
      : [];
  // Submitted, or resubmitted after a return.
  if (before.status !== 'internal_review' && after.status === 'internal_review') {
    done.push('post_assigned', 'post_returned');
  }
  if (postInStage(before, 'internal') && !postInStage(after, 'internal')) {
    done.push('post_review_requested');
  }
  if (postInStage(before, 'medical') && !postInStage(after, 'medical')) {
    done.push('post_medical_review_requested');
  }
  if (before.status === 'awaiting_client' && after.status !== 'awaiting_client') {
    done.push('post_awaiting_client');
  }
  if (before.status !== 'published' && after.status === 'published') {
    done.push(...POST_PUBLISH_TYPES);
  } else if (before.publishDate !== after.publishDate || before.publishTime !== after.publishTime) {
    voided.push(...POST_PUBLISH_TYPES);
  }
  return [...reassigned, ...rules(voided, done)];
}

function rules(voided: NotificationType[], done: NotificationType[]): ResolutionRule[] {
  return [
    ...(voided.length > 0 ? [{ types: voided, outcome: 'void' as const }] : []),
    ...(done.length > 0 ? [{ types: done, outcome: 'done' as const }] : []),
  ];
}
