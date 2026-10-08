import { Link } from '@tanstack/react-router';
import type { Task } from '@vertex-hub/contracts';
import { Avatar, cn } from '@vertex-hub/ui';
import { useTranslation } from 'react-i18next';
import { useDepartmentNames } from '../projects/project-badges';
import {
  BlockedBadge,
  ChecklistCount,
  formatDue,
  MedicalBadge,
  OverLimitBadge,
  PriorityBadge,
  TaskOverdueBadge,
  TaskStatusBadge,
  useEngagementLabel,
} from './task-badges';

/**
 * Tasks as compact rows: title with where it belongs, then status, priority, due date and the
 * signals that need attention (overdue, blocked, over the revision limit).
 */
export function TaskRows({
  tasks,
  showAssignee,
  inEngagement,
}: {
  tasks: Task[];
  showAssignee?: boolean;
  /** Rows on a project's page, grouped by milestone: only the department says where they belong. */
  inEngagement?: boolean;
}) {
  const { t } = useTranslation();
  const engagementOf = useEngagementLabel();
  const departmentName = useDepartmentNames();
  return (
    <ul className="flex flex-col divide-y divide-border">
      {tasks.map((task) => {
        const engagement = engagementOf(task);
        return (
          <li
            key={task.id}
            className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:gap-4"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Link
                to="/tasks/$taskId"
                params={{ taskId: task.id }}
                className={cn(
                  'w-fit font-medium hover:underline',
                  task.status === 'cancelled' && 'text-muted-foreground line-through',
                )}
              >
                {task.title}
              </Link>
              <span className="truncate text-xs text-muted-foreground">
                {[
                  !inEngagement && (task.client?.name ?? t('tasks.internal')),
                  !inEngagement && engagement,
                  departmentName(task.department),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {showAssignee &&
                (task.assignee ? (
                  <span className="flex items-center gap-1.5 text-sm">
                    <Avatar
                      name={task.assignee.name}
                      size="sm"
                      tone={task.assignee.archived ? 'muted' : 'brand'}
                    />
                    {task.assignee.name}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">{t('tasks.unassigned')}</span>
                ))}
              <TaskStatusBadge status={task.status} />
              {task.reviewStage === 'medical' && <MedicalBadge />}
              <PriorityBadge priority={task.priority} />
              {task.blocked && <BlockedBadge />}
              {task.overLimitPending && <OverLimitBadge />}
              <ChecklistCount checklist={task.checklist} />
              <span className="flex items-center gap-2 text-sm tabular-nums">
                {formatDue(task)}
                {task.overdue && <TaskOverdueBadge />}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
