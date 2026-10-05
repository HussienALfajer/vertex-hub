import { describe, expect, it } from 'vitest';
import {
  emailedTypes,
  firstMatchPerRecipient,
  isMutableNotificationType,
  NOTIFICATION_CATALOG,
  NOTIFICATION_DATA_SCHEMAS,
  NOTIFICATION_TYPES,
  notificationSchema,
  notificationTypesOf,
  updateNotificationSettingsSchema,
} from './notifications.js';

describe('notification catalog', () => {
  it('lets users mute only the types that do not require action', () => {
    const mutable = NOTIFICATION_TYPES.filter(isMutableNotificationType);
    expect(mutable.sort()).toEqual(
      [
        'ad_budget_low',
        'meeting_changed',
        'meeting_dropped',
        'meeting_invited',
        'meeting_upcoming',
        'post_assigned',
        'post_publish_today',
        'post_task_ready',
        'invoice_overdue',
        'invoice_paid',
        'lead_won',
        'quote_accepted',
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

describe('invoice notifications (spec F13)', () => {
  it('sends overdue alerts as reminders and paid invoices to clients and projects, both mutable', () => {
    expect(NOTIFICATION_CATALOG.invoice_overdue).toEqual({
      category: 'reminders',
      subject: 'invoice',
      mutable: true,
      emailByDefault: false,
    });
    expect(NOTIFICATION_CATALOG.invoice_paid).toEqual({
      category: 'clients_projects',
      subject: 'invoice',
      mutable: true,
      emailByDefault: true,
    });
  });

  it('carries the number, the client and the days overdue', () => {
    const invoice = { displayNumber: 'INV-2026-0012', client: 'Client' };
    expect(
      NOTIFICATION_DATA_SCHEMAS.invoice_overdue.safeParse({ invoice, daysOverdue: 7 }).success,
    ).toBe(true);
    expect(
      NOTIFICATION_DATA_SCHEMAS.invoice_overdue.safeParse({ invoice, daysOverdue: 0 }).success,
    ).toBe(false);
    expect(NOTIFICATION_DATA_SCHEMAS.invoice_paid.safeParse({ invoice }).success).toBe(true);
  });
});

describe('ad budget notifications (spec F12, A11)', () => {
  it('is a mutable reminder that opens the client', () => {
    expect(NOTIFICATION_CATALOG.ad_budget_low).toEqual({
      category: 'reminders',
      subject: 'client',
      mutable: true,
      emailByDefault: false,
    });
  });

  it('carries the client, a possibly negative balance and the threshold', () => {
    const schema = NOTIFICATION_DATA_SCHEMAS.ad_budget_low;
    expect(
      schema.safeParse({ client: 'Client', balanceMinor: -2_500, thresholdMinor: 10_000 }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ client: 'Client', balanceMinor: 0, thresholdMinor: -1 }).success,
    ).toBe(false);
  });
});

describe('lead notifications (spec F03, A12)', () => {
  it('locks the reminders and the assignment and lets users mute a win', () => {
    expect(NOTIFICATION_CATALOG.lead_assigned).toEqual({
      category: 'clients_projects',
      subject: 'lead',
      mutable: false,
      emailByDefault: false,
    });
    expect(NOTIFICATION_CATALOG.lead_won).toEqual({
      category: 'clients_projects',
      subject: 'lead',
      mutable: true,
      emailByDefault: false,
    });
    for (const type of ['lead_follow_up_due', 'lead_follow_up_overdue'] as const) {
      expect(NOTIFICATION_CATALOG[type]).toEqual({
        category: 'reminders',
        subject: 'lead',
        mutable: false,
        emailByDefault: false,
      });
    }
  });

  it('carries the lead name, the date and, when overdue, the owner', () => {
    expect(
      NOTIFICATION_DATA_SCHEMAS.lead_won.safeParse({ lead: 'Al-Noor', client: 'Al-Noor' }).success,
    ).toBe(true);
    expect(
      NOTIFICATION_DATA_SCHEMAS.lead_follow_up_due.safeParse({
        lead: 'Al-Noor',
        followUpOn: '2026-10-05',
      }).success,
    ).toBe(true);
    expect(
      NOTIFICATION_DATA_SCHEMAS.lead_follow_up_overdue.safeParse({
        lead: 'Al-Noor',
        followUpOn: '2026-10-05',
      }).success,
    ).toBe(false);
  });
});

describe('notification emails (F14 email rule 2)', () => {
  it('emails the triggers of the scope by default', () => {
    expect([...emailedTypes(null)].sort()).toEqual(
      [
        'approval_responded',
        'invoice_paid',
        'task_assigned',
        'task_due_soon',
        'task_mentioned',
        'task_overdue',
        'task_overdue_escalated',
      ].sort(),
    );
    expect(NOTIFICATION_CATALOG.task_assigned.emailByDefault).toBe(true);
    expect(NOTIFICATION_CATALOG.task_commented.emailByDefault).toBe(false);
  });

  it('follows a saved choice, even an empty one', () => {
    expect([...emailedTypes(['task_commented'])]).toEqual(['task_commented']);
    expect(emailedTypes([]).size).toBe(0);
  });

  it('keeps email choices and the digest switch when an update leaves them out', () => {
    const update = updateNotificationSettingsSchema.parse({ mutedTypes: [] });
    expect(update.emailTypes).toBeUndefined();
    expect(update.digestEnabled).toBeUndefined();
  });
});
