import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  businessDate,
  daysInclusive,
  isProjectClosed,
  type ProjectDetail,
} from '@vertex-hub/contracts';
import {
  AscentLines,
  AscentMeter,
  Avatar,
  Badge,
  Button,
  Callout,
  Meter,
  type MeterTone,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@vertex-hub/ui';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowRightIcon,
  BanIcon,
  CircleCheckBigIcon,
  FileTextIcon,
  ListTodoIcon,
  MilestoneIcon,
  ReceiptTextIcon,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { isMissing, LoadError } from '../../components/load-error';
import { formatCalendarDate, formatDateTime, formatNumber } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { idParam } from '../../lib/search-params';
import { OwnerDocumentsTab } from '../files/owner-documents-tab';
import { ProjectTasksTab } from '../tasks/project-tasks-tab';
import { ExtraWorkTab } from './extra-work-tab';
import { MilestonesTab } from './milestones-tab';
import { ProjectActions, ReopenButton } from './project-actions';
import {
  ArchivedBadge,
  DepartmentChips,
  OverdueBadge,
  PersonName,
  ProjectStatusBadge,
} from './project-badges';
import { projectQuery, useRestoreProject } from './projects.queries';
import { scheduleOf } from './schedule';

const PROJECT_TABS = ['milestones', 'tasks', 'extra-work', 'documents'] as const;

type ProjectTab = (typeof PROJECT_TABS)[number];

export interface ProjectPageSearch {
  /** Unset means the first tab. */
  tab?: ProjectTab;
  /** A template to open the generate dialog with (after creating the project from one). */
  generate?: string;
}

export function parseProjectPageSearch(search: Record<string, unknown>): ProjectPageSearch {
  return {
    tab: PROJECT_TABS.find((tab) => tab !== 'milestones' && tab === search.tab),
    generate: idParam(search.generate),
  };
}

export function ProjectPage({
  projectId,
  search,
}: {
  projectId: string;
  search: ProjectPageSearch;
}) {
  const { t } = useTranslation();
  const project = useQuery(projectQuery(projectId));

  return (
    <>
      <div>
        <Button variant="ghost" size="sm" render={<Link to="/projects" />}>
          <ArrowRightIcon className="ltr:-scale-x-100" />
          {t('projects.page.back')}
        </Button>
      </div>
      {project.isPending ? (
        <PageSkeleton />
      ) : project.isError ? (
        <LoadError
          message={
            isMissing(project.error) ? t('projects.page.notFound') : t('projects.page.loadError')
          }
          onRetry={() => project.refetch()}
          error={project.error}
        />
      ) : (
        <ProjectView
          project={project.data}
          tab={search.tab ?? 'milestones'}
          generate={search.generate}
        />
      )}
    </>
  );
}

function ProjectView({
  project,
  tab,
  generate,
}: {
  project: ProjectDetail;
  tab: ProjectTab;
  generate: string | undefined;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: '/projects/$projectId' });
  const archived = project.archivedAt !== null;
  // Completed, cancelled and archived projects are read-only (rule 7).
  const editable = project.permissions.canManage && !archived && !isProjectClosed(project.status);

  const openTab = (next: ProjectTab) =>
    navigate({
      search: (previous) => ({ ...previous, tab: next === 'milestones' ? undefined : next }),
      replace: true,
    });

  return (
    <>
      <ProjectHero project={project} onShowMilestones={() => openTab('milestones')} />
      {archived ? <ArchivedCallout project={project} /> : <ClosedCallout project={project} />}
      <Tabs value={tab} onValueChange={(value: ProjectTab) => openTab(value)}>
        <TabsList aria-label={project.name}>
          <TabsTrigger value="milestones">
            <MilestoneIcon />
            {t('projects.page.tabs.milestones')}
            {project.milestones.length > 0 && (
              <Badge tone="neutral" className="h-5 min-w-5 justify-center px-1.5 tabular-nums">
                {formatNumber(project.milestones.length)}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="tasks">
            <ListTodoIcon />
            {t('projects.page.tabs.tasks')}
            {project.tasks.open > 0 && (
              <Badge tone="neutral" className="h-5 min-w-5 justify-center px-1.5 tabular-nums">
                {formatNumber(project.tasks.open)}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="extra-work">
            <ReceiptTextIcon />
            {t('projects.page.tabs.extraWork')}
          </TabsTrigger>
          <TabsTrigger value="documents">
            <FileTextIcon />
            {t('files.documents.title')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="milestones">
          <MilestonesTab project={project} editable={editable} />
        </TabsContent>
        <TabsContent value="tasks">
          <ProjectTasksTab
            project={project}
            generateTemplateId={generate}
            onGenerateClosed={() =>
              navigate({
                search: (previous) => ({ ...previous, generate: undefined }),
                replace: true,
              })
            }
          />
        </TabsContent>
        <TabsContent value="extra-work">
          <ExtraWorkTab
            owner={{
              kind: 'project',
              id: project.id,
              clientId: project.client.id,
              canLog: editable,
              canBill: project.permissions.canBill,
              currency: project.money?.currency ?? null,
              editCurrency: project.permissions.canEditMoney
                ? (project.money?.currency ?? null)
                : null,
            }}
          />
        </TabsContent>
        <TabsContent value="documents">
          <OwnerDocumentsTab owner={{ type: 'project', id: project.id }} />
        </TabsContent>
      </Tabs>
    </>
  );
}

/**
 * The project at a glance: who it is for and who runs it, then its vital signs side by side —
 * time against the schedule, milestones climbed, and (with money access) what the plan is worth.
 */
function ProjectHero({
  project,
  onShowMilestones,
}: {
  project: ProjectDetail;
  onShowMilestones: () => void;
}) {
  const { t } = useTranslation();
  const archived = project.archivedAt !== null;
  const muted = archived || project.status === 'cancelled';

  return (
    <section className="relative overflow-hidden rounded-lg border border-border bg-surface">
      <AscentLines className="absolute inset-y-0 end-0 hidden h-full w-32 text-border md:block" />
      <div className="relative flex flex-col gap-6 p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          <Link
            to="/clients/$clientId"
            params={{ clientId: project.client.id }}
            aria-label={project.client.name}
            className="shrink-0 rounded-lg outline-offset-4"
          >
            <Avatar
              name={project.client.name}
              shape="square"
              size="lg"
              tone={muted ? 'muted' : 'brand'}
            />
          </Link>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Link
                to="/clients/$clientId"
                params={{ clientId: project.client.id }}
                className="w-fit text-sm text-muted-foreground hover:text-foreground hover:underline"
              >
                {project.client.name}
              </Link>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold">{project.name}</h1>
                <ProjectStatusBadge status={project.status} />
                {project.overdue && <OverdueBadge />}
                {archived && <ArchivedBadge />}
              </div>
            </div>
            {project.description && (
              <p className="max-w-prose text-base whitespace-pre-line text-muted-foreground">
                {project.description}
              </p>
            )}
            <dl className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
              <div className="flex items-center gap-2">
                <dt className="text-muted-foreground">{t('projects.page.projectManager')}</dt>
                <dd>
                  <Link
                    to="/team/$userId"
                    params={{ userId: project.projectManager.id }}
                    className="font-medium hover:underline"
                  >
                    <PersonName
                      name={project.projectManager.name}
                      archived={project.projectManager.archived}
                    />
                  </Link>
                </dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="sr-only">{t('projects.form.departments')}</dt>
                <dd>
                  <DepartmentChips codes={project.departments} />
                </dd>
              </div>
            </dl>
          </div>
          <ProjectActions project={project} onShowMilestones={onShowMilestones} />
        </div>
        <div className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(14rem,1fr))]">
          <ScheduleVital project={project} />
          <MilestonesVital project={project} />
          {project.progress !== null && (
            <Vital label={t('projects.page.progress')}>
              <p className="text-xl font-bold tabular-nums">
                {formatNumber(project.progress / 100, { style: 'percent' })}
              </p>
              <Meter
                value={project.progress}
                tone="success"
                aria-label={t('projects.page.progress')}
              />
              <p className="text-xs text-muted-foreground">
                {t('projects.milestones.tasks', {
                  delivered: formatNumber(project.tasks.delivered),
                  total: formatNumber(project.tasks.total),
                })}
              </p>
            </Vital>
          )}
          {project.money && (
            <Vital label={t('projects.milestones.total')}>
              <p className="text-xl font-bold tabular-nums">
                {formatMoney(project.money.totalMinor, project.money.currency)}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('projects.page.installmentsSet', {
                  set: formatNumber(
                    project.milestones.filter(
                      (milestone) => milestone.money?.installmentMinor != null,
                    ).length,
                  ),
                  total: formatNumber(project.milestones.length),
                })}
              </p>
            </Vital>
          )}
        </div>
      </div>
    </section>
  );
}

function Vital({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-sm text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/** Time against the schedule: how much of it has passed and what is left, or how late it runs. */
function ScheduleVital({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation();
  const today = businessDate();
  const { elapsed, daysLeft } = scheduleOf(project.startDate, project.dueDate, today);
  const closed = isProjectClosed(project.status);
  const started = project.startDate <= today;

  let headline: string;
  let tone: MeterTone = 'brand';
  if (project.status === 'completed' && project.completedAt) {
    headline = t('projects.page.completedOn', { date: formatDateTime(project.completedAt) });
    tone = 'success';
  } else if (project.status === 'cancelled') {
    headline = t('projects.statuses.cancelled');
  } else if (daysLeft < 0) {
    headline = t('projects.overdueBy', { count: -daysLeft, days: formatNumber(-daysLeft) });
    tone = 'danger';
  } else if (!started) {
    const until = daysInclusive(today, project.startDate) - 1;
    headline = t('projects.page.startsIn', { count: until, days: formatNumber(until) });
  } else if (daysLeft === 0) {
    headline = t('projects.page.dueToday');
    tone = 'warning';
  } else {
    headline = t('projects.page.daysLeft', { count: daysLeft, days: formatNumber(daysLeft) });
    if (elapsed >= 0.8) tone = 'warning';
  }

  return (
    <Vital label={t('projects.page.schedule')}>
      <p className="text-xl font-bold">{headline}</p>
      {!closed && (
        <Meter
          value={Math.round(elapsed * 100)}
          tone={tone}
          aria-label={t('projects.page.timeElapsed')}
        />
      )}
      <p className="text-xs text-muted-foreground">
        {t('projects.dateRange', {
          start: formatCalendarDate(project.startDate),
          due: formatCalendarDate(project.dueDate),
        })}
      </p>
    </Vital>
  );
}

function MilestonesVital({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation();
  const { done, total } = project.milestoneProgress;
  const current = project.milestones.find((milestone) => milestone.status === 'pending');
  const label = t('projects.milestonesDone', {
    done: formatNumber(done),
    total: formatNumber(total),
  });
  return (
    <Vital label={t('projects.page.tabs.milestones')}>
      <p className="text-xl font-bold tabular-nums">{total === 0 ? t('common.none') : label}</p>
      {total > 0 && <AscentMeter value={done} max={total} tone="success" aria-label={label} />}
      <p className="truncate text-xs text-muted-foreground">
        {total === 0
          ? t('projects.page.noMilestones')
          : current
            ? t('projects.page.currentMilestone', { name: current.name })
            : t('projects.page.allMilestonesDone')}
      </p>
    </Vital>
  );
}

/** A completed or cancelled project is read-only until someone with scope all reopens it. */
function ClosedCallout({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation();
  if (!isProjectClosed(project.status)) return null;
  const reopen = project.permissions.canReopen && <ReopenButton project={project} />;
  if (project.status === 'completed') {
    return (
      <Callout
        icon={<CircleCheckBigIcon />}
        title={t('projects.page.completedTitle')}
        description={t('projects.page.closedBody')}
        action={reopen}
      />
    );
  }
  return (
    <Callout
      tone="danger"
      icon={<BanIcon />}
      title={
        project.cancelledAt
          ? t('projects.page.cancelledTitle', { date: formatDateTime(project.cancelledAt) })
          : t('projects.statuses.cancelled')
      }
      description={
        project.cancelReason
          ? t('projects.page.cancelReason', { reason: project.cancelReason })
          : t('projects.page.closedBody')
      }
      action={reopen}
    />
  );
}

function ArchivedCallout({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation();
  const restore = useRestoreProject(project.id);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Callout
        icon={<ArchiveIcon />}
        title={t('projects.page.archivedTitle')}
        description={t('projects.page.archivedBody')}
        action={
          project.permissions.canArchive && (
            <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
              <ArchiveRestoreIcon />
              {t('projects.actions.restore')}
            </Button>
          )
        }
      />
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('projects.restore.title', { name: project.name })}
        body={t('projects.restore.body')}
        action={t('projects.actions.restore')}
        pending={restore.isPending}
        onConfirm={async () => {
          await restore.mutateAsync(undefined);
          toast.add({ title: t('projects.restore.done'), type: 'success' });
        }}
      />
    </>
  );
}

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-6 rounded-lg border border-border bg-surface p-6">
        <div className="flex items-center gap-5">
          <Skeleton className="size-14 rounded-lg" />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-7 w-64" />
          </div>
        </div>
        <div className="grid gap-4 border-t border-border pt-5 sm:grid-cols-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      </div>
      <Skeleton className="h-11" />
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
    </div>
  );
}
