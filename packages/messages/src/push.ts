import { type DepartmentCode, type Notification, pushText } from '@vertex-hub/contracts';
import { formatNumber } from './format.js';
import { escalatedOriginal, NOTIFICATION_TEXT, notificationText } from './notifications.js';
import { fill } from './text.js';

/*
 * The texts of a push on the lock screen (spec F16 rules A8–A9): the notification's own text,
 * cut to 140 characters, and never a money amount (owner, 2026-10-20).
 */

/** The title of a push without a context line, and of the test push. */
export const PUSH_APP_NAME = 'Vertex Hub';

export const PUSH_TEXT = {
  /** Rule A9: the bell text names the balance and the threshold; the push names neither. */
  ad_budget_low: 'رصيد إعلانات {{client}} منخفض',
  /** Rule A9: the bell text names the reduction's amount; the push does not. */
  retainer_amendment_pending: 'طلب {{actor}} اعتماد التعديل {{number}} على عقد «{{retainer}}»',
  test: 'وصلت الإشعارات إلى هذا الجهاز',
  /** Rule B14: the morning summary. */
  morning: '{{overdue}} متأخرة · {{dueToday}} مستحقة اليوم · {{needsYou}} تحتاجك',
} as const;

/** The title and body of a notification's push. */
export function notificationPush(
  notification: Notification,
  departmentName: (code: DepartmentCode) => string,
): { title: string; body: string } {
  const { text, context } = notificationText(notification, departmentName);
  return {
    title: pushText(context ?? PUSH_APP_NAME),
    body: pushText(withoutAmount(notification) ?? text),
  };
}

/** The push variant of the types whose bell text holds an amount. */
function withoutAmount(notification: Notification): string | null {
  switch (notification.type) {
    case 'ad_budget_low':
      return fill(PUSH_TEXT.ad_budget_low, { client: notification.data.client });
    case 'retainer_amendment_pending':
      return fill(PUSH_TEXT.retainer_amendment_pending, {
        actor: notification.actor?.name ?? notification.data.creator,
        number: formatNumber(notification.data.number),
        retainer: notification.data.retainer,
      });
    case 'action_reminder':
    case 'action_escalated':
    case 'action_escalated_top': {
      // Rule B11: a step wraps its original's text, so it takes the original's push variant.
      const original = escalatedOriginal(notification);
      const inner = original && withoutAmount(original);
      return inner ? fill(NOTIFICATION_TEXT[notification.type], { text: inner }) : null;
    }
    default:
      return null;
  }
}

/** Rule B14: the morning summary push: overdue tasks, tasks due today, "Needs you". */
export function morningPush(counts: { overdue: number; dueToday: number; needsYou: number }): {
  title: string;
  body: string;
} {
  return {
    title: PUSH_APP_NAME,
    body: fill(PUSH_TEXT.morning, {
      overdue: formatNumber(counts.overdue),
      dueToday: formatNumber(counts.dueToday),
      needsYou: formatNumber(counts.needsYou),
    }),
  };
}

/** Rule A12: the test push. */
export function testPush(): { title: string; body: string } {
  return { title: PUSH_APP_NAME, body: PUSH_TEXT.test };
}
