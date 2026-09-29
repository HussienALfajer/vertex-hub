import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  type ClientDetailResponse,
  isProjectClosed,
  RETAINER_STATUSES,
  type Retainer,
} from '@vertex-hub/contracts';
import { Button, Callout, EmptyState, Skeleton } from '@vertex-hub/ui';
import { PlusIcon, RepeatIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { TabHeader } from '../../components/tab-header';
import { useMe } from '../../lib/auth';
import { formatMonth, formatNumber } from '../../lib/format';
import { clientProjectsQuery } from '../projects/client-projects-tab';
import { canCreateProjectFor } from '../projects/project-access';
import {
  BehindBadge,
  CycleCounters,
  DeliveryRate,
  RenewalBadge,
  RetainerStatusBadge,
} from './retainer-badges';
import { retainerListQuery } from './retainers.queries';

/** A client's retainers of every status, running ones first, then ended ones. */
export const clientRetainersQuery = (clientId: string) =>
  retainerListQuery({ clientId, status: [...RETAINER_STATUSES], pageSize: 100 });

/** The Retainers tab of the client profile (F02), with "New retainer" preset to the client. */
export function ClientRetainersTab({ client }: { client: ClientDetailResponse }) {
  const { t } = useTranslation();
  const me = useMe();
  const retainers = useQuery(clientRetainersQuery(client.id));
  // Rule 1: retainers start only for a non-archived client that is active or paused.
  const canCreate =
    client.archivedAt === null &&
    client.status !== 'ended' &&
    canCreateProjectFor(me, client.accountManager.id);
  const newRetainer = canCreate && (
    <Button size="sm" render={<Link to="/retainers/new" search={{ clientId: client.id }} />}>
      <PlusIcon />
      {t('retainers.newRetainer')}
    </Button>
  );

  const items = [...(retainers.data?.items ?? [])].sort(
    (a, b) => Number(a.status === 'ended') - Number(b.status === 'ended'),
  );

  return (
    <>
      <TabHeader
        title={t('retainers.clientTab.title')}
        description={t('retainers.clientTab.hint')}
        action={items.length > 0 && newRetainer}
      />
      {retainers.isPending ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      ) : retainers.isError ? (
        <LoadError message={t('retainers.loadError')} onRetry={() => retainers.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<RepeatIcon />}
          title={t('retainers.clientTab.emptyTitle')}
          description={canCreate ? t('retainers.clientTab.emptyHint') : undefined}
          action={newRetainer}
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {items.map((retainer) => (
            <RetainerCard key={retainer.id} retainer={retainer} />
          ))}
        </ul>
      )}
    </>
  );
}

function RetainerCard({ retainer }: { retainer: Retainer }) {
  const { t } = useTranslation();
  const ended = retainer.status === 'ended';
  const cycle = retainer.currentCycle;
  return (
    <li>
      <Link
        to="/retainers/$retainerId"
        params={{ retainerId: retainer.id }}
        data-closed={ended || undefined}
        className="group flex h-full flex-col gap-4 rounded-lg border border-border bg-surface p-5 transition-colors duration-150 ease-out outline-offset-4 hover:border-primary data-closed:bg-muted/40"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-bold group-hover:underline">{retainer.name}</h3>
          <span className="flex flex-wrap justify-end gap-1.5">
            <RetainerStatusBadge status={retainer.status} />
            {retainer.renewal && <RenewalBadge state={retainer.renewal} />}
          </span>
        </div>
        {cycle ? (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              {formatMonth(cycle.month)}
              {cycle.behind && <BehindBadge />}
            </p>
            <CycleCounters lines={cycle.lines} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('retainers.noOpenCycle')}</p>
        )}
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-4 text-sm">
          <span className="text-muted-foreground">{t('retainers.columns.deliveryRate')}</span>
          <DeliveryRate rate={cycle?.deliveryRate ?? null} />
        </div>
      </Link>
    </li>
  );
}

/**
 * G3: an ended client whose work still runs (open projects, active or paused retainers); the
 * client's status never changes its projects or retainers.
 */
export function EndedClientWorkCallout({ client }: { client: ClientDetailResponse }) {
  const { t } = useTranslation();
  const ended = client.status === 'ended' && client.archivedAt === null;
  const projects = useQuery({ ...clientProjectsQuery(client.id), enabled: ended });
  const retainers = useQuery({ ...clientRetainersQuery(client.id), enabled: ended });
  const openProjects = (projects.data?.items ?? []).filter(
    (project) => !isProjectClosed(project.status),
  ).length;
  const runningRetainers = (retainers.data?.items ?? []).filter(
    (retainer) => retainer.status !== 'ended',
  ).length;
  if (!ended || openProjects + runningRetainers === 0) return null;
  const sentences = [
    openProjects > 0 &&
      t('projects.clientTab.endedWithWorkBody', {
        count: openProjects,
        n: formatNumber(openProjects),
      }),
    runningRetainers > 0 &&
      t('retainers.clientTab.endedWithRetainers', {
        count: runningRetainers,
        n: formatNumber(runningRetainers),
      }),
  ];
  return (
    <Callout
      tone="warning"
      icon={<TriangleAlertIcon />}
      title={t('projects.clientTab.endedWithWork')}
      description={sentences.filter(Boolean).join(' ')}
    />
  );
}
