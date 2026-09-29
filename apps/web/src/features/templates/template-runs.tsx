import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { TemplateRun } from '@vertex-hub/contracts';
import { Badge } from '@vertex-hub/ui';
import { LayersIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDateTime, formatNumber } from '../../lib/format';
import { lineName } from '../retainers/retainer-badges';
import { templateRunsQuery } from './templates.queries';

/** A project shows its latest runs; older ones stay in the audit log. */
const PROJECT_RUNS = 10;

/** Spec screen 5: a line per run above the project's tasks, newest first. */
export function ProjectRunLines({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const runs = useQuery(templateRunsQuery({ projectId, pageSize: PROJECT_RUNS }));
  // The tasks below are the substance; the lines add to them and stay out when they fail to load.
  if (!runs.data || runs.data.items.length === 0) return null;
  return (
    <ul
      aria-label={t('templates.runs.title')}
      className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface"
    >
      {runs.data.items.map((run) => (
        <li key={run.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
          <LayersIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <RunSentence run={run} />
          <Badge tone="neutral" className="ms-auto tabular-nums">
            {t('templates.generate.taskCount', {
              count: run.taskCount,
              n: formatNumber(run.taskCount),
            })}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

/**
 * "Generated from <template> on <date> by <name>", or "automatically" for runs without a creator;
 * `missing_tasks` runs name the line they filled.
 */
export function RunSentence({ run }: { run: TemplateRun }) {
  const { t } = useTranslation();
  const when = formatDateTime(run.createdAt);
  return (
    <span className="min-w-0">
      {run.trigger === 'missing_tasks'
        ? t('templates.runs.missingFrom', { line: run.cycleLine ? lineName(t, run.cycleLine) : '' })
        : t('templates.runs.from')}{' '}
      <Link
        to="/templates/$templateId"
        params={{ templateId: run.template.id }}
        className="font-medium hover:underline"
      >
        {run.template.name}
      </Link>{' '}
      <span className="text-muted-foreground">
        {run.createdBy
          ? t('templates.runs.by', { when, name: run.createdBy.name })
          : t('templates.runs.automatic', { when })}
      </span>
    </span>
  );
}

/** Spec screen 7: the template a task was generated from, read from the runs (`?taskId=`). */
export function TaskTemplateOrigin({ taskId }: { taskId: string }) {
  const { t } = useTranslation();
  const runs = useQuery(templateRunsQuery({ taskId, pageSize: 1 }));
  const run = runs.data?.items[0];
  if (!run) return null;
  return (
    <p className="flex items-start gap-2 text-sm">
      <LayersIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span>
        {run.createdBy ? t('templates.origin.generated') : t('templates.origin.automatic')}{' '}
        <Link
          to="/templates/$templateId"
          params={{ templateId: run.template.id }}
          className="font-medium hover:underline"
        >
          {run.template.name}
        </Link>{' '}
        <span className="text-muted-foreground">
          {t('templates.origin.on', { when: formatDateTime(run.createdAt) })}
        </span>
      </span>
    </p>
  );
}
