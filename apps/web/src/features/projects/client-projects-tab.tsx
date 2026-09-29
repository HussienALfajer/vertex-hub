import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  type ClientDetailResponse,
  isProjectClosed,
  PROJECT_STATUSES,
  type Project,
} from '@vertex-hub/contracts';
import { Button, Callout, EmptyState, Skeleton } from '@vertex-hub/ui';
import { CalendarIcon, FolderKanbanIcon, PlusIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { TabHeader } from '../../components/tab-header';
import { useMe } from '../../lib/auth';
import { formatCalendarDate, formatNumber } from '../../lib/format';
import { canCreateProjectFor } from './project-access';
import { MilestoneProgress, OverdueBadge, PersonName, ProjectStatusBadge } from './project-badges';
import { projectListQuery } from './projects.queries';

/** A client's projects of every status, running ones first (by due date), then closed ones. */
export const clientProjectsQuery = (clientId: string) =>
  projectListQuery({ clientId, status: [...PROJECT_STATUSES], pageSize: 100 });

/** The Projects tab of the client profile (F02), with "New project" preset to the client. */
export function ClientProjectsTab({ client }: { client: ClientDetailResponse }) {
  const { t } = useTranslation();
  const me = useMe();
  const projects = useQuery(clientProjectsQuery(client.id));
  // Rule 1: projects start only for a non-archived client that is active or paused.
  const canCreate =
    client.archivedAt === null &&
    client.status !== 'ended' &&
    canCreateProjectFor(me, client.accountManager.id);
  const newProject = canCreate && (
    <Button size="sm" render={<Link to="/projects/new" search={{ clientId: client.id }} />}>
      <PlusIcon />
      {t('projects.newProject')}
    </Button>
  );

  const items = [...(projects.data?.items ?? [])].sort(
    (a, b) => Number(isProjectClosed(a.status)) - Number(isProjectClosed(b.status)),
  );

  return (
    <>
      <TabHeader
        title={t('projects.clientTab.title')}
        description={t('projects.clientTab.hint')}
        action={items.length > 0 && newProject}
      />
      {projects.isPending ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      ) : projects.isError ? (
        <LoadError message={t('projects.loadError')} onRetry={() => projects.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<FolderKanbanIcon />}
          title={t('projects.clientTab.emptyTitle')}
          description={canCreate ? t('projects.clientTab.emptyHint') : undefined}
          action={newProject}
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {items.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </ul>
      )}
    </>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const { t } = useTranslation();
  const closed = isProjectClosed(project.status);
  return (
    <li>
      <Link
        to="/projects/$projectId"
        params={{ projectId: project.id }}
        data-closed={closed || undefined}
        className="group flex h-full flex-col gap-4 rounded-lg border border-border bg-surface p-5 transition-colors duration-150 ease-out outline-offset-4 hover:border-primary data-closed:bg-muted/40"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-bold group-hover:underline">{project.name}</h3>
          <ProjectStatusBadge status={project.status} />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <CalendarIcon aria-hidden="true" className="size-4" />
            {t('projects.dueOn', { date: formatCalendarDate(project.dueDate) })}
          </span>
          {project.overdue && <OverdueBadge />}
        </div>
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-4 text-sm">
          <PersonName
            name={project.projectManager.name}
            archived={project.projectManager.archived}
          />
          <MilestoneProgress progress={project.milestoneProgress} />
        </div>
      </Link>
    </li>
  );
}

/** G3: an ended client whose work still runs; the client's status never changes its projects. */
export function EndedClientWorkCallout({ client }: { client: ClientDetailResponse }) {
  const { t } = useTranslation();
  const ended = client.status === 'ended' && client.archivedAt === null;
  const projects = useQuery({ ...clientProjectsQuery(client.id), enabled: ended });
  const running = (projects.data?.items ?? []).filter(
    (project) => !isProjectClosed(project.status),
  ).length;
  if (!ended || running === 0) return null;
  return (
    <Callout
      tone="warning"
      icon={<TriangleAlertIcon />}
      title={t('projects.clientTab.endedWithWork')}
      description={t('projects.clientTab.endedWithWorkBody', {
        count: running,
        n: formatNumber(running),
      })}
    />
  );
}
