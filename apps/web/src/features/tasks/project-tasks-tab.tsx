import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  BOARD_STATUSES,
  isProjectClosed,
  type ProjectDetail,
  TASK_STATUSES,
  type Task,
} from '@vertex-hub/contracts';
import { Button, EmptyState, Skeleton } from '@vertex-hub/ui';
import { ArrowLeftIcon, LayersIcon, ListTodoIcon, MilestoneIcon, PlusIcon } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { TabHeader } from '../../components/tab-header';
import { formatNumber } from '../../lib/format';
import { clientQuery } from '../clients/clients.queries';
import { GenerateTasksDialog } from '../templates/generate-dialog';
import { ProjectRunLines } from '../templates/template-runs';
import type { TaskListSearch } from './task-list-page';
import { TaskRows } from './task-rows';
import { taskListQuery } from './tasks.queries';

/** A project holds far fewer tasks than this; more are one click away in the list. */
const TAB_SIZE = 100;

/**
 * The Tasks tab of the project page (spec screen 7): the project's tasks grouped by milestone,
 * in milestone order, then those without one. "New task" comes preset with the project (and the
 * milestone, from its group) while the project is running; managers of a running project can
 * generate tasks from a template (F07 screen 5), with a line per run above the tasks.
 */
export function ProjectTasksTab({
  project,
  generateTemplateId,
  onGenerateClosed,
}: {
  project: ProjectDetail;
  /** Opens the generate dialog with this template (after creating the project from one). */
  generateTemplateId?: string;
  onGenerateClosed: () => void;
}) {
  const { t } = useTranslation();
  const [generating, setGenerating] = useState(false);
  // Opened after creating the project, the dialog has no button to give the focus back to.
  const generateButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const tasks = useQuery(
    taskListQuery({ projectId: project.id, status: [...TASK_STATUSES], pageSize: TAB_SIZE }),
  );
  const client = useQuery(clientQuery(project.client.id));
  // Rule 7: new tasks link only to a running project of a client that has not ended.
  const running =
    project.archivedAt === null &&
    !isProjectClosed(project.status) &&
    client.data?.status !== 'ended';
  const preset = (milestoneId?: string) => ({
    clientId: project.client.id,
    projectId: project.id,
    milestoneId,
  });
  // F07 rule 15: templates apply to running projects of clients that have not ended.
  const canGenerate = running && project.permissions.canManage;
  const newTask = running && (
    <Button size="sm" render={<Link to="/tasks/new" search={preset()} />}>
      <PlusIcon />
      {t('tasks.actions.new')}
    </Button>
  );
  const generate = canGenerate && (
    <Button ref={generateButton} size="sm" variant="outline" onClick={() => setGenerating(true)}>
      <LayersIcon />
      {t('templates.generate.fromTemplate')}
    </Button>
  );
  const dialog = (
    <GenerateTasksDialog
      target={{ type: 'project', project }}
      initialTemplateId={generateTemplateId}
      open={generating || (!!generateTemplateId && canGenerate)}
      finalFocus={() => generateButton.current ?? heading.current ?? true}
      onClose={() => {
        setGenerating(false);
        onGenerateClosed();
      }}
    />
  );

  if (tasks.isPending) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    );
  }
  if (tasks.isError) {
    return <LoadError message={t('tasks.list.loadError')} onRetry={() => tasks.refetch()} />;
  }
  const items = tasks.data.items;
  // Tasks keep a milestone removed from the project since: they get a group of their own.
  const removed = new Map(
    items.flatMap((task) =>
      task.milestone && !project.milestones.some(({ id }) => id === task.milestone?.id)
        ? [[task.milestone.id, task.milestone.name] as const]
        : [],
    ),
  );
  const groups = [
    ...project.milestones.map((milestone) => ({
      key: milestone.id,
      milestoneId: milestone.id as string | undefined,
      name: milestone.name,
      // Rule 7: tasks link only to a pending milestone.
      open: milestone.status === 'pending',
      tasks: items.filter((task) => task.milestone?.id === milestone.id),
    })),
    ...[...removed].map(([id, name]) => ({
      key: id,
      milestoneId: id as string | undefined,
      name,
      open: false,
      tasks: items.filter((task) => task.milestone?.id === id),
    })),
    {
      key: 'none',
      milestoneId: undefined,
      name: t('tasks.projectTab.noMilestone'),
      open: false,
      tasks: items.filter((task) => !task.milestone),
    },
  ].filter((group) => group.tasks.length > 0);

  return (
    <>
      <TabHeader
        title={t('tasks.projectTab.title')}
        description={t('tasks.projectTab.hint')}
        headingRef={heading}
        action={
          items.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {generate}
              {newTask}
            </div>
          )
        }
      />
      <ProjectRunLines projectId={project.id} />
      {dialog}
      {items.length === 0 ? (
        <EmptyState
          icon={<ListTodoIcon />}
          title={t('tasks.projectTab.emptyTitle')}
          description={running ? t('tasks.projectTab.emptyHint') : undefined}
          action={
            running && (
              <div className="flex flex-wrap justify-center gap-2">
                {newTask}
                {generate}
              </div>
            )
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <TaskGroup
              key={group.key}
              name={group.name}
              tasks={group.tasks}
              // The list has no "without a milestone" filter.
              listSearch={
                group.milestoneId
                  ? {
                      clientId: project.client.id,
                      projectId: project.id,
                      milestoneId: group.milestoneId,
                      status: [...BOARD_STATUSES],
                    }
                  : undefined
              }
              newTask={
                running &&
                group.open && (
                  <Button
                    variant="ghost"
                    size="sm"
                    render={<Link to="/tasks/new" search={preset(group.milestoneId)} />}
                  >
                    <PlusIcon />
                    {t('tasks.projectTab.newForMilestone')}
                  </Button>
                )
              }
            />
          ))}
          {tasks.data.total > items.length && (
            <Button
              variant="outline"
              className="self-start"
              render={
                <Link
                  to="/tasks/list"
                  search={{ clientId: project.client.id, projectId: project.id }}
                />
              }
            >
              {t('tasks.projectTab.seeAll', { n: formatNumber(tasks.data.total) })}
              <ArrowLeftIcon className="ltr:-scale-x-100" />
            </Button>
          )}
        </div>
      )}
    </>
  );
}

function TaskGroup({
  name,
  tasks,
  listSearch,
  newTask,
}: {
  name: string;
  tasks: Task[];
  listSearch: TaskListSearch | undefined;
  newTask: ReactNode;
}) {
  const { t } = useTranslation();
  const delivered = tasks.filter((task) => task.status === 'delivered').length;
  const counted = tasks.filter((task) => task.status !== 'cancelled').length;
  const counts = t('projects.milestones.tasks', {
    delivered: formatNumber(delivered),
    total: formatNumber(counted),
  });
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <MilestoneIcon aria-hidden="true" className="size-5 text-muted-foreground" />
        <h3 className="font-bold">{name}</h3>
        {listSearch ? (
          <Link
            to="/tasks/list"
            search={listSearch}
            className="text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            {counts}
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">{counts}</span>
        )}
        <span className="ms-auto">{newTask}</span>
      </div>
      <TaskRows tasks={tasks} showAssignee inEngagement />
    </section>
  );
}
