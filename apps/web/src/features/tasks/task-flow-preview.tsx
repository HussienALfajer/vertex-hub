import type { ReadinessWarning } from '@vertex-hub/contracts';
import { Avatar, cn, Tooltip, TooltipContent, TooltipTrigger } from '@vertex-hub/ui';
import { ArrowDownIcon, InboxIcon, TriangleAlertIcon } from 'lucide-react';
import { useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { formatCalendarDate, formatNumber } from '../../lib/format';
import { imageSrc } from '../../lib/images';
import { useDepartmentNames } from '../projects/project-badges';
import type { TaskFormMethods } from './task-form';
import { useActiveUsers } from './task-rich-text';
import { previewLayout } from './task-wizard-preview';
import { useWarningText } from './task-wizard-steps';

/**
 * F06B rule C1: the live preview of the draft's flow, beside the steps (below them on a phone):
 * the task, its subtasks as lanes by mode, their assignees and dates, and the readiness warnings
 * in place.
 */
export function FlowPreview({
  form,
  warnings,
}: {
  form: TaskFormMethods;
  warnings: ReadinessWarning[] | undefined;
}) {
  const { t } = useTranslation();
  const values = useWatch({ control: form.control });
  const layout = previewLayout(values as Parameters<typeof previewLayout>[0]);
  const subtasks = values.subtasks ?? [];
  const warningsOf = (index: number | null) =>
    (warnings ?? []).filter((warning) => warning.subtaskIndex === index);
  return (
    <div
      className="flex flex-col gap-3"
      data-testid="flow-preview"
      data-mode={layout.mode ?? 'none'}
    >
      <PreviewCard
        title={values.title || t('tasks.wizard.review.noTitle')}
        department={values.department}
        assigneeId={values.assigneeId ?? null}
        dueDate={values.dueDate}
        warnings={warningsOf(null)}
        parent
      />
      {layout.mode && (
        <>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ArrowDownIcon aria-hidden="true" className="size-3.5" />
            {t('tasks.wizard.preview.subtasks', {
              n: formatNumber(subtasks.length),
              mode: t(`tasks.subtasks.runModes.${layout.mode}`),
            })}
          </p>
          <div
            className={cn(
              'flex gap-2',
              layout.direction === 'vertical' ? 'flex-col' : 'overflow-x-auto pb-1',
            )}
          >
            {layout.lanes.map((lane, laneIndex) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: lanes follow the draft's order
                key={laneIndex}
                data-testid="preview-lane"
                className={cn(
                  'flex flex-col gap-2',
                  layout.direction === 'horizontal' && 'min-w-28 flex-1',
                  lane.name !== null && 'rounded-md bg-muted/60 p-2',
                )}
              >
                {lane.name !== null && (
                  <p className="truncate text-xs font-medium">
                    {formatNumber(laneIndex + 1)}. {lane.name}
                  </p>
                )}
                {lane.items.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t('tasks.wizard.subtasks.emptyStage')}
                  </p>
                )}
                {lane.items.map((item, position) => {
                  const subtask = subtasks[item.index];
                  return (
                    <div key={item.index} className="flex flex-col items-stretch gap-2">
                      {layout.mode === 'sequential' && position > 0 && (
                        <ArrowDownIcon
                          aria-hidden="true"
                          className="size-3.5 self-center text-muted-foreground"
                        />
                      )}
                      <PreviewCard
                        title={
                          item.title ||
                          t('tasks.wizard.subtasks.untitled', { n: formatNumber(item.index + 1) })
                        }
                        department={subtask?.department}
                        assigneeId={subtask?.assigneeId ?? null}
                        dueDate={subtask?.dueDate}
                        warnings={warningsOf(item.index)}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PreviewCard({
  title,
  department,
  assigneeId,
  dueDate,
  warnings,
  parent,
}: {
  title: string;
  department: string | undefined;
  assigneeId: string | null;
  dueDate: string | undefined;
  warnings: ReadinessWarning[];
  parent?: boolean;
}) {
  const { t } = useTranslation();
  const departmentName = useDepartmentNames();
  const text = useWarningText();
  const assignee = useActiveUsers().find((user) => user.id === assigneeId);
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-md border border-border bg-surface p-2.5 text-xs',
        parent && 'border-primary',
        warnings.length > 0 && 'border-status-warning-foreground',
      )}
    >
      <div className="flex items-start gap-1.5">
        <span className={cn('min-w-0 flex-1 truncate font-medium', parent && 'text-sm')}>
          {title}
        </span>
        {warnings.length > 0 && (
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  role="img"
                  aria-label={warnings.map(text).join(' · ')}
                  className="text-status-warning-foreground"
                />
              }
            >
              <TriangleAlertIcon aria-hidden="true" className="size-4" />
            </TooltipTrigger>
            <TooltipContent>{warnings.map(text).join(' · ')}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {assignee ? (
          <Avatar name={assignee.name} src={imageSrc(assignee.imageId, 'sm')} size="sm" />
        ) : (
          <InboxIcon aria-hidden="true" className="size-3.5" />
        )}
        <span className="truncate">
          {assignee?.name ??
            (department
              ? t('tasks.wizard.preview.queue', {
                  department: departmentName(department as Parameters<typeof departmentName>[0]),
                })
              : t('tasks.unassigned'))}
        </span>
      </div>
      {dueDate && (
        <span className="text-muted-foreground tabular-nums">{formatCalendarDate(dueDate)}</span>
      )}
    </div>
  );
}
