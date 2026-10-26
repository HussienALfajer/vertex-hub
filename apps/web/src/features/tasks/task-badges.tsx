import { Link } from '@tanstack/react-router';
import type { ReviewStage, Task, TaskPriority, TaskStatus } from '@vertex-hub/contracts';
import { Badge, cn, Meter, StatusBadge } from '@vertex-hub/ui';
import {
  ArchiveIcon,
  BanIcon,
  CalendarClockIcon,
  ChevronDownIcon,
  ChevronsUpIcon,
  ChevronUpIcon,
  CircleHelpIcon,
  CornerDownLeftIcon,
  EqualIcon,
  HourglassIcon,
  ListChecksIcon,
  ListTreeIcon,
  MessageSquareWarningIcon,
  StethoscopeIcon,
  UserRoundXIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatCalendarDate, formatNumber, formatTimeOfDay } from '../../lib/format';
import { lineName } from '../retainers/retainer-badges';

/**
 * A workflow status in its brand color; cancelled tasks are struck from the workflow. With the
 * `stage`, internal review names its medical stage (F09 rule 4).
 */
export function TaskStatusBadge({
  status,
  stage,
}: {
  status: TaskStatus;
  stage?: ReviewStage | null;
}) {
  const { t } = useTranslation();
  if (status === 'cancelled') {
    return (
      <Badge tone="outline" data-status={status} className="text-muted-foreground">
        <BanIcon aria-hidden="true" />
        {t('tasks.statuses.cancelled')}
      </Badge>
    );
  }
  return (
    <StatusBadge status={status}>
      {stage === 'medical' ? t('tasks.medicalStatus') : t(`tasks.statuses.${status}`)}
    </StatusBadge>
  );
}

/** In the medical stage of internal review: waiting for Medical Consultation (F09 rule 4). */
export function MedicalBadge() {
  const { t } = useTranslation();
  return (
    <Badge tone="info">
      <StethoscopeIcon aria-hidden="true" />
      {t('tasks.medicalBadge')}
    </Badge>
  );
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

/** F06B rule A13: a subtask names its parent, linked. */
export function SubtaskOfBadge({ parent }: { parent: NonNullable<Task['parent']> }) {
  const { t } = useTranslation();
  return (
    <Badge tone="outline" render={<Link to="/tasks/$taskId" params={{ taskId: parent.id }} />}>
      <CornerDownLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
      <span className="max-w-48 truncate">{t('tasks.subtasks.of', { title: parent.title })}</span>
    </Badge>
  );
}

/** F06B rule A9: a parent's delivered subtasks out of its live ones, as "3/5". */
export function SubtaskProgress({
  progress,
  bar,
}: {
  progress: NonNullable<Task['progress']>;
  /** With a bar, as the task page's header shows it. */
  bar?: boolean;
}) {
  const { t } = useTranslation();
  const label = t('tasks.subtasks.progress', {
    delivered: formatNumber(progress.delivered),
    total: formatNumber(progress.total),
  });
  const done = progress.total > 0 && progress.delivered === progress.total;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs',
        done ? 'font-medium text-foreground' : 'text-muted-foreground',
      )}
    >
      <ListTreeIcon aria-hidden="true" className="size-3.5" />
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className="tabular-nums">
        {formatNumber(progress.delivered)}/{formatNumber(progress.total)}
      </span>
      {bar && (
        <Meter
          value={progress.total === 0 ? 0 : (progress.delivered / progress.total) * 100}
          aria-label={label}
          className="w-28"
        />
      )}
    </span>
  );
}

/** F06B rule B7 and edge case 13: open questions of the task and of its subtasks. */
export function OpenQuestionsBadge({ open }: { open: Task['openQuestions'] }) {
  const { t } = useTranslation();
  if (open.total === 0) return null;
  const own = open.total - open.inSubtasks;
  return (
    <Badge tone="gold">
      <CircleHelpIcon aria-hidden="true" />
      {open.inSubtasks > 0
        ? t('tasks.questions.openWithSubtasks', {
            own: formatNumber(own),
            inSubtasks: formatNumber(open.inSubtasks),
          })
        : t('tasks.questions.openCount', { total: formatNumber(open.total) })}
    </Badge>
  );
}
