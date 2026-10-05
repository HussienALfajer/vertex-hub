import {
  type DepartmentCode,
  type DigestTask,
  EMAIL_LIMITS,
  type EmailData,
  type Notification,
  type SecurityChange,
} from '@vertex-hub/contracts';
import type { EmailContent, EmailListItem, EmailSection } from './emails.js';
import { formatCalendarDate, formatDateTime, formatNumber, formatTimeOfDay } from './format.js';
import { linkPath, notificationLink, notificationText } from './notifications.js';
import { fill, type PluralForms, plural } from './text.js';

/*
 * The staff emails of F14 email (ADR 0028): notification batches, the morning digest and the
 * account emails. Links point into the web app at `appUrl`.
 */

/** An absolute link into the web app. */
const appLink = (appUrl: string, path: string) => new URL(path, appUrl).toString();

const OPEN = 'فتح';

const settingsFootnote = (appUrl: string) => ({
  text: 'تختار ما يصلك بالبريد من',
  link: { label: 'إعدادات الإشعارات', url: appLink(appUrl, '/notifications/settings') },
});

const NEW_NOTIFICATIONS: PluralForms = {
  zero: 'لا إشعارات جديدة',
  one: 'لديك إشعار جديد',
  two: 'لديك إشعاران جديدان',
  few: 'لديك {{n}} إشعارات جديدة',
  many: 'لديك {{n}} إشعارًا جديدًا',
  other: 'لديك {{n}} إشعار جديد',
};

const MORE_NOTIFICATIONS: PluralForms = {
  zero: '',
  one: 'وإشعار آخر',
  two: 'وإشعاران آخران',
  few: 'و{{n}} إشعارات أخرى',
  many: 'و{{n}} إشعارًا آخر',
  other: 'و{{n}} إشعار آخر',
};

const MORE_TASKS: PluralForms = {
  zero: '',
  one: 'ومهمة أخرى',
  two: 'ومهمتان أخريان',
  few: 'و{{n}} مهام أخرى',
  many: 'و{{n}} مهمة أخرى',
  other: 'و{{n}} مهمة أخرى',
};

const DAYS_LATE: PluralForms = {
  zero: 'مستحقة اليوم',
  one: 'متأخرة يومًا واحدًا',
  two: 'متأخرة يومين',
  few: 'متأخرة {{n}} أيام',
  many: 'متأخرة {{n}} يومًا',
  other: 'متأخرة {{n}} يوم',
};

const UNREAD: PluralForms = {
  zero: 'لا إشعارات غير مقروءة لديك.',
  one: 'لديك إشعار واحد غير مقروء.',
  two: 'لديك إشعاران غير مقروءين.',
  few: 'لديك {{n}} إشعارات غير مقروءة.',
  many: 'لديك {{n}} إشعارًا غير مقروء.',
  other: 'لديك {{n}} إشعار غير مقروء.',
};

const counted = (forms: PluralForms, count: number) =>
  fill(plural(forms, count), { n: formatNumber(count) });

type DepartmentNames = Partial<Record<DepartmentCode, string>>;

/** Rule 9: a notification as an email line: the bell's text, its context and time, "Open". */
function notificationItem(
  notification: Notification,
  departments: DepartmentNames,
  appUrl: string,
): EmailListItem {
  const { text, context } = notificationText(notification, (code) => departments[code] ?? '');
  const time = formatDateTime(notification.updatedAt);
  return {
    text,
    detail: context ? `${context} · ${time}` : time,
    link: { label: OPEN, url: appLink(appUrl, linkPath(notificationLink(notification))) },
  };
}

function notificationSection(
  title: string,
  list: { items: Notification[]; more: number },
  departments: DepartmentNames,
  appUrl: string,
): EmailSection {
  return {
    title,
    items: list.items.map((item) => notificationItem(item, departments, appUrl)),
    more:
      list.more > 0
        ? { label: counted(MORE_NOTIFICATIONS, list.more), url: appLink(appUrl, '/notifications') }
        : null,
  };
}

/** A subject within the outbox limit, cut with an ellipsis (a bell text can be longer). */
function subjectLine(text: string): string {
  return text.length <= EMAIL_LIMITS.subject ? text : `${text.slice(0, EMAIL_LIMITS.subject - 1)}…`;
}

/**
 * Rules 6–9: the recipient's new notifications. One item: its text is the subject; more:
 * "لديك n إشعارات جديدة".
 */
export function notificationBatchEmail(
  data: EmailData<'notification_batch'>,
  appUrl: string,
): EmailContent {
  const { items, more } = data.notifications;
  const total = items.length + more;
  const [first] = items;
  const subject =
    total === 1 && first
      ? subjectLine(notificationText(first, (code) => data.departments[code] ?? '').text)
      : counted(NEW_NOTIFICATIONS, total);
  return {
    subject,
    heading: counted(NEW_NOTIFICATIONS, total),
    paragraphs: ['هذه إشعاراتك التي لم تقرأها بعد في Vertex Hub.'],
    sections: [notificationSection('الإشعارات', data.notifications, data.departments, appUrl)],
    footnote: settingsFootnote(appUrl),
  };
}

function taskItem(task: DigestTask, appUrl: string): EmailListItem {
  const date = formatCalendarDate(task.dueDate);
  const due = task.dueTime ? `${date}، ${formatTimeOfDay(task.dueTime)}` : date;
  const late = task.daysLate > 0 ? counted(DAYS_LATE, task.daysLate) : null;
  return {
    text: task.title,
    detail: [task.client, due, late].filter(Boolean).join(' · '),
    link: { label: OPEN, url: appLink(appUrl, `/tasks/${task.id}`) },
  };
}

function taskSection(
  title: string,
  list: { items: DigestTask[]; more: number },
  appUrl: string,
): EmailSection {
  return {
    title,
    items: list.items.map((task) => taskItem(task, appUrl)),
    more:
      list.more > 0
        ? { label: counted(MORE_TASKS, list.more), url: appLink(appUrl, '/tasks') }
        : null,
  };
}

/** Rule 10: the morning digest: overdue tasks, tasks due today, notifications held overnight. */
export function digestEmail(data: EmailData<'digest'>, appUrl: string): EmailContent {
  const sections: EmailSection[] = [];
  if (data.overdue.items.length > 0) {
    sections.push(taskSection('مهام متأخرة', data.overdue, appUrl));
  }
  if (data.dueToday.items.length > 0) {
    sections.push(taskSection('مستحقة اليوم', data.dueToday, appUrl));
  }
  if (data.notifications.items.length > 0) {
    sections.push(
      notificationSection('إشعارات وصلتك منذ أمس', data.notifications, data.departments, appUrl),
    );
  }
  return {
    subject: `ملخص يومك في Vertex Hub · ${formatCalendarDate(data.date)}`,
    heading: 'صباح الخير، هذا ملخص يومك',
    paragraphs: [counted(UNREAD, data.unreadCount)],
    sections,
    action: { label: 'افتح مهامي', url: appLink(appUrl, '/tasks') },
    footnote: settingsFootnote(appUrl),
  };
}

const linkValidity = (expiresAt: string) =>
  `الرابط صالح لمرة واحدة حتى ${formatDateTime(expiresAt)}.`;

/** Rule 13: the activation link of a new, restored or re-invited user. */
export function accountActivationEmail(data: EmailData<'account_activation'>): EmailContent {
  return {
    subject: data.restored ? 'أُعيد تفعيل حسابك في Vertex Hub' : 'فعّل حسابك في Vertex Hub',
    heading: `أهلًا ${data.name}`,
    paragraphs: [
      data.restored
        ? 'أُعيد تفعيل حسابك في Vertex Hub. اختر كلمة مرور جديدة من الرابط أدناه للدخول.'
        : 'أُنشئ لك حساب في Vertex Hub، النظام الداخلي لـ Vertex Media. اختر كلمة مرورك من الرابط أدناه.',
      linkValidity(data.expiresAt),
    ],
    action: { label: 'اختيار كلمة المرور', url: data.link },
  };
}

/** Rule 13: a password reset link, from a user manager or asked for by the user. */
export function passwordResetEmail(data: EmailData<'password_reset'>): EmailContent {
  return {
    subject: 'إعادة تعيين كلمة المرور في Vertex Hub',
    heading: `أهلًا ${data.name}`,
    paragraphs: [
      data.requested
        ? 'طلبت إعادة تعيين كلمة مرورك. اختر كلمة مرور جديدة من الرابط أدناه.'
        : 'أرسل لك مدير المستخدمين رابطًا لإعادة تعيين كلمة مرورك.',
      linkValidity(data.expiresAt),
      'إن لم تطلب ذلك، تجاهل هذه الرسالة: كلمة مرورك الحالية لم تتغير.',
    ],
    action: { label: 'اختيار كلمة مرور جديدة', url: data.link },
  };
}

const SECURITY_CHANGE_TEXT: Record<SecurityChange, { subject: string; what: string }> = {
  password_changed: { subject: 'تغيّرت كلمة مرورك', what: 'تغيّرت كلمة مرور حسابك' },
  two_factor_enabled: {
    subject: 'فُعّل التحقق بخطوتين',
    what: 'فُعّل التحقق بخطوتين لحسابك',
  },
  two_factor_disabled: {
    subject: 'أُوقف التحقق بخطوتين',
    what: 'أُوقف التحقق بخطوتين لحسابك',
  },
  two_factor_reset: {
    subject: 'أُعيد ضبط التحقق بخطوتين',
    what: 'أُعيد ضبط التحقق بخطوتين لحسابك',
  },
  roles_changed: { subject: 'تغيّرت أدوارك', what: 'تغيّرت الأدوار المسندة إليك' },
  archived: { subject: 'أُرشف حسابك', what: 'أُرشف حسابك ولم يعد بإمكانك الدخول' },
};

/** Rule 14: a change on the account; these cannot be switched off. */
export function securityNoticeEmail(data: EmailData<'security_notice'>): EmailContent {
  const change = SECURITY_CHANGE_TEXT[data.change];
  const by = data.by ? `بواسطة ${data.by}` : 'بواسطتك';
  return {
    subject: `${change.subject} في Vertex Hub`,
    heading: `أهلًا ${data.name}`,
    paragraphs: [
      `${change.what} في ${formatDateTime(data.at)} ${by}.`,
      'إن لم تكن تتوقع هذا التغيير، تواصل فورًا مع مدير المستخدمين في الشركة.',
    ],
  };
}

/** Rule 15: a sign-in from a browser and system the user had not used. */
export function newDeviceEmail(data: EmailData<'new_device'>): EmailContent {
  const from = data.ip ? `${data.device} (العنوان ${data.ip})` : data.device;
  return {
    subject: 'تسجيل دخول من جهاز جديد إلى Vertex Hub',
    heading: `أهلًا ${data.name}`,
    paragraphs: [
      `سُجّل الدخول إلى حسابك في ${formatDateTime(data.at)} من ${from}.`,
      'إن كان هذا أنت فلا شيء عليك. وإن لم يكن، غيّر كلمة مرورك وتواصل مع مدير المستخدمين.',
    ],
  };
}
