import {
  NOTIFICATION_CATALOG,
  NOTIFICATION_DATA_SCHEMAS,
  NOTIFICATION_TYPES,
  type Notification,
  type NotificationType,
  notificationSchema,
} from '@vertex-hub/contracts';
import { describe, expect, it } from 'vitest';
import { formatAmount, formatCalendarDate, formatMoney } from './format.js';
import { linkPath, notificationLink, notificationText } from './notifications.js';
import { morningPush, notificationPush, PUSH_APP_NAME, testPush } from './push.js';

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
    startDate: '2026-11-20',
    endDate: '2027-02-19',
  },
  retainer_cycle_report_ready: {
    retainer: 'عقد شهري',
    client: 'مطعم الشام',
    cycleId: '0190a3c2-0000-7000-8000-0000000000c1',
    cycle: 3,
    periodStart: '2026-10-20',
    periodEnd: '2026-11-19',
    deliveryRate: 87,
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
  push_device_lost: { device: 'Chrome · Android' },
  task_reopened: { task },
  task_delivered: { task },
  task_revision_decided: { task, decision: 'extra_work' },
  task_progressed: { task, status: 'internal_review' },
  task_due_shortly: { task, dueDate: '2026-10-05', dueTime: '14:00' },
  post_published: { post },
  post_cancelled: { post },
  post_file_added: { post, file: 'cover.png' },
  post_progressed: { post, status: 'scheduled' },
  post_publish_shortly: { post },
  approval_opened: approval,
  approval_completed: approval,
  shoot_starting: { shoot },
  meeting_starting: { meeting, joinUrl: 'https://meet.example.com/abc' },
  shoot_completed: { shoot },
  responsibility_moved: { role: 'account_manager', record: 'مطعم الشام', holder: 'سامر' },
  client_status_changed: { client: 'مطعم الشام', status: 'paused' },
  client_healthcare_changed: { client: 'مطعم الشام', healthcare: true },
  lead_lost: { lead: 'مقهى الياسمين' },
  quote_expiring: { quote, validUntil: '2026-10-08' },
  quote_expired: { quote },
  quote_rejected: { quote },
  project_status_changed: { project: 'إطلاق المنيو', client: 'مطعم الشام', status: 'on_hold' },
  milestone_completed: { project: 'إطلاق المنيو', client: 'مطعم الشام', milestone: 'التصميم' },
  extra_work_created: { title: 'منشور إضافي', engagement: 'عقد شهري', client: 'مطعم الشام' },
  retainer_status_changed: { retainer: 'عقد شهري', client: 'مطعم الشام', status: 'ended' },
  contract_signed: {
    retainer: 'عقد شهري',
    client: 'مطعم الشام',
    contract: 'C-2026-0003',
    annex: null,
  },
  contract_voided: {
    retainer: 'عقد شهري',
    client: 'مطعم الشام',
    contract: 'C-2026-0003',
    annex: 2,
  },
  invoice_draft_created: {
    client: 'مطعم الشام',
    origin: 'milestone_done',
    description: 'إطلاق المنيو — التصميم',
  },
  invoice_due_soon: { invoice, dueOn: '2026-10-08' },
  payment_recorded: { invoice, amountMinor: 120_000, currency: 'USD' },
  payment_voided: { invoice, amountMinor: 120_000, currency: 'USD' },
  invoice_voided: { invoice },
  ad_deposit_recorded: { client: 'مطعم الشام', receipt: 'AD-2026-0002' },
  campaign_assigned: { campaign: { name: 'حملة رمضان', client: 'مطعم الشام' } },
  campaign_status_changed: {
    campaign: { name: 'حملة رمضان', client: 'مطعم الشام' },
    status: 'paused',
  },
  campaign_end_passed: {
    campaign: { name: 'حملة رمضان', client: 'مطعم الشام' },
    endsOn: '2026-10-03',
  },
  department_manager_assigned: { department: 'design' },
  member_moved: { member: 'سامر', left: ['design'], joined: ['photography'] },
  member_archived_open_work: { member: 'سامر', count: 3 },
  security_new_device: { device: 'Chrome على Windows', at: '2026-10-05T07:00:00.000Z' },
  security_notice: { change: 'roles_changed', by: 'رنا' },
  announcement: {
    title: 'دوام رمضان',
    excerpt: 'يبدأ الدوام في رمضان الساعة العاشرة',
    priority: 'important',
    requiresAck: true,
  },
  announcement_ack_reminder: { title: 'دوام رمضان' },
  announcement_ack_summary: { title: 'دوام رمضان', pending: 4 },
  poll_closing: { title: 'دوام رمضان', closesAt: '2026-10-22T09:00:00.000Z' },
  poll_results: { title: 'دوام رمضان', voters: 12 },
  contract_ending: { employee: 'سامر', endsOn: '2026-11-20' },
  probation_ending: { employee: 'سامر', endsOn: '2026-11-04' },
  employee_leaving: { employee: 'سامر', endedOn: '2026-10-31' },
  salary_changed: { effectiveOn: '2026-11-01' },
  holiday_changed: {
    change: 'added',
    name: 'عيد الأضحى',
    startsOn: '2027-05-16',
    endsOn: '2027-05-19',
  },
  hr_request_submitted: {
    employee: 'سامر',
    kind: 'leave',
    leaveType: 'annual',
    startsOn: '2026-11-08',
    endsOn: '2026-11-12',
  },
  hr_request_decided: {
    decision: 'approved',
    kind: 'leave',
    leaveType: 'sick',
    startsOn: '2026-11-08',
    endsOn: '2026-11-08',
  },
  colleague_on_leave: { employee: 'سامر', startsOn: '2026-11-08', endsOn: '2026-11-12' },
  leave_balance_adjusted: { leaveType: 'annual', year: 2026, days: 2.5 },
  action_reminder: {
    originalType: 'task_review_requested',
    originalData: { task },
    waitingWorkDays: 1,
    waitingOn: ['رنا'],
    waitingOnMore: 0,
  },
  action_escalated: {
    originalType: 'task_review_requested',
    originalData: { task },
    waitingWorkDays: 2,
    waitingOn: ['رنا', 'سامر'],
    waitingOnMore: 0,
  },
  action_escalated_top: {
    originalType: 'ad_budget_low',
    originalData: { client: 'مقهى الياسمين', balanceMinor: 5000, thresholdMinor: 10000 },
    waitingWorkDays: 4,
    waitingOn: ['رنا'],
    waitingOnMore: 3,
  },
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
    priority: NOTIFICATION_CATALOG[type].priority,
    box: NOTIFICATION_CATALOG[type].box,
    inbox: 'fyi',
    resolution: null,
    snoozedUntil: null,
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
    expect(text).toBe('عقد «عقد شهري» متأخر: بقيت 3 أيام على نهاية الدورة');
    expect(context).toBe('مطعم الشام · تصاميم 2/12 (1 جاهزة)، ريلز العروض 0/4، ستوري 1/8، +1');
  });

  it('names a renewed term and the end action of a renewal (F05B)', () => {
    const renewed = notificationText(sample('retainer_term_renewed'), departmentName);
    expect(renewed.text).toBe(
      'جُدّد عقد «عقد شهري» تلقائيًا: المدة 2 من 20 تشرين الثاني 2026 إلى 19 شباط 2027',
    );
    // Sent before F05C: the term's first and last months.
    const older = notificationText(
      sample('retainer_term_renewed', {
        data: {
          retainer: 'عقد شهري',
          client: 'مطعم الشام',
          termNumber: 2,
          startMonth: '2026-11-01',
          endMonth: '2027-01-01',
        },
      } as Partial<Notification>),
      departmentName,
    );
    expect(older.text).toBe(
      'جُدّد عقد «عقد شهري» تلقائيًا: المدة 2 من تشرين الثاني 2026 إلى كانون الثاني 2027',
    );
    const due = notificationText(sample('retainer_renewal_due'), departmentName);
    expect(due.context).toBe('مطعم الشام · 10 تشرين الأول 2026 · يتجدد تلقائيًا');
  });

  it('names a ready cycle report and opens it (F05C R1)', () => {
    const ready = sample('retainer_cycle_report_ready');
    const { text, context } = notificationText(ready, departmentName);
    expect(text).toBe('تقرير الدورة 3 من عقد «عقد شهري» جاهز');
    expect(context).toBe('مطعم الشام · 20 تشرين الأول – 19 تشرين الثاني 2026 · التسليم 87٪');
    expect(linkPath(notificationLink(ready))).toBe(
      `/retainers/${SUBJECT_ID}/cycles/0190a3c2-0000-7000-8000-0000000000c1/report`,
    );
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

describe('sales and engagement notices (F16 part C)', () => {
  const render = (type: NotificationType) => notificationText(sample(type), () => '');

  it('names the role a holder lost and who holds it now', () => {
    expect(render('responsibility_moved').text).toBe('نقل رنا إدارة حساب مطعم الشام إلى سامر');
  });

  it('names the new status of a client, a project and a retainer', () => {
    expect(render('client_status_changed').text).toBe(
      'أُوقف التعامل مع مطعم الشام مؤقتًا بواسطة رنا',
    );
    expect(render('project_status_changed').text).toBe(
      'انتقل المشروع «إطلاق المنيو» إلى «معلّق» بواسطة رنا',
    );
    expect(render('retainer_status_changed').text).toBe(
      'انتقل عقد «عقد شهري» إلى «منتهٍ» بواسطة رنا',
    );
  });

  it('names a contract or one of its annexes', () => {
    expect(render('contract_signed').text).toBe('سجّل رنا توقيع العقد C-2026-0003');
    expect(render('contract_voided').text).toBe('ألغى رنا الملحق 2 من العقد C-2026-0003');
  });

  it('names the last valid day of an expiring quote', () => {
    expect(render('quote_expiring').text).toBe(
      `ينتهي سريان Q-2026-0004 في ${formatCalendarDate('2026-10-08')}`,
    );
  });

  it('opens the record whose holder changed, and the engagement of extra work', () => {
    expect(
      notificationLink(
        sample('responsibility_moved', { subject: { type: 'lead', id: SUBJECT_ID } }),
      ),
    ).toEqual({
      to: '/leads/$leadId',
      params: { leadId: SUBJECT_ID },
    });
    expect(
      notificationLink(
        sample('extra_work_created', { subject: { type: 'retainer', id: SUBJECT_ID } }),
      ),
    ).toEqual({
      to: '/retainers/$retainerId',
      params: { retainerId: SUBJECT_ID },
      search: { tab: 'extra-work' },
    });
  });
});

describe('finance, campaigns and people notices (F16 part C)', () => {
  const names: Record<string, string> = { design: 'التصميم', photography: 'التصوير' };
  const render = (type: NotificationType) =>
    notificationText(sample(type), (code) => names[code] ?? '');

  it('names the payment amount in the bell and leaves it off the push (rule A9)', () => {
    expect(render('payment_recorded').text).toBe(
      `سجّل رنا دفعة ${formatMoney(120_000, 'USD')} على الفاتورة INV-2026-0012`,
    );
    expect(notificationPush(sample('payment_voided'), departmentName).body).toBe(
      'ألغى رنا دفعة على الفاتورة INV-2026-0012',
    );
  });

  it('names a campaign, its new status and its passed end date', () => {
    expect(render('campaign_status_changed').text).toBe(
      'انتقلت الحملة «حملة رمضان» إلى «متوقفة مؤقتًا» بواسطة رنا',
    );
    expect(render('campaign_end_passed')).toEqual({
      text: `انتهى موعد الحملة «حملة رمضان» في ${formatCalendarDate('2026-10-03')} وما زالت نشطة`,
      context: 'مطعم الشام',
    });
  });

  it('names departments by their current name, and the open work of an archived member', () => {
    expect(render('department_manager_assigned').text).toBe('عيّنك رنا مديرًا لقسم التصميم');
    expect(render('member_moved')).toEqual({
      text: 'غيّر رنا أقسام سامر',
      context: 'غادر التصميم · انضم إلى التصوير',
    });
    expect(render('member_archived_open_work').text).toBe('أُرشف سامر وما زالت لديه 3 أعمال مفتوحة');
  });

  it('copies the security emails, naming who made the change', () => {
    expect(render('security_notice').text).toBe('تغيّرت الأدوار المسندة إليك بواسطة رنا');
    expect(
      notificationText(
        sample('security_notice', { data: { change: 'password_changed', by: null } } as never),
        () => '',
      ).text,
    ).toBe('تغيّرت كلمة مرور حسابك بواسطتك');
  });

  it('opens a campaign, a department, a member, the ads tab and My account', () => {
    const link = (type: NotificationType, subjectType: string) =>
      linkPath(
        notificationLink(sample(type, { subject: { type: subjectType, id: SUBJECT_ID } } as never)),
      );
    expect(link('campaign_assigned', 'campaign')).toBe(`/campaigns/${SUBJECT_ID}`);
    expect(link('department_manager_assigned', 'department')).toBe(`/departments/${SUBJECT_ID}`);
    expect(link('member_moved', 'user')).toBe(`/team/${SUBJECT_ID}`);
    expect(link('ad_deposit_recorded', 'client')).toBe(`/clients/${SUBJECT_ID}?tab=ads`);
    expect(link('security_new_device', 'user')).toBe('/account');
  });

  it('opens the Contract tab and the Extra work tab', () => {
    const link = (type: NotificationType, subjectType: string) =>
      linkPath(
        notificationLink(sample(type, { subject: { type: subjectType, id: SUBJECT_ID } } as never)),
      );
    expect(link('contract_signed', 'retainer')).toBe(`/retainers/${SUBJECT_ID}?tab=contract`);
    expect(link('contract_voided', 'retainer')).toBe(`/retainers/${SUBJECT_ID}?tab=contract`);
    expect(link('extra_work_created', 'project')).toBe(`/projects/${SUBJECT_ID}?tab=extra-work`);
    expect(link('extra_work_created', 'retainer')).toBe(`/retainers/${SUBJECT_ID}?tab=extra-work`);
  });
});

describe('escalation steps (F16 rule B11)', () => {
  it('wrap the original text and name who it waits on and for how long', () => {
    expect(notificationText(sample('action_reminder'), departmentName)).toEqual({
      text: `تذكير: ${notificationText(sample('task_review_requested'), departmentName).text}`,
      context: 'بانتظار رنا منذ يوم عمل',
    });
    expect(notificationText(sample('action_escalated'), departmentName).context).toBe(
      'بانتظار رنا وسامر منذ يومَي عمل',
    );
    expect(notificationText(sample('action_escalated_top'), departmentName)).toMatchObject({
      text: 'تصعيد إلى الإدارة: رصيد إعلانات مقهى الياسمين منخفض: 50.00 دولار (حد التنبيه 100.00)',
      context: 'بانتظار رنا و+3 منذ 4 أيام عمل',
    });
  });

  it('open the record of the original', () => {
    const step = sample('action_escalated_top', { subject: { type: 'client', id: SUBJECT_ID } });
    expect(notificationLink(step)).toEqual(
      notificationLink(sample('ad_budget_low', { subject: { type: 'client', id: SUBJECT_ID } })),
    );
    expect(notificationLink(sample('action_reminder'))).toEqual({
      to: '/tasks/$taskId',
      params: { taskId: SUBJECT_ID },
    });
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

describe('push texts (spec F16 rules A8–A9)', () => {
  /** Every amount a snapshot holds, as the bell text formats it. */
  const amountsOf = (data: unknown): string[] =>
    Object.entries(data as Record<string, unknown>).flatMap(([key, value]) => {
      if (key.endsWith('Minor') && typeof value === 'number')
        return [formatAmount(Math.abs(value))];
      // An escalation step holds its original's snapshot.
      return key === 'originalData' ? amountsOf(value) : [];
    });

  it('never puts a money amount on the lock screen', () => {
    for (const type of NOTIFICATION_TYPES) {
      const { title, body } = notificationPush(sample(type), departmentName);
      for (const amount of amountsOf(SAMPLES[type])) {
        expect(`${title} ${body}`, type).not.toContain(amount);
      }
    }
    // The bell keeps them.
    expect(notificationText(sample('ad_budget_low'), departmentName).text).toContain(
      formatAmount(4_500),
    );
  });

  it('shows the notification text under its context, cut to 140 characters', () => {
    const push = notificationPush(sample('task_assigned'), departmentName);
    expect(push).toEqual({
      title: 'مطعم الشام',
      body: notificationText(sample('task_assigned'), departmentName).text,
    });
    const long = notificationPush(
      sample('task_assigned', { data: { task: { ...task, title: 'x'.repeat(200) } } } as never),
      departmentName,
    );
    expect(long.body).toHaveLength(140);
    expect(notificationPush(sample('push_device_lost'), departmentName).title).toBe(PUSH_APP_NAME);
    expect(testPush().title).toBe(PUSH_APP_NAME);
  });

  it('sums up the morning without a bell row (rule B14)', () => {
    expect(morningPush({ overdue: 3, dueToday: 5, needsYou: 2 })).toEqual({
      title: PUSH_APP_NAME,
      body: '3 متأخرة · 5 مستحقة اليوم · 2 تحتاجك',
    });
  });

  it('opens My account for a lost device', () => {
    expect(linkPath(notificationLink(sample('push_device_lost')))).toBe('/account');
  });
});

describe('announcements (F16 part D)', () => {
  const render = (type: NotificationType) => notificationText(sample(type), departmentName);

  it("shows an announcement, its reminder and the author's summary", () => {
    expect(render('announcement')).toEqual({
      text: 'إعلان من رنا يطلب تأكيد القراءة: «دوام رمضان»',
      context: 'يبدأ الدوام في رمضان الساعة العاشرة',
    });
    expect(render('announcement_ack_reminder').text).toBe('تذكير: أكّد قراءة الإعلان «دوام رمضان»');
    expect(render('announcement_ack_summary').text).toBe(
      'لم يؤكد 4 مستلمين قراءة إعلانك «دوام رمضان» بعد ثلاثة تذكيرات',
    );
    expect(linkPath(notificationLink(sample('announcement')))).toBe(`/announcements/${SUBJECT_ID}`);
  });

  it('reminds a non-voter before a poll closes and tells the author how many voted (rule D11)', () => {
    expect(render('poll_closing').text).toBe(
      'لم تصوّت بعد في استطلاع الإعلان «دوام رمضان»، ويُغلق في 22 تشرين الأول 2026 في 12:00 م',
    );
    expect(render('poll_results').text).toBe('أُغلق استطلاع إعلانك «دوام رمضان» بـ12 صوتًا');
    expect(linkPath(notificationLink(sample('poll_results')))).toBe(`/announcements/${SUBJECT_ID}`);
  });

  it("pushes an announcement as its title and the body's first characters (rule D13)", () => {
    expect(notificationPush(sample('announcement'), departmentName)).toEqual({
      title: 'دوام رمضان',
      body: 'يبدأ الدوام في رمضان الساعة العاشرة',
    });
  });
});

describe('HR (F17 part A)', () => {
  const render = (type: NotificationType) => notificationText(sample(type), departmentName);

  it('names the employee and the date, and opens the file in HR', () => {
    expect(render('contract_ending').text).toBe('ينتهي عقد سامر في 20 تشرين الثاني 2026');
    expect(render('probation_ending').text).toBe('تنتهي فترة تجربة سامر في 4 تشرين الثاني 2026');
    expect(linkPath(notificationLink(sample('contract_ending')))).toBe(`/hr/people/${SUBJECT_ID}`);
  });

  it("opens a leaving employee's profile, which department managers can read", () => {
    expect(render('employee_leaving').text).toBe('آخر يوم عمل لـسامر هو 31 تشرين الأول 2026');
    expect(linkPath(notificationLink(sample('employee_leaving')))).toBe(`/team/${SUBJECT_ID}`);
  });

  it('tells the employee of a salary change without its amount (rule A4)', () => {
    expect(render('salary_changed').text).toBe('سُجّل تغيير على راتبك يسري من 1 تشرين الثاني 2026');
    expect(linkPath(notificationLink(sample('salary_changed')))).toBe('/me/file');
  });

  it('names a changed holiday and its days, and opens the calendar on it (rule B3)', () => {
    expect(render('holiday_changed').text).toBe(
      'عطلة رسمية جديدة: «عيد الأضحى» 16 أيار – 19 أيار 2027',
    );
    expect(linkPath(notificationLink(sample('holiday_changed')))).toBe('/calendar?date=2027-05-16');
  });
});

describe('HR leave (F17 part B)', () => {
  const render = (type: NotificationType, data?: object) =>
    notificationText(
      data ? sample(type, { data } as Partial<Notification>) : sample(type),
      departmentName,
    );

  it('names the request to the GM and opens it in Approvals (rule B8)', () => {
    expect(render('hr_request_submitted').text).toBe(
      'طلب سامر إجازة سنوية 8 تشرين الثاني – 12 تشرين الثاني 2026',
    );
    expect(
      render('hr_request_submitted', {
        employee: 'سامر',
        kind: 'permission',
        leaveType: null,
        startsOn: '2026-11-08',
        endsOn: '2026-11-08',
      }).text,
    ).toBe('طلب سامر إذن مغادرة يوم 8 تشرين الثاني 2026');
    expect(linkPath(notificationLink(sample('hr_request_submitted')))).toBe(
      `/hr/approvals?request=${SUBJECT_ID}`,
    );
  });

  it('tells the employee the decision and opens My attendance (rules B14 and B15)', () => {
    expect(render('hr_request_decided').text).toBe(
      'وافقت الإدارة على طلبك: إجازة مرضية 8 تشرين الثاني 2026',
    );
    expect(linkPath(notificationLink(sample('hr_request_decided')))).toBe('/me/attendance');
    expect(render('leave_balance_adjusted').text).toBe(
      'عُدّل رصيد إجازة سنوية لعام 2026 بمقدار +2.5 يوم',
    );
    expect(linkPath(notificationLink(sample('leave_balance_adjusted')))).toBe('/me/attendance');
  });

  it("tells managers of a colleague's leave without its type (rules B16 and B18)", () => {
    expect(render('colleague_on_leave').text).toBe(
      'سامر في إجازة 8 تشرين الثاني – 12 تشرين الثاني 2026',
    );
    expect(linkPath(notificationLink(sample('colleague_on_leave')))).toBe(
      '/calendar?date=2026-11-08',
    );
  });
});
