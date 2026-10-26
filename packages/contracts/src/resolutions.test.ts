import { describe, expect, it } from 'vitest';
import {
  LEAD_REMINDER_KINDS,
  NOTIFICATION_CATALOG,
  NOTIFICATION_TYPES,
  timedReminderWindow,
} from './notifications.js';
import {
  POST_ACTION_TYPES,
  type PostResolutionState,
  postResolutions,
  TASK_ACTION_TYPES,
  type TaskResolutionState,
  taskResolutions,
} from './resolutions.js';

const task: TaskResolutionState = {
  status: 'new',
  reviewStage: null,
  assigneeId: 'a',
  dueDate: '2026-10-20',
  dueTime: null,
  archived: false,
};

const post: PostResolutionState = {
  status: 'in_production',
  reviewStage: null,
  responsibleId: 'r',
  publishDate: '2026-10-20',
  publishTime: null,
  archived: false,
};

describe('task resolutions (F16 rule B5, part C)', () => {
  it('lists every action type about a task, and nothing else', () => {
    const expected = NOTIFICATION_TYPES.filter(
      (type) =>
        NOTIFICATION_CATALOG[type].subject === 'task' &&
        NOTIFICATION_CATALOG[type].box === 'action' &&
        !type.startsWith('action_'),
    );
    expect([...TASK_ACTION_TYPES].sort()).toEqual(expected.sort());
  });

  it('voids everything when the task is cancelled or archived', () => {
    for (const after of [
      { ...task, status: 'cancelled' as const },
      { ...task, archived: true },
    ]) {
      expect(taskResolutions(task, after)).toEqual([{ types: TASK_ACTION_TYPES, outcome: 'void' }]);
    }
  });

  it('closes the assignment when work starts, and voids it when reassigned', () => {
    expect(taskResolutions(task, { ...task, status: 'in_progress' })).toEqual([
      { types: ['task_assigned', 'subtask_turn', 'subtask_handover'], outcome: 'done' },
    ]);
    expect(taskResolutions(task, { ...task, assigneeId: 'b' })).toEqual([
      { types: ['task_assigned', 'task_returned'], outcome: 'void', recipients: ['a'] },
    ]);
  });

  it('closes a request when the task is assigned', () => {
    expect(taskResolutions({ ...task, assigneeId: null }, task)).toEqual([
      { types: ['task_requested'], outcome: 'done' },
    ]);
  });

  it('closes the review stages and the client wait when the task leaves them', () => {
    const internal = {
      ...task,
      status: 'internal_review' as const,
      reviewStage: 'internal' as const,
    };
    const medical = { ...internal, reviewStage: 'medical' as const };
    expect(taskResolutions({ ...task, status: 'in_progress' }, internal)).toEqual([
      { types: ['subtasks_all_finished'], outcome: 'done' },
    ]);
    expect(taskResolutions(internal, medical)).toEqual([
      { types: ['task_review_requested'], outcome: 'done' },
    ]);
    expect(taskResolutions(medical, { ...task, status: 'awaiting_client' })).toEqual([
      { types: ['task_medical_review_requested'], outcome: 'done' },
    ]);
    expect(
      taskResolutions({ ...task, status: 'awaiting_client' }, { ...task, status: 'revisions' }),
    ).toEqual([{ types: ['task_awaiting_client'], outcome: 'done' }]);
  });

  it('closes a return when the task is resubmitted', () => {
    const revisions = { ...task, status: 'revisions' as const };
    expect(taskResolutions(revisions, { ...task, status: 'internal_review' })).toEqual([
      { types: ['subtasks_all_finished', 'task_returned'], outcome: 'done' },
    ]);
  });

  it('closes the due reminders when finished and voids them when re-dated', () => {
    const working = { ...task, status: 'in_progress' as const };
    expect(taskResolutions(working, { ...working, status: 'approved' })).toEqual([
      {
        types: [
          'task_due_soon',
          'task_overdue',
          'task_overdue_escalated',
          'task_due_shortly',
          'subtask_holding_next',
        ],
        outcome: 'done',
      },
    ]);
    expect(taskResolutions(working, { ...working, dueTime: '10:00' })).toEqual([
      {
        types: [
          'task_due_soon',
          'task_overdue',
          'task_overdue_escalated',
          'task_due_shortly',
          'subtask_holding_next',
        ],
        outcome: 'void',
      },
    ]);
  });

  it('voids the notifications of open questions when the task is delivered (F06B rule B10)', () => {
    const approved = { ...task, status: 'approved' as const };
    expect(taskResolutions(approved, { ...approved, status: 'delivered' })).toEqual([
      {
        types: ['task_question_asked', 'task_question_reminder', 'task_question_escalated'],
        outcome: 'void',
      },
    ]);
  });

  it('closes nothing when nothing it watches changed', () => {
    expect(taskResolutions(task, task)).toEqual([]);
    const cancelled = { ...task, status: 'cancelled' as const };
    expect(taskResolutions(cancelled, { ...cancelled, archived: true })).toEqual([]);
  });
});

describe('post resolutions (F16 rule B5, part C)', () => {
  it('lists every action type about a post', () => {
    const expected = NOTIFICATION_TYPES.filter(
      (type) =>
        NOTIFICATION_CATALOG[type].subject === 'post' &&
        NOTIFICATION_CATALOG[type].box === 'action',
    );
    expect([...POST_ACTION_TYPES].sort()).toEqual(expected.sort());
  });

  it('voids everything when the post is cancelled or archived', () => {
    expect(postResolutions(post, { ...post, status: 'cancelled' })).toEqual([
      { types: POST_ACTION_TYPES, outcome: 'void' },
    ]);
  });

  it('closes the assignment and a return when the post is submitted for review', () => {
    expect(postResolutions(post, { ...post, status: 'internal_review' })).toEqual([
      { types: ['post_assigned', 'post_returned'], outcome: 'done' },
    ]);
  });

  it('voids the assignment and a return when the responsible changes', () => {
    expect(postResolutions(post, { ...post, responsibleId: 's' })).toEqual([
      { types: ['post_returned', 'post_assigned'], outcome: 'void', recipients: ['r'] },
    ]);
  });

  it('closes the review when the post leaves it, and the client wait', () => {
    const review = { ...post, status: 'internal_review' as const };
    expect(postResolutions(review, { ...post, status: 'awaiting_client' })).toEqual([
      { types: ['post_review_requested'], outcome: 'done' },
    ]);
    expect(
      postResolutions({ ...post, status: 'awaiting_client' }, { ...post, status: 'approved' }),
    ).toEqual([{ types: ['post_awaiting_client'], outcome: 'done' }]);
  });

  it('closes the publish reminders when published and voids them when re-dated', () => {
    const scheduled = { ...post, status: 'scheduled' as const };
    expect(postResolutions(scheduled, { ...scheduled, status: 'published' })).toEqual([
      {
        types: ['post_publish_today', 'post_publish_overdue', 'post_publish_shortly'],
        outcome: 'done',
      },
    ]);
    expect(postResolutions(scheduled, { ...scheduled, publishDate: '2026-10-21' })).toEqual([
      {
        types: ['post_publish_today', 'post_publish_overdue', 'post_publish_shortly'],
        outcome: 'void',
      },
    ]);
  });
});

describe('timed reminders (F16 rule B13)', () => {
  it('sends 15 minutes before a meeting and 2 hours before the others, within the grace', () => {
    const now = new Date('2026-10-20T08:00:00Z');
    expect(timedReminderWindow('meeting_starting', now)).toEqual({
      from: new Date('2026-10-20T08:10:00Z'),
      to: new Date('2026-10-20T08:15:00Z'),
    });
    for (const kind of LEAD_REMINDER_KINDS.filter((kind) => kind !== 'meeting_starting')) {
      expect(timedReminderWindow(kind, now)).toEqual({
        from: new Date('2026-10-20T09:55:00Z'),
        to: new Date('2026-10-20T10:00:00Z'),
      });
    }
  });
});
