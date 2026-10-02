import { describe, expect, it } from 'vitest';
import {
  firstMatchPerRecipient,
  isMutableNotificationType,
  NOTIFICATION_CATALOG,
  NOTIFICATION_DATA_SCHEMAS,
  NOTIFICATION_TYPES,
  notificationSchema,
  notificationTypesOf,
} from './notifications.js';

describe('notification catalog', () => {
  it('lets users mute only the types that do not require action', () => {
    const mutable = NOTIFICATION_TYPES.filter(isMutableNotificationType);
    expect(mutable.sort()).toEqual(
      [
        'meeting_changed',
        'meeting_dropped',
        'meeting_invited',
        'meeting_upcoming',
        'post_assigned',
        'post_publish_today',
        'post_task_ready',
        'request_finished',
        'retainer_renewal_due',
        'shoot_booked',
        'shoot_changed',
        'shoot_dropped',
        'shoot_upcoming',
        'task_approved',
        'task_changed',
        'task_commented',
        'task_due_soon',
        'task_file_added',
        'task_mentioned',
        'task_opened',
      ].sort(),
    );
  });

  it('puts every type in one category', () => {
    const all = [
      ...notificationTypesOf('tasks'),
      ...notificationTypesOf('reminders'),
      ...notificationTypesOf('calendar'),
      ...notificationTypesOf('clients_projects'),
    ];
    expect(all.sort()).toEqual([...NOTIFICATION_TYPES].sort());
    expect(NOTIFICATION_CATALOG.tasks_generated.subject).toBe('template_run');
  });
});

describe('Phase 2 reminders (spec P2A)', () => {
  it('lists both types under reminders, locked, in their place of the order', () => {
    for (const type of ['task_over_limit_pending', 'retainer_behind'] as const) {
      expect(NOTIFICATION_CATALOG[type].category).toBe('reminders');
      expect(isMutableNotificationType(type)).toBe(false);
    }
    expect(NOTIFICATION_CATALOG.task_over_limit_pending.subject).toBe('task');
    expect(NOTIFICATION_CATALOG.retainer_behind.subject).toBe('retainer');
    const at = (type: (typeof NOTIFICATION_TYPES)[number]) => NOTIFICATION_TYPES.indexOf(type);
    expect(at('task_over_limit_pending')).toBe(at('task_overdue_escalated') + 1);
    expect(at('retainer_behind')).toBe(at('retainer_renewal_due') + 1);
  });

  it('carries 1 to 30 behind lines and 1 to 7 days left', () => {
    const line = { kind: 'design', label: null, delivered: 9, committed: 12, ready: 2 };
    const data = {
      retainer: 'Monthly',
      client: 'Clinic',
      periodEnd: '2026-10-31',
      daysLeft: 7,
      final: false,
      lines: [line],
    };
    const schema = NOTIFICATION_DATA_SCHEMAS.retainer_behind;
    expect(schema.safeParse(data).success).toBe(true);
    expect(schema.safeParse({ ...data, lines: [] }).success).toBe(false);
    expect(schema.safeParse({ ...data, lines: Array(31).fill(line) }).success).toBe(false);
    expect(schema.safeParse({ ...data, daysLeft: 0 }).success).toBe(false);
    expect(schema.safeParse({ ...data, daysLeft: 8 }).success).toBe(false);
  });
});

describe('first match per recipient (rule 2)', () => {
  it('keeps the earliest type of the order for each recipient of a subject', () => {
    const kept = firstMatchPerRecipient([
      { recipientId: 'a', subjectId: 't', type: 'task_commented' as const },
      { recipientId: 'a', subjectId: 't', type: 'task_mentioned' as const },
      { recipientId: 'b', subjectId: 't', type: 'task_commented' as const },
      { recipientId: 'a', subjectId: 't', type: 'task_changed' as const },
      { recipientId: 'c', subjectId: 't', type: 'task_approved' as const },
      { recipientId: 'c', subjectId: 't', type: 'task_assigned' as const },
    ]);
    expect(kept).toEqual([
      { recipientId: 'a', subjectId: 't', type: 'task_mentioned' },
      { recipientId: 'b', subjectId: 't', type: 'task_commented' },
      { recipientId: 'c', subjectId: 't', type: 'task_assigned' },
    ]);
  });

  it('keeps notices about different subjects (two tasks opened for one assignee)', () => {
    const items = [
      { recipientId: 'a', subjectId: 't1', type: 'task_opened' as const },
      { recipientId: 'a', subjectId: 't2', type: 'task_opened' as const },
    ];
    expect(firstMatchPerRecipient(items)).toEqual(items);
  });

  it('keeps several notices of the kept type (assignee and manager of one run)', () => {
    const items = [
      { recipientId: 'a', subjectId: 'run', type: 'tasks_generated' as const },
      { recipientId: 'a', subjectId: 'run', type: 'tasks_generated' as const },
    ];
    expect(firstMatchPerRecipient(items)).toEqual(items);
  });

  it('puts task_file_added right after task_commented (F10)', () => {
    const at = NOTIFICATION_TYPES.indexOf('task_commented');
    expect(NOTIFICATION_TYPES[at + 1]).toBe('task_file_added');
  });

  it('follows the spec order for the first twelve types (F14, F09)', () => {
    expect(NOTIFICATION_TYPES.slice(0, 12)).toEqual([
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
    ]);
  });

  it('never lets a user mute the approval types, which open their request (F09)', () => {
    for (const type of [
      'approval_responded',
      'approval_no_response',
      'approval_expired',
    ] as const) {
      expect(isMutableNotificationType(type)).toBe(false);
      expect(NOTIFICATION_CATALOG[type].subject).toBe('approval_request');
    }
    expect(NOTIFICATION_CATALOG.approval_responded.category).toBe('tasks');
    expect(NOTIFICATION_CATALOG.approval_no_response.category).toBe('reminders');
    expect(NOTIFICATION_CATALOG.approval_expired.category).toBe('reminders');
    expect(isMutableNotificationType('task_medical_review_requested')).toBe(false);
  });
});

describe('notification schema', () => {
  const base = {
    id: '0199a000-0000-7000-8000-000000000001',
    actor: null,
    subject: { type: 'task', id: '0199a000-0000-7000-8000-000000000002' },
    count: 1,
    read: false,
    createdAt: '2026-10-01T06:00:00.000Z',
    updatedAt: '2026-10-01T06:00:00.000Z',
  };
  const task = { title: 'Design', department: 'design', client: null, project: null };

  it('validates the snapshot by type', () => {
    expect(
      notificationSchema.safeParse({ ...base, type: 'task_assigned', data: { task } }).success,
    ).toBe(true);
    expect(
      notificationSchema.safeParse({ ...base, type: 'task_commented', data: { task } }).success,
    ).toBe(false);
    expect(
      notificationSchema.safeParse({
        ...base,
        type: 'task_commented',
        data: { task, excerpt: 'x'.repeat(141) },
      }).success,
    ).toBe(false);
  });
});
