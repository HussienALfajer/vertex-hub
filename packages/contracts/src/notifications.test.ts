import { describe, expect, it } from 'vitest';
import {
  type ChannelPolicies,
  channelModeOf,
  channelOverrides,
  ESCALATING_TYPES,
  effectiveChannel,
  escalationDue,
  firstMatchPerRecipient,
  isEscalationType,
  isMutableNotificationType,
  mergedNotificationData,
  NOTIFICATION_CATALOG,
  NOTIFICATION_DATA_SCHEMAS,
  NOTIFICATION_RESOLUTIONS,
  NOTIFICATION_TYPES,
  type NotificationContent,
  type NotificationData,
  notificationBox,
  notificationInbox,
  notificationPriority,
  notificationSchema,
  notificationTypesOf,
  resolutionTypeOf,
  snoozeUntil,
  typeChannelMode,
  updateNotificationPolicySchema,
  updateNotificationSettingsSchema,
  workDaysSince,
} from './notifications.js';

describe('notification catalog', () => {
  it('lets users mute only the types that do not require action', () => {
    const mutable = NOTIFICATION_TYPES.filter(isMutableNotificationType);
    expect(mutable.sort()).toEqual(
      [
        'ad_budget_low',
        'announcement_ack_summary',
        'meeting_changed',
        'meeting_dropped',
        'meeting_invited',
        'meeting_upcoming',
        'post_assigned',
        'post_publish_today',
        'post_task_ready',
        'push_device_lost',
        'invoice_overdue',
        'invoice_paid',
        'lead_won',
        'quote_accepted',
        'request_finished',
        'retainer_cycle_report_ready',
        'retainer_renewal_due',
        'retainer_term_renewed',
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
        // F16 part C: every new type of the workflow modules.
        'task_reopened',
        'task_delivered',
        'task_revision_decided',
        'task_progressed',
        'task_due_shortly',
        'post_published',
        'post_cancelled',
        'post_file_added',
        'post_progressed',
        'post_publish_shortly',
        'approval_opened',
        'approval_completed',
        'shoot_starting',
        'meeting_starting',
        'shoot_completed',
        // F17 part A: the information notices.
        'employee_leaving',
        'salary_changed',
        // F01C.
        'profile_changed',
        'client_logo_changed',
        'project_image_changed',
        'retainer_image_changed',
        // F06B.
        'subtask_stage_finished',
        'task_blocked',
        // F17 part B.
        'holiday_changed',
        'hr_request_decided',
        'colleague_on_leave',
        'leave_balance_adjusted',
        // F17 part C.
        'attendance_item_decided',
        'attendance_month_closed',
        'field_punch_recorded',
        'field_punch_rejected',
        // F16 part C: the new types of the sales and engagement modules.
        'responsibility_moved',
        'client_status_changed',
        'client_healthcare_changed',
        'lead_lost',
        'quote_expired',
        'quote_rejected',
        'project_status_changed',
        'milestone_completed',
        'extra_work_created',
        'retainer_status_changed',
        'contract_signed',
        'contract_voided',
        // F16 part C: the new types of the finance, campaigns and people modules.
        'invoice_due_soon',
        'payment_recorded',
        'payment_voided',
        'poll_closing',
        'poll_results',
        'invoice_voided',
        'ad_deposit_recorded',
        'campaign_status_changed',
        'member_moved',
      ].sort(),
    );
  });

  it('puts every type in one category', () => {
    const all = [
      ...notificationTypesOf('tasks'),
      ...notificationTypesOf('reminders'),
      ...notificationTypesOf('calendar'),
      ...notificationTypesOf('clients_projects'),
      ...notificationTypesOf('account'),
      ...notificationTypesOf('announcements'),
      ...notificationTypesOf('hr'),
    ];
    expect(all.sort()).toEqual([...NOTIFICATION_TYPES].sort());
    expect(NOTIFICATION_CATALOG.tasks_generated.subject).toBe('template_run');
  });
});

describe('the finance, campaigns and people types (F16 part C)', () => {
  it('keeps the account emails required on their in-app copies (rule 5)', () => {
    expect(NOTIFICATION_CATALOG.security_new_device).toMatchObject({
      priority: 'important',
      push: 'on',
      email: 'required',
      mutable: false,
    });
    expect(NOTIFICATION_CATALOG.security_notice).toMatchObject({
      priority: 'informational',
      push: 'off',
      email: 'required',
    });
  });

  it('names an automatic draft by its trigger, never a manual one', () => {
    const schema = NOTIFICATION_DATA_SCHEMAS.invoice_draft_created;
    const data = { client: 'Clinic', origin: 'milestone_done', description: 'Site — Design' };
    expect(schema.safeParse(data).success).toBe(true);
    expect(schema.safeParse({ ...data, origin: 'manual' }).success).toBe(false);
  });

  it('opens campaigns and departments, and asks for action on what waits', () => {
    expect(NOTIFICATION_CATALOG.campaign_assigned).toMatchObject({
      subject: 'campaign',
      box: 'action',
      opened: true,
    });
    expect(NOTIFICATION_CATALOG.department_manager_assigned).toMatchObject({
      subject: 'department',
      opened: true,
    });
    expect(NOTIFICATION_CATALOG.campaign_end_passed.escalation.map((s) => s.step)).toEqual([
      1, 2, 3,
    ]);
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
    priority: 'important',
    box: 'action',
    inbox: 'needs_you',
    resolution: null,
    snoozedUntil: null,
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
    expect(NOTIFICATION_CATALOG.invoice_overdue).toMatchObject({
      category: 'reminders',
      subject: 'invoice',
      mutable: true,
    });
    expect(NOTIFICATION_CATALOG.invoice_paid).toMatchObject({
      category: 'clients_projects',
      subject: 'invoice',
      mutable: true,
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
    expect(NOTIFICATION_CATALOG.ad_budget_low).toMatchObject({
      category: 'reminders',
      subject: 'client',
      mutable: true,
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
    expect(NOTIFICATION_CATALOG.lead_assigned).toMatchObject({
      category: 'clients_projects',
      subject: 'lead',
      mutable: false,
    });
    expect(NOTIFICATION_CATALOG.lead_won).toMatchObject({
      category: 'clients_projects',
      subject: 'lead',
      mutable: true,
    });
    for (const type of ['lead_follow_up_due', 'lead_follow_up_overdue'] as const) {
      expect(NOTIFICATION_CATALOG[type]).toMatchObject({
        category: 'reminders',
        subject: 'lead',
        mutable: false,
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

describe('channels (F16 rule B3)', () => {
  it('emails the triggers of the scope and the critical reminders by default', () => {
    const emailed = NOTIFICATION_TYPES.filter((type) =>
      effectiveChannel(NOTIFICATION_CATALOG[type].email, undefined),
    );
    expect(emailed.sort()).toEqual(
      [
        'action_escalated',
        'action_escalated_top',
        'approval_responded',
        // F17 rule A7.
        'contract_ending',
        // F17 rules B14 and B15.
        'hr_request_decided',
        'invoice_overdue',
        'invoice_paid',
        'lead_follow_up_overdue',
        'post_publish_overdue',
        // Part C rule 5: copies of the account emails, sent on their own.
        'security_new_device',
        'security_notice',
        'task_assigned',
        'task_due_soon',
        'task_mentioned',
        'task_over_limit_pending',
        'task_overdue',
        'task_overdue_escalated',
      ].sort(),
    );
  });

  it('pushes every type but the informational ones, and critical ones always', () => {
    for (const type of NOTIFICATION_TYPES) {
      const { priority, push } = NOTIFICATION_CATALOG[type];
      expect(push).toBe(
        priority === 'critical' ? 'required' : priority === 'informational' ? 'off' : 'on',
      );
    }
    expect(NOTIFICATION_CATALOG.push_device_lost).toMatchObject({
      category: 'account',
      subject: 'user',
      priority: 'informational',
      push: 'off',
      email: 'off',
    });
  });

  it('applies required and unavailable over the override, else the override, else the mode', () => {
    expect(effectiveChannel('required', false)).toBe(true);
    expect(effectiveChannel('unavailable', true)).toBe(false);
    expect(effectiveChannel('on', false)).toBe(false);
    expect(effectiveChannel('off', true)).toBe(true);
    expect(effectiveChannel('on', undefined)).toBe(true);
    expect(effectiveChannel('off', undefined)).toBe(false);
  });

  it('stores only the departures from the defaults and keeps overrides of locked types', () => {
    const chosen = new Set(['task_commented', 'meeting_upcoming'] as const);
    const overrides = channelOverrides('push', chosen, { task_overdue: false }, {});
    // On by default and not chosen: off; off by default and chosen: on; locked: kept as it was.
    expect(overrides.task_assigned).toBe(false);
    expect(overrides.task_commented).toBeUndefined();
    expect(overrides.task_overdue).toBe(false);
    expect(channelOverrides('email', new Set(['task_commented']), {}, {})).toMatchObject({
      task_commented: true,
      task_assigned: false,
    });
  });

  it('snapshots the priority of the final behind reminder and the managers notice', () => {
    const behind: NotificationData<'retainer_behind'> = {
      retainer: 'R',
      client: 'C',
      periodEnd: '2026-10-31',
      daysLeft: 2,
      final: true,
      lines: [{ kind: 'design', label: null, delivered: 0, committed: 1, ready: 0 }],
    };
    expect(notificationPriority({ type: 'retainer_behind', data: behind })).toBe('critical');
    expect(
      notificationPriority({ type: 'retainer_behind', data: { ...behind, final: false } }),
    ).toBe('important');
    const run = {
      template: 'T',
      count: 2,
      department: 'design',
      client: null,
      project: null,
      retainer: null,
    } as const;
    expect(
      notificationPriority({ type: 'tasks_generated', data: { ...run, unassigned: true } }),
    ).toBe('important');
    expect(
      notificationPriority({ type: 'tasks_generated', data: { ...run, unassigned: false } }),
    ).toBe('normal');
  });

  it('reads the modes from the policy, and keeps the overrides of types it locks', () => {
    const policies: ChannelPolicies = {
      task_commented: { push: 'required', email: 'off' },
      task_assigned: { push: 'unavailable', email: 'on' },
    };
    expect(typeChannelMode('task_commented', 'push', policies)).toBe('required');
    expect(typeChannelMode('task_returned', 'push', policies)).toBe('on');
    const overrides = channelOverrides(
      'push',
      new Set(['task_assigned']),
      { task_commented: false },
      policies,
    );
    expect(overrides).toMatchObject({ task_commented: false });
    expect(overrides.task_assigned).toBeUndefined();
  });

  it('always pushes the final behind reminder unless a policy says otherwise', () => {
    const content: NotificationContent = {
      type: 'retainer_behind',
      data: {
        retainer: 'R',
        client: 'C',
        periodEnd: '2026-10-31',
        daysLeft: 1,
        final: true,
        lines: [{ kind: 'design', label: null, delivered: 0, committed: 1, ready: 0 }],
      },
    };
    expect(channelModeOf(content, 'push', {})).toBe('required');
    expect(channelModeOf(content, 'push', { retainer_behind: { push: 'off', email: 'off' } })).toBe(
      'off',
    );
  });

  it('keeps email choices and the digest switch when an update leaves them out', () => {
    const update = updateNotificationSettingsSchema.parse({ mutedTypes: [] });
    expect(update.emailTypes).toBeUndefined();
    expect(update.digestEnabled).toBeUndefined();
  });
});

describe('inboxes and resolution (F16 rules B5–B6)', () => {
  const run = {
    template: 'T',
    count: 2,
    department: 'design',
    client: null,
    project: null,
    retainer: null,
  } as const;

  it('puts the types with a resolution in "Needs you" and the managers notice too', () => {
    expect(NOTIFICATION_CATALOG.task_review_requested.box).toBe('action');
    expect(NOTIFICATION_CATALOG.task_commented).toMatchObject({ box: 'info', merges: true });
    expect(NOTIFICATION_CATALOG.task_changed.merges).toBe(true);
    expect(NOTIFICATION_CATALOG.lead_assigned).toMatchObject({ box: 'action', opened: true });
    expect(notificationBox({ type: 'tasks_generated', data: { ...run, unassigned: true } })).toBe(
      'action',
    );
    expect(notificationBox({ type: 'tasks_generated', data: { ...run, unassigned: false } })).toBe(
      'info',
    );
    // Only what can be opened or merged has those flags.
    for (const type of NOTIFICATION_TYPES) {
      if (NOTIFICATION_CATALOG[type].opened) expect(NOTIFICATION_CATALOG[type].box).toBe('action');
      if (NOTIFICATION_CATALOG[type].escalation.length > 0) {
        expect(NOTIFICATION_CATALOG[type].box).toBe('action');
      }
    }
  });

  it('keeps the box list of the backfill migration (0069)', () => {
    const action = NOTIFICATION_TYPES.filter(
      (type) => NOTIFICATION_CATALOG[type].box === 'action' && !isEscalationType(type),
    );
    expect(action).toEqual([
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
      'task_requested',
      'post_returned',
      'post_review_requested',
      'post_medical_review_requested',
      'post_awaiting_client',
      'post_assigned',
      'post_task_unlinked',
      'task_due_soon',
      'task_overdue',
      'task_overdue_escalated',
      'task_over_limit_pending',
      'post_publish_today',
      'post_publish_overdue',
      'shoot_not_closed',
      'client_account_manager_assigned',
      'project_manager_assigned',
      'retainer_renewal_due',
      'retainer_behind',
      'retainer_cycle_report_ready',
      'retainer_amendment_pending',
      'quote_approval_requested',
      'quote_approval_decided',
      'invoice_overdue',
      'ad_budget_low',
      'email_failed',
      'lead_assigned',
      'lead_follow_up_overdue',
      'lead_follow_up_due',
      // F16 part C, created after the backfill.
      'task_due_shortly',
      'post_publish_shortly',
      'quote_expiring',
      'invoice_draft_created',
      'campaign_assigned',
      'campaign_end_passed',
      'department_manager_assigned',
      'member_archived_open_work',
      // F16 part D (an announcement that asks for an acknowledgement is "action" by its data).
      'announcement_ack_reminder',
      'poll_closing',
      // F17 part A.
      'contract_ending',
      'probation_ending',
      // F17 part B.
      'hr_request_submitted',
      // F17 part C.
      'attendance_item_raised',
      'attendance_items_pending',
      'attendance_check_in_missing',
      'attendance_check_out_missing',
      'shoot_check_in_missing',
      'kiosk_offline',
      // F06B.
      'subtask_turn',
      'subtask_handover',
      'subtasks_all_finished',
      'subtask_holding_next',
    ]);
  });

  it('closes an escalation step with its original, and other action rows with themselves', () => {
    const step: NotificationContent = {
      type: 'action_escalated',
      data: {
        originalType: 'task_review_requested',
        originalData: {},
        waitingWorkDays: 2,
        waitingOn: ['A'],
        waitingOnMore: 0,
      },
    };
    expect(resolutionTypeOf(step)).toBe('task_review_requested');
    expect(resolutionTypeOf({ type: 'tasks_generated', data: { ...run, unassigned: true } })).toBe(
      'tasks_generated',
    );
    expect(
      resolutionTypeOf({ type: 'tasks_generated', data: { ...run, unassigned: false } }),
    ).toBeNull();
  });

  it('derives the inbox from the box, the resolution and who resolved it', () => {
    const base = {
      recipientId: 'me',
      box: 'action',
      snoozed: false,
      resolution: null,
      resolvedById: null,
    } as const;
    expect(notificationInbox(base)).toBe('needs_you');
    expect(notificationInbox({ ...base, box: 'info' })).toBe('fyi');
    expect(notificationInbox({ ...base, snoozed: true })).toBe('snoozed');
    expect(notificationInbox({ ...base, resolution: 'done', resolvedById: 'me' })).toBe('done');
    expect(notificationInbox({ ...base, resolution: 'done', resolvedById: 'other' })).toBe('fyi');
    expect(notificationInbox({ ...base, resolution: 'done' })).toBe('fyi');
    for (const resolution of NOTIFICATION_RESOLUTIONS) {
      expect(['done', 'fyi']).toContain(notificationInbox({ ...base, resolution }));
    }
    expect(notificationInbox({ ...base, resolution: 'void', resolvedById: 'other' })).toBe('done');
  });
});

describe('snooze (F16 rule B8)', () => {
  it('wakes after one or three hours, or on the next work day at 09:00 Damascus time', () => {
    // Thursday 2026-10-22, 15:00 in Damascus (UTC+3).
    const now = new Date('2026-10-22T12:00:00Z');
    expect(snoozeUntil('1h', now).toISOString()).toBe('2026-10-22T13:00:00.000Z');
    expect(snoozeUntil('3h', now).toISOString()).toBe('2026-10-22T15:00:00.000Z');
    // Friday is off: Saturday 09:00.
    expect(snoozeUntil('next_work_day', now).toISOString()).toBe('2026-10-24T06:00:00.000Z');
  });
});

describe('escalation (F16 rule B11)', () => {
  it('escalates the chain types, the step-1-only types and the types with an added step', () => {
    expect(ESCALATING_TYPES.sort()).toEqual(
      [
        'ad_budget_low',
        'campaign_end_passed',
        'hr_request_submitted',
        'invoice_draft_created',
        'invoice_overdue',
        'member_archived_open_work',
        'post_awaiting_client',
        'post_medical_review_requested',
        'post_publish_overdue',
        'post_review_requested',
        'quote_approval_requested',
        'retainer_amendment_pending',
        'shoot_not_closed',
        'subtask_holding_next',
        'task_awaiting_client',
        'task_medical_review_requested',
        'task_overdue_escalated',
        'task_requested',
        'task_review_requested',
      ].sort(),
    );
    expect(NOTIFICATION_CATALOG.quote_approval_requested.escalation.map((s) => s.step)).toEqual([
      1,
    ]);
    expect(NOTIFICATION_CATALOG.task_review_requested.escalation.map((s) => s.step)).toEqual([
      1, 2, 3,
    ]);
  });

  it('counts work days after the original, skipping Fridays', () => {
    // Wednesday 2026-10-21: Thursday is 1, Saturday 2, Sunday 3, Monday 4.
    expect(workDaysSince('2026-10-21', '2026-10-21')).toBe(0);
    expect(workDaysSince('2026-10-21', '2026-10-22')).toBe(1);
    expect(workDaysSince('2026-10-21', '2026-10-23')).toBe(1);
    expect(workDaysSince('2026-10-21', '2026-10-24')).toBe(2);
    const [one, two, three] = NOTIFICATION_CATALOG.task_review_requested.escalation;
    if (!one || !two || !three) throw new Error('chain');
    expect(escalationDue(one, '2026-10-21', '2026-10-21')).toBe(false);
    expect(escalationDue(one, '2026-10-21', '2026-10-22')).toBe(true);
    expect(escalationDue(two, '2026-10-21', '2026-10-22')).toBe(false);
    expect(escalationDue(two, '2026-10-21', '2026-10-24')).toBe(true);
    expect(escalationDue(three, '2026-10-21', '2026-10-25')).toBe(false);
    expect(escalationDue(three, '2026-10-21', '2026-10-26')).toBe(true);
  });

  it('times the calendar-day and overdue-day steps', () => {
    const [budget] = NOTIFICATION_CATALOG.ad_budget_low.escalation;
    const [invoice] = NOTIFICATION_CATALOG.invoice_overdue.escalation;
    if (!budget || !invoice) throw new Error('steps');
    expect(escalationDue(budget, '2026-10-01', '2026-10-07')).toBe(false);
    expect(escalationDue(budget, '2026-10-01', '2026-10-08')).toBe(true);
    // First overdue notice on its first overdue day: the 14th day is 13 days later.
    expect(escalationDue(invoice, '2026-10-01', '2026-10-13', 1)).toBe(false);
    expect(escalationDue(invoice, '2026-10-01', '2026-10-14', 1)).toBe(true);
  });
});

describe('channel policy (F16 rule B2)', () => {
  it('takes both modes, or a reset, and nothing else', () => {
    expect(updateNotificationPolicySchema.safeParse({ push: 'on', email: 'off' }).success).toBe(
      true,
    );
    expect(updateNotificationPolicySchema.safeParse({ reset: true }).success).toBe(true);
    expect(updateNotificationPolicySchema.safeParse({ push: 'on' }).success).toBe(false);
    expect(
      updateNotificationPolicySchema.safeParse({ reset: true, push: 'on', email: 'on' }).success,
    ).toBe(false);
  });
});

describe('image and profile notices (spec F01C)', () => {
  it('merges each per subject and day, informational, without push', () => {
    for (const type of [
      'profile_changed',
      'client_logo_changed',
      'project_image_changed',
      'retainer_image_changed',
    ] as const) {
      expect(NOTIFICATION_CATALOG[type]).toMatchObject({
        box: 'info',
        priority: 'informational',
        push: 'off',
        merges: true,
        mergesDaily: true,
        mutable: true,
      });
    }
    expect(NOTIFICATION_CATALOG.profile_changed).toMatchObject({
      category: 'account',
      subject: 'user',
    });
    expect(NOTIFICATION_CATALOG.task_commented.mergesDaily).toBe(false);
  });

  it('names every part changed that day in display order (rule 19)', () => {
    expect(
      mergedNotificationData(
        { type: 'profile_changed', data: { changes: ['title', 'photo'] } },
        { changes: ['skills', 'photo'] },
      ),
    ).toEqual({ changes: ['photo', 'title', 'skills'] });
    expect(
      mergedNotificationData({ type: 'profile_changed', data: { changes: ['name'] } }, null),
    ).toEqual({ changes: ['name'] });
    expect(
      mergedNotificationData(
        { type: 'client_logo_changed', data: { client: 'C', removed: true } },
        { client: 'C', removed: false },
      ),
    ).toEqual({ client: 'C', removed: true });
  });

  it('needs at least one change', () => {
    expect(NOTIFICATION_DATA_SCHEMAS.profile_changed.safeParse({ changes: [] }).success).toBe(
      false,
    );
  });
});
