import type { ToOptions } from '@tanstack/react-router';
import type { DepartmentCode, Notification } from '@vertex-hub/contracts';
import type { TFunction } from 'i18next';
import {
  formatCalendarDate,
  formatDateTime,
  formatList,
  formatNumber,
  formatTimeOfDay,
} from '../../lib/format';

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
    case 'approval_request':
      return { to: '/approvals/requests/$requestId', params: { requestId: subject.id } };
    case 'post':
      return { to: '/content/posts/$postId', params: { postId: subject.id } };
    case 'shoot':
      return { to: '/shoots/$shootId', params: { shootId: subject.id } };
    case 'meeting':
      return { to: '/meetings/$meetingId', params: { meetingId: subject.id } };
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
    case 'approval_responded': {
      const { data, count } = notification;
      return {
        text:
          count > 1
            ? t('notifications.text.approval_responded_merged', {
                count,
                n: formatNumber(count),
                client: data.client,
                contact: data.contact,
              })
            : t(`notifications.text.approval_responded.${data.decision}`, {
                client: data.client,
                contact: data.contact,
              }),
        context: null,
      };
    }
    case 'approval_no_response':
    case 'approval_expired':
      return {
        text: t(`notifications.text.${notification.type}`, {
          client: notification.data.client,
          contact: notification.data.contact,
        }),
        context: null,
      };
    case 'post_returned':
    case 'post_approved':
      return {
        text: t(`notifications.text.${notification.type}.${notification.data.source}`, {
          actor,
          post: notification.data.post.title,
        }),
        context: notification.data.post.client,
      };
    case 'post_task_ready':
      return {
        text: t('notifications.text.post_task_ready', {
          task: notification.data.taskTitle,
          post: notification.data.post.title,
        }),
        context: notification.data.post.client,
      };
    case 'post_task_unlinked':
      return {
        text: t(`notifications.text.post_task_unlinked.${notification.data.reason}`, {
          task: notification.data.taskTitle,
          post: notification.data.post.title,
        }),
        context: notification.data.post.client,
      };
    case 'post_assigned':
    case 'post_review_requested':
    case 'post_medical_review_requested':
    case 'post_awaiting_client':
    case 'post_publish_today':
    case 'post_publish_overdue': {
      const { post } = notification.data;
      return {
        text: t(`notifications.text.${notification.type}`, {
          actor,
          post: post.title,
          date: formatPublish(t, post),
        }),
        context: post.client,
      };
    }
    case 'shoot_booked':
    case 'shoot_upcoming':
    case 'shoot_not_closed':
    case 'shoot_dropped':
    case 'shoot_changed': {
      const { shoot } = notification.data;
      const values = { actor, shoot: shoot.title, when: formatDateTime(shoot.startsAt) };
      return {
        text: calendarText(t, notification, values),
        context: context(shoot.client, shoot.location),
      };
    }
    case 'meeting_invited':
    case 'meeting_upcoming':
    case 'meeting_dropped':
    case 'meeting_changed': {
      const { meeting } = notification.data;
      const values = { actor, meeting: meeting.title, when: formatDateTime(meeting.startsAt) };
      return { text: calendarText(t, notification, values), context: meeting.client };
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

function formatPublish(
  t: TFunction,
  post: { publishDate: string; publishTime: string | null },
): string {
  return formatDue(t, { dueDate: post.publishDate, dueTime: post.publishTime });
}

type CalendarNotification = Extract<
  Notification,
  { type: `shoot_${string}` | `meeting_${string}` }
>;

function calendarText(
  t: TFunction,
  notification: CalendarNotification,
  values: { actor: string; when: string; shoot?: string; meeting?: string },
): string {
  switch (notification.type) {
    case 'shoot_dropped':
    case 'meeting_dropped':
      return t(`notifications.text.${notification.type}.${notification.data.cause}`, values);
    case 'shoot_changed':
      return t('notifications.text.shoot_changed', {
        ...values,
        changes: formatList(
          notification.data.changes.map((change) => t(`notifications.changes.shoot.${change}`)),
        ),
      });
    case 'meeting_changed':
      return t('notifications.text.meeting_changed', {
        ...values,
        changes: formatList(
          notification.data.changes.map((change) => t(`notifications.changes.meeting.${change}`)),
        ),
      });
    default:
      return t(`notifications.text.${notification.type}`, values);
  }
}

type TaskNotification = Exclude<
  Notification,
  {
    type:
      | 'tasks_generated'
      | 'client_account_manager_assigned'
      | 'project_manager_assigned'
      | 'retainer_renewal_due'
      | 'approval_responded'
      | 'approval_no_response'
      | 'approval_expired'
      | `post_${string}`
      | CalendarNotification['type'];
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
    case 'task_file_added':
      return notification.count > 1
        ? t('notifications.text.task_file_added_merged', {
            count: notification.count,
            n: formatNumber(notification.count),
            task,
          })
        : t('notifications.text.task_file_added', { actor, task, file: notification.data.file });
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
