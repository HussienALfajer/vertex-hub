import type { ToOptions } from '@tanstack/react-router';
import type { DepartmentCode, Notification } from '@vertex-hub/contracts';
import type { TFunction } from 'i18next';
import { formatCalendarDate, formatNumber, formatTimeOfDay } from '../../lib/format';

/** What a notification opens (F14 rule 15). */
export function notificationLink(notification: Notification): ToOptions {
  const { subject } = notification;
  if (notification.type === 'tasks_generated') {
    // No run filter on the task list (owner decision): the assignee's newest tasks, or the
    // department's unassigned queue for its managers.
    return notification.data.unassigned
      ? {
          to: '/tasks/list',
          search: { department: [notification.data.department], assignee: 'unassigned' },
        }
      : { to: '/tasks/list', search: { assignee: 'me', sort: 'createdAt', order: 'desc' } };
  }
  switch (subject.type) {
    case 'client':
      return { to: '/clients/$clientId', params: { clientId: subject.id } };
    case 'project':
      return { to: '/projects/$projectId', params: { projectId: subject.id } };
    case 'retainer':
      return { to: '/retainers/$retainerId', params: { retainerId: subject.id } };
    default:
      return { to: '/tasks/$taskId', params: { taskId: subject.id } };
  }
}

function formatDue(t: TFunction, due: { dueDate: string; dueTime: string | null }): string {
  const date = formatCalendarDate(due.dueDate);
  return due.dueTime
    ? t('notifications.dueAt', { date, time: formatTimeOfDay(due.dueTime) })
    : date;
}

/**
 * The rendered text of a notification and its context line (client and project), from its type
 * and snapshot (ADR 0018: nothing user-facing is stored as text).
 */
export function notificationText(
  t: TFunction,
  notification: Notification,
  departmentName: (code: DepartmentCode) => string,
): { text: string; context: string | null } {
  const actor = notification.actor?.name ?? t('notifications.system');
  const context = (...parts: (string | null)[]) => parts.filter(Boolean).join(' · ') || null;
  switch (notification.type) {
    case 'tasks_generated': {
      const { data } = notification;
      const values = {
        count: data.count,
        n: formatNumber(data.count),
        template: data.template,
        department: departmentName(data.department) || data.department,
      };
      return {
        text: data.unassigned
          ? t('notifications.text.tasks_generated_queued', values)
          : t('notifications.text.tasks_generated_assigned', values),
        context: context(data.client, data.project ?? data.retainer),
      };
    }
    case 'client_account_manager_assigned':
      return {
        text: t('notifications.text.client_account_manager_assigned', {
          actor,
          client: notification.data.client,
        }),
        context: null,
      };
    case 'project_manager_assigned':
      return {
        text: t('notifications.text.project_manager_assigned', {
          actor,
          project: notification.data.project,
        }),
        context: notification.data.client,
      };
    case 'retainer_renewal_due': {
      const { data } = notification;
      return {
        text:
          data.daysLeft === 0
            ? t('notifications.text.retainer_renewal_reached', { retainer: data.retainer })
            : t('notifications.text.retainer_renewal_due', {
                count: data.daysLeft,
                n: formatNumber(data.daysLeft),
                retainer: data.retainer,
              }),
        context: context(data.client, formatCalendarDate(data.renewalDate)),
      };
    }
    default: {
      const { task } = notification.data;
      return {
        text: taskText(t, notification, actor),
        context: context(task.client, task.project),
      };
    }
  }
}

type TaskNotification = Exclude<
  Notification,
  {
    type:
      | 'tasks_generated'
      | 'client_account_manager_assigned'
      | 'project_manager_assigned'
      | 'retainer_renewal_due';
  }
>;

function taskText(t: TFunction, notification: TaskNotification, actor: string): string {
  const task = notification.data.task.title;
  switch (notification.type) {
    case 'task_returned':
      return t(`notifications.text.task_returned.${notification.data.source}`, { actor, task });
    case 'task_approved':
      return t(`notifications.text.task_approved.${notification.data.source}`, { actor, task });
    case 'task_changed': {
      const { change, to } = notification.data;
      if (change !== 'due') return t(`notifications.text.task_changed.${change}`, { actor, task });
      return to
        ? t('notifications.text.task_changed.due', { actor, task, due: formatDue(t, to) })
        : t('notifications.text.task_changed.dueCleared', { actor, task });
    }
    case 'task_commented':
      return notification.count > 1
        ? t('notifications.text.task_commented_merged', {
            count: notification.count,
            n: formatNumber(notification.count),
            task,
          })
        : t('notifications.text.task_commented', { actor, task });
    case 'request_finished':
      return t(`notifications.text.request_finished.${notification.data.outcome}`, { task });
    case 'task_due_soon':
    case 'task_overdue':
      return t(`notifications.text.${notification.type}`, {
        task,
        due: formatDue(t, notification.data),
      });
    case 'task_overdue_escalated': {
      const { assignee } = notification.data;
      const due = formatDue(t, notification.data);
      return assignee
        ? t('notifications.text.task_overdue_escalated.assigned', { task, assignee, due })
        : t('notifications.text.task_overdue_escalated.unassigned', { task, due });
    }
    default:
      return t(`notifications.text.${notification.type}`, { actor, task });
  }
}
