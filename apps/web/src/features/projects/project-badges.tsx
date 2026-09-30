import { useQuery } from '@tanstack/react-query';
import type { DepartmentCode, ProjectStatus } from '@vertex-hub/contracts';
import { AscentMeter, Avatar, Badge } from '@vertex-hub/ui';
import { ArchiveIcon, CalendarClockIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatList, formatNumber } from '../../lib/format';
import { departmentListQuery } from '../departments/departments.queries';

/** Running work in the workflow colors; completed takes Vertex Green, like delivered work (§2). */
const statusTone = {
  planned: 'neutral',
  active: 'info',
  on_hold: 'warning',
  completed: 'brand',
  cancelled: 'danger',
} as const;

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const { t } = useTranslation();
  return (
    <Badge tone={statusTone[status]} data-status={status}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {t(`projects.statuses.${status}`)}
    </Badge>
  );
}

/** Past its due date while open (rule 10); with the number of days when known. */
export function OverdueBadge({ days }: { days?: number }) {
  const { t } = useTranslation();
  return (
    <Badge tone="danger">
      <CalendarClockIcon aria-hidden="true" />
      {days && days > 0
        ? t('projects.overdueBy', { count: days, days: formatNumber(days) })
        : t('projects.overdue')}
    </Badge>
  );
}

export function ArchivedBadge() {
  const { t } = useTranslation();
  return (
    <Badge tone="neutral">
      <ArchiveIcon aria-hidden="true" />
      {t('projects.archivedBadge')}
    </Badge>
  );
}

/** A person on a project, faded with a badge once their account is archived (edge case 8). */
export function PersonName({
  name,
  archived = false,
  size = 'sm',
}: {
  name: string;
  archived?: boolean;
  size?: 'sm' | 'md';
}) {
  const { t } = useTranslation();
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar name={name} size={size} tone={archived ? 'muted' : 'brand'} />
      <span className="truncate">{name}</span>
      {archived && <Badge tone="outline">{t('projects.archivedBadge')}</Badge>}
    </span>
  );
}

/** Department names by code; names are editable (F01), so they come from the API. */
export function useDepartmentNames(): (code: DepartmentCode) => string {
  const departments = useQuery(departmentListQuery);
  const names = new Map(departments.data?.items.map(({ code, name }) => [code, name]));
  return (code) => names.get(code) ?? '';
}

/** Participating departments as quiet chips; the rest folded into "+n" after `max`. */
export function DepartmentChips({
  codes,
  max = codes.length,
}: {
  codes: readonly DepartmentCode[];
  max?: number;
}) {
  const nameOf = useDepartmentNames();
  const loaded = useQuery(departmentListQuery).isSuccess;
  if (!loaded) return null;
  const shown = codes.slice(0, max);
  const hidden = codes.slice(max);
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((code) => (
        <Badge key={code} tone="outline">
          {nameOf(code)}
        </Badge>
      ))}
      {hidden.length > 0 && (
        <Badge tone="neutral" title={formatList(hidden.map(nameOf))}>
          +{formatNumber(hidden.length)}
        </Badge>
      )}
    </span>
  );
}

/** Milestones done out of all, as ascending steps; a dash when the project has none. */
export function MilestoneProgress({ progress }: { progress: { done: number; total: number } }) {
  const { t } = useTranslation();
  if (progress.total === 0)
    return <span className="text-muted-foreground">{t('common.none')}</span>;
  const label = t('projects.milestonesDone', {
    done: formatNumber(progress.done),
    total: formatNumber(progress.total),
  });
  return (
    <span className="flex items-center gap-2">
      <AscentMeter
        size="sm"
        value={progress.done}
        max={progress.total}
        tone="success"
        aria-label={label}
      />
      <span aria-hidden="true" className="text-xs text-muted-foreground tabular-nums">
        {formatNumber(progress.done)}/{formatNumber(progress.total)}
      </span>
    </span>
  );
}
