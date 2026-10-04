import { useQuery } from '@tanstack/react-query';
import { addDays, businessDate, type MyTaskSummary, weekOf } from '@vertex-hub/contracts';
import { Badge, cn, Skeleton } from '@vertex-hub/ui';
import {
  CalendarClockIcon,
  CalendarDaysIcon,
  CircleCheckBigIcon,
  ListTodoIcon,
  type LucideIcon,
  SunIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { formatNumber } from '../../lib/format';
import { TaskRows } from '../tasks/task-rows';
import { myTaskSummaryQuery, type TaskListFilters, taskListQuery } from '../tasks/tasks.queries';
import { DashboardSection, SeeLink } from './dashboard-parts';

/** Rule 5: up to this many tasks per group; My tasks has the rest. */
const GROUP_SIZE = 10;

interface Group {
  key: 'overdue' | 'today' | 'thisWeek';
  icon: LucideIcon;
  filters: TaskListFilters;
  alert?: boolean;
}

/** As F06 My tasks: overdue, due today, and due later this week (to Friday). */
function groupsFor(today: string): Group[] {
  const mine = { assigneeId: 'me' } as const;
  return [
    { key: 'overdue', icon: CalendarClockIcon, alert: true, filters: { ...mine, overdue: 'true' } },
    {
      key: 'today',
      icon: SunIcon,
      filters: { ...mine, dueFrom: today, dueTo: today, overdue: 'false' },
    },
    {
      key: 'thisWeek',
      icon: CalendarDaysIcon,
      filters: { ...mine, dueFrom: addDays(today, 1), dueTo: weekOf(today).to },
    },
  ];
}

/** Rule 5: everyone's own work, from the F06 counts and list. */
export function MyWorkSection() {
  const { t } = useTranslation();
  const summary = useQuery(myTaskSummaryQuery);
  return (
    <DashboardSection
      id="work"
      title={t('dashboard.work.title')}
      icon={ListTodoIcon}
      query={summary}
      loadError={t('dashboard.work.loadError')}
      isEmpty={(data) => data.overdue + data.today + data.thisWeek === 0}
      empty={{
        icon: <CircleCheckBigIcon />,
        title: t('dashboard.work.emptyTitle'),
        description: t('dashboard.work.emptyHint'),
      }}
      actions={<SeeLink to="/tasks" label={t('dashboard.work.openMyTasks')} />}
    >
      {(data) => <Groups summary={data} />}
    </DashboardSection>
  );
}

function Groups({ summary }: { summary: MyTaskSummary }) {
  const groups = groupsFor(businessDate()).filter((group) => summary[group.key] > 0);
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <TaskGroup key={group.key} group={group} count={summary[group.key]} />
      ))}
    </div>
  );
}

function TaskGroup({ group, count }: { group: Group; count: number }) {
  const { t } = useTranslation();
  const tasks = useQuery(taskListQuery({ ...group.filters, pageSize: GROUP_SIZE }));
  const { icon: Icon } = group;
  const titleId = `dashboard-work-${group.key}`;
  return (
    <section
      aria-labelledby={titleId}
      className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border"
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Icon
          aria-hidden="true"
          className={cn('size-4', group.alert ? 'text-destructive-text' : 'text-muted-foreground')}
        />
        <h3 id={titleId} className="font-bold">
          {t(`tasks.my.sections.${group.key}`)}
        </h3>
        <Badge tone={group.alert ? 'danger' : 'neutral'} className="tabular-nums">
          {formatNumber(count)}
        </Badge>
      </div>
      {tasks.isPending ? (
        <div className="flex flex-col gap-2 p-4">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : tasks.isError ? (
        <div className="p-4">
          <LoadError message={t('dashboard.work.loadError')} onRetry={() => tasks.refetch()} />
        </div>
      ) : (
        <TaskRows tasks={tasks.data.items} />
      )}
    </section>
  );
}
