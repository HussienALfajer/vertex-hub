import {
  NOTIFICATION_CATALOG,
  NOTIFICATION_DATA_SCHEMAS,
  NOTIFICATION_TYPES,
  type Notification,
  type NotificationType,
  notificationSchema,
} from '@vertex-hub/contracts';
import { describe, expect, it } from 'vitest';
import { linkPath, notificationLink, notificationText } from './notifications.js';

const task = { title: 'تصميم منيو', department: 'design', client: 'مطعم الشام', project: null };
const post = {
  title: 'منشور الافتتاح',
  client: 'مطعم الشام',
  publishDate: '2026-10-05',
  publishTime: '16:00',
};
const shoot = {
  title: 'تصوير المنيو',
  client: 'مطعم الشام',
  startsAt: '2026-10-05T07:00:00.000Z',
  endsAt: '2026-10-05T09:00:00.000Z',
  location: 'دمشق',
};
const meeting = {
  title: 'اجتماع الخطة',
  client: null,
  startsAt: '2026-10-05T07:00:00.000Z',
  endsAt: '2026-10-05T08:00:00.000Z',
};
const quote = { displayNumber: 'Q-2026-0004', title: 'هوية بصرية', client: 'مطعم الشام' };
const invoice = { displayNumber: 'INV-2026-0012', client: 'مطعم الشام' };
const due = { dueDate: '2026-10-05', dueTime: null };
const approval = { client: 'مطعم الشام', contact: 'سامر' };

/** A valid snapshot of every type, checked against its contract schema below. */
const SAMPLES: Record<NotificationType, unknown> = {
  task_assigned: { task },
  task_mentioned: { task, excerpt: 'راجع هذا' },
  task_returned: { task, source: 'client' },
  task_review_requested: { task },
  task_medical_review_requested: { task },
  task_awaiting_client: { task },
  task_over_limit: { task },
  approval_responded: { ...approval, decision: 'approved' },
  approval_no_response: approval,
  approval_expired: approval,
  task_changed: {
    task,
    change: 'due',
    from: null,
    to: { dueDate: '2026-10-07', dueTime: '10:00' },
  },
  task_commented: { task, excerpt: 'تعليق' },
  task_file_added: { task, file: 'menu.pdf' },
  task_requested: { task },
  tasks_generated: {
    template: 'حملة شهرية',
    count: 3,
    department: 'design',
    unassigned: true,
    client: 'مطعم الشام',
    project: null,
    retainer: 'عقد شهري',
  },
  task_approved: { task, source: 'internal' },
  task_opened: { task },
  request_finished: { task, outcome: 'delivered' },
  post_returned: { post, source: 'medical' },
  post_review_requested: { post },
  post_medical_review_requested: { post },
  post_awaiting_client: { post },
  post_assigned: { post },
  post_approved: { post, source: 'client' },
  post_task_ready: { post, taskTitle: 'تصميم' },
  post_task_unlinked: { post, taskTitle: 'تصميم', reason: 'reopened' },
  shoot_booked: { shoot },
  shoot_dropped: { shoot, cause: 'removed' },
  shoot_changed: { shoot, changes: ['time', 'location'] },
  meeting_invited: { meeting },
  meeting_dropped: { meeting, cause: 'cancelled' },
  meeting_changed: { meeting, changes: ['link'] },
  task_due_soon: { task, ...due },
  task_overdue: { task, ...due },
  task_overdue_escalated: { task, ...due, assignee: 'رنا' },
  task_over_limit_pending: { task, revisionNumber: 4, recordedOn: '2026-10-01' },
  post_publish_today: { post },
  post_publish_overdue: { post },
  shoot_upcoming: { shoot },
  shoot_not_closed: { shoot },
  meeting_upcoming: { meeting },
  client_account_manager_assigned: { client: 'مطعم الشام' },
  project_manager_assigned: { project: 'موقع المطعم', client: 'مطعم الشام' },
  retainer_renewal_due: {
    retainer: 'عقد شهري',
    client: 'مطعم الشام',
    renewalDate: '2026-10-10',
    daysLeft: 5,
    endAction: 'renew',
  },
  retainer_term_renewed: {
    retainer: 'عقد شهري',
    client: 'مطعم الشام',
    termNumber: 2,
    startMonth: '2026-11-01',
    endMonth: '2027-01-01',
  },
  retainer_amendment_pending: {
    retainer: 'عقد شهري',
    client: 'مطعم الشام',
    number: 3,
    moneyDeltaMinor: -8_000,
    currency: 'USD',
    creator: 'سارة',
  },
  retainer_amendment_decided: {
    retainer: 'عقد شهري',
    number: 3,
    approved: false,
    note: 'ليس الآن',
  },
  retainer_behind: {
    retainer: 'عقد شهري',
    client: 'مطعم الشام',
    periodEnd: '2026-10-10',
    daysLeft: 3,
    final: false,
    lines: [
      { kind: 'design', label: null, delivered: 2, committed: 12, ready: 1 },
      { kind: 'reel', label: 'ريلز العروض', delivered: 0, committed: 4, ready: 0 },
      { kind: 'story', label: null, delivered: 1, committed: 8, ready: 0 },
      { kind: 'post', label: null, delivered: 1, committed: 8, ready: 0 },
    ],
  },
  quote_approval_requested: { quote },
  quote_approval_decided: { quote, decision: 'return', note: 'خصم كبير' },
  quote_accepted: { quote, project: null, retainer: 'عقد شهري' },
  invoice_overdue: { invoice, daysOverdue: 14 },
  invoice_paid: { invoice },
  ad_budget_low: { client: 'مطعم الشام', balanceMinor: 4_500, thresholdMinor: 10_000 },
  email_failed: {
    kind: 'client_invoice',
    client: 'مطعم الشام',
    document: 'INV-2026-0012',
    recipients: ['سامي', 'ليلى'],
  },
  lead_assigned: { lead: 'مقهى الياسمين' },
  lead_won: { lead: 'مقهى الياسمين', client: 'مقهى الياسمين' },
  lead_follow_up_overdue: { lead: 'مقهى الياسمين', followUpOn: '2026-10-01', owner: 'رنا' },
  lead_follow_up_due: { lead: 'مقهى الياسمين', followUpOn: '2026-10-05' },
};

const SUBJECT_ID = '0192a5a0-0000-7000-8000-000000000001';

function sample(type: NotificationType, overrides: Partial<Notification> = {}): Notification {
  return notificationSchema.parse({
    id: '0192a5a0-0000-7000-8000-000000000002',
    type,
    actor: { id: '0192a5a0-0000-7000-8000-000000000003', name: 'رنا' },
    subject: { type: NOTIFICATION_CATALOG[type].subject, id: SUBJECT_ID },
    data: SAMPLES[type],
    count: 1,
    read: false,
    createdAt: '2026-10-05T07:00:00.000Z',
    updatedAt: '2026-10-05T07:00:00.000Z',
    ...overrides,
  });
}

const departmentName = () => 'التصميم';

describe('notification texts', () => {
  it.each(NOTIFICATION_TYPES)('renders %s with every placeholder filled', (type) => {
    expect(NOTIFICATION_DATA_SCHEMAS[type].safeParse(SAMPLES[type]).success).toBe(true);
    const { text, context } = notificationText(sample(type), departmentName);
    expect(text.length).toBeGreaterThan(5);
    expect(`${text} ${context ?? ''}`).not.toMatch(/\{\{|undefined|null/);
  });

  it('names the system when there is no actor', () => {
    const { text } = notificationText(sample('task_assigned', { actor: null }), departmentName);
    expect(text).toBe('أُسندت إليك «تصميم منيو» بواسطة النظام');
  });

  it('counts merged comments with the Arabic plural forms', () => {
    const two = notificationText(sample('task_commented', { count: 2 }), departmentName);
    expect(two.text).toBe('تعليقان جديدان على «تصميم منيو»');
    const eleven = notificationText(sample('task_commented', { count: 11 }), departmentName);
    expect(eleven.text).toBe('11 تعليقًا جديدًا على «تصميم منيو»');
  });

  it('names three behind lines, then how many more', () => {
    const { text, context } = notificationText(sample('retainer_behind'), departmentName);
    expect(text).toBe('عقد «عقد شهري» متأخر: بقيت 3 أيام على نهاية الشهر');
    expect(context).toBe('مطعم الشام · تصاميم 2/12 (1 جاهزة)، ريلز العروض 0/4، ستوري 1/8، +1');
  });

  it('names a renewed term and the end action of a renewal (F05B)', () => {
    const renewed = notificationText(sample('retainer_term_renewed'), departmentName);
    expect(renewed.text).toBe(
      'جُدّد عقد «عقد شهري» تلقائيًا: المدة 2 من تشرين الثاني 2026 إلى كانون الثاني 2027',
    );
    const due = notificationText(sample('retainer_renewal_due'), departmentName);
    expect(due.context).toBe('مطعم الشام · 10 تشرين الأول 2026 · يتجدد تلقائيًا');
  });

  it('names an amendment waiting for approval and its decision (F05B A4)', () => {
    const pending = notificationText(sample('retainer_amendment_pending'), departmentName);
    expect(pending.text).toContain('التعديل 3 على عقد «عقد شهري»');
    expect(pending.context).toBe('مطعم الشام');
    const decided = notificationText(sample('retainer_amendment_decided'), departmentName);
    expect(decided.text).toContain('رفض');
    expect(decided.text).toContain('ليس الآن');
  });

  it('writes the department of generated tasks by its current name', () => {
    const { text } = notificationText(sample('tasks_generated'), departmentName);
    expect(text).toBe('3 مهام من قالب «حملة شهرية» تنتظر الإسناد في التصميم');
  });
});

describe('notification links', () => {
  it('opens the subject of the notification', () => {
    expect(linkPath(notificationLink(sample('task_assigned')))).toBe(`/tasks/${SUBJECT_ID}`);
    expect(linkPath(notificationLink(sample('invoice_paid')))).toBe(`/invoices/${SUBJECT_ID}`);
  });

  it('writes search params as the router reads them', () => {
    expect(linkPath(notificationLink(sample('ad_budget_low')))).toBe(
      `/clients/${SUBJECT_ID}?tab=ads`,
    );
    const queued = new URL(linkPath(notificationLink(sample('tasks_generated'))), 'http://x');
    expect(queued.pathname).toBe('/tasks/list');
    expect(JSON.parse(queued.searchParams.get('department') ?? '')).toEqual(['design']);
    expect(queued.searchParams.get('assignee')).toBe('unassigned');
  });
});

describe('failed client emails (F14 email rule 23)', () => {
  it('names the email, its document and its recipients', () => {
    const { text, context } = notificationText(sample('email_failed'), departmentName);
    expect(text).toBe('تعذّر إرسال الفاتورة INV-2026-0012 إلى سامي وليلى');
    expect(context).toBe('مطعم الشام');
  });

  it('opens the document, or the client screen that holds it', () => {
    const invoice = sample('email_failed', { subject: { type: 'invoice', id: SUBJECT_ID } });
    expect(linkPath(notificationLink(invoice))).toBe(`/invoices/${SUBJECT_ID}`);
    const report = sample('email_failed', {
      data: {
        kind: 'client_report',
        client: 'مطعم الشام',
        document: '2026-09',
        recipients: ['سامي'],
      },
    });
    expect(linkPath(notificationLink(report))).toBe(`/clients/${SUBJECT_ID}/report?month=2026-09`);
    const statement = sample('email_failed', {
      data: {
        kind: 'client_statement',
        client: 'مطعم الشام',
        document: null,
        recipients: ['سامي'],
      },
    });
    expect(linkPath(notificationLink(statement))).toBe(`/clients/${SUBJECT_ID}?tab=invoices`);
  });
});
