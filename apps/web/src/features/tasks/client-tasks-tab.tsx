import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ClientDetailResponse } from '@vertex-hub/contracts';
import { Button, EmptyState, Skeleton } from '@vertex-hub/ui';
import { ArrowLeftIcon, ListTodoIcon, PlusIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { TabHeader } from '../../components/tab-header';
import { formatNumber } from '../../lib/format';
import { TaskRows } from './task-rows';
import { taskListQuery } from './tasks.queries';

/** Open tasks shown on the profile; the rest are one click away in the list. */
const TAB_SIZE = 100;

/**
 * The Open tasks tab of the client profile (F02, spec screen 9): the client's open tasks,
 * over-limit decisions pending first, with "New task" preset to the client.
 */
export function ClientTasksTab({ client }: { client: ClientDetailResponse }) {
  const { t } = useTranslation();
  const tasks = useQuery(taskListQuery({ clientId: client.id, pageSize: TAB_SIZE }));
  // Rule 7: tasks link only to a non-archived client that is active or paused.
  const canCreate = client.archivedAt === null && client.status !== 'ended';
  const newTask = canCreate && (
    <Button size="sm" render={<Link to="/tasks/new" search={{ clientId: client.id }} />}>
      <PlusIcon />
      {t('tasks.actions.new')}
    </Button>
  );
  // The list comes by due date; a stable sort keeps that order within each group.
  const items = [...(tasks.data?.items ?? [])].sort(
    (a, b) => Number(b.overLimitPending) - Number(a.overLimitPending),
  );

  return (
    <>
      <TabHeader
        title={t('tasks.clientTab.title')}
        description={t('tasks.clientTab.hint')}
        action={items.length > 0 && newTask}
      />
      {tasks.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : tasks.isError ? (
        <LoadError message={t('tasks.list.loadError')} onRetry={() => tasks.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ListTodoIcon />}
          title={t('tasks.clientTab.emptyTitle')}
          description={canCreate ? t('tasks.clientTab.emptyHint') : undefined}
          action={newTask}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <TaskRows tasks={items} showAssignee />
          </div>
          {tasks.data.total > items.length && (
            <Button
              variant="outline"
              className="self-start"
              render={<Link to="/tasks/list" search={{ clientId: client.id }} />}
            >
              {t('tasks.clientTab.seeAll', { n: formatNumber(tasks.data.total) })}
              <ArrowLeftIcon className="ltr:-scale-x-100" />
            </Button>
          )}
        </div>
      )}
    </>
  );
}
