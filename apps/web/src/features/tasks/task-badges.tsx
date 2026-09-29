import type { Task, TaskPriority, TaskStatus } from '@vertex-hub/contracts';
import { Badge, cn, StatusBadge } from '@vertex-hub/ui';
import {
  ArchiveIcon,
  BanIcon,
  CalendarClockIcon,
  ChevronDownIcon,
  ChevronsUpIcon,
  ChevronUpIcon,
  EqualIcon,
  HourglassIcon,
  ListChecksIcon,
  MessageSquareWarningIcon,
  UserRoundXIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatCalendarDate, formatNumber, formatTimeOfDay } from '../../lib/format';
import { lineName } from '../retainers/retainer-badges';

/** A workflow status in its brand color; cancelled tasks are struck from the workflow. */
export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const { t } = useTranslation();
  if (status === 'cancelled') {
    return (
      <Badge tone="outline" data-status={status} className="text-muted-foreground">
        <BanIcon aria-hidden="true" />
        {t('tasks.statuses.cancelled')}
      </Badge>
    );
  }
  return <StatusBadge status={status}>{t(`tasks.statuses.${status}`)}</StatusBadge>;
}

const PRIORITY = {
  low: { tone: 'neutral', icon: ChevronDownIcon },
  normal: { tone: 'outline', icon: EqualIcon },
  high: { tone: 'warning', icon: ChevronUpIcon },
  urgent: { tone: 'danger', icon: ChevronsUpIcon },
} as const;

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const { t } = useTranslation();
  const { tone, icon: Icon } = PRIORITY[priority];
  return (
    <Badge tone={tone} data-priority={priority}>
      <Icon aria-hidden="true" />
      {t(`tasks.priorities.${priority}`)}
    </Badge>
  );
}

/** Open and past its due date and time in Asia/Damascus (rule 12). */
export function TaskOverdueBadge() {
  const { t } = useTranslation();
  return (
    <Badge tone="danger">
      <CalendarClockIcon aria-hidden="true" />
      {t('tasks.overdue')}
    </Badge>
  );
}

/** Waiting on unfinished work (rule 3). */
export function BlockedBadge() {
  const { t } = useTranslation();
  return (
    <Badge tone="warning">
      <HourglassIcon aria-hidden="true" />
      {t('tasks.blocked')}
    </Badge>
  );
}

/** An over-limit client revision waits for the account manager's decision (rule 10). */
export function OverLimitBadge() {
  const { t } = useTranslation();
  return (
    <Badge tone="danger">
      <MessageSquareWarningIcon aria-hidden="true" />
      {t('tasks.overLimitPending')}
    </Badge>
  );
}

export function TaskArchivedBadge() {
  const { t } = useTranslation();
  return (
    <Badge tone="neutral">
      <ArchiveIcon aria-hidden="true" />
      {t('tasks.archivedBadge')}
    </Badge>
  );
}

/** The assignee left the task's department and keeps the task until reassigned (edge case 4). */
export function NotInDepartmentBadge() {
  const { t } = useTranslation();
  return (
    <Badge tone="outline">
      <UserRoundXIcon aria-hidden="true" />
      {t('tasks.notInDepartment')}
    </Badge>
  );
}

/** Checklist items ticked out of all, as "3/5"; nothing when the task has none. */
export function ChecklistCount({ checklist }: { checklist: Task['checklist'] }) {
  const { t } = useTranslation();
  if (checklist.total === 0) return null;
  const done = checklist.done === checklist.total;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs',
        done ? 'font-medium text-foreground' : 'text-muted-foreground',
      )}
      title={t('tasks.checklistCount', {
        done: formatNumber(checklist.done),
        total: formatNumber(checklist.total),
      })}
    >
      <ListChecksIcon aria-hidden="true" className="size-3.5" />
      <span className="tabular-nums">
        {formatNumber(checklist.done)}/{formatNumber(checklist.total)}
      </span>
    </span>
  );
}

/** The due date, with the time when one is set. */
export function formatDue(task: Pick<Task, 'dueDate' | 'dueTime'>): string {
  const date = formatCalendarDate(task.dueDate);
  return task.dueTime ? `${date} · ${formatTimeOfDay(task.dueTime)}` : date;
}

/** Where the task belongs: its project and milestone, or its retainer and cycle line. */
export function useEngagementLabel(): (task: Task) => string | null {
  const { t } = useTranslation();
  return (task) => {
    if (task.project) {
      return task.milestone ? `${task.project.name} · ${task.milestone.name}` : task.project.name;
    }
    if (task.retainer) {
      return task.cycleLine
        ? `${task.retainer.name} · ${lineName(t, task.cycleLine)}`
        : task.retainer.name;
    }
    return null;
  };
}
