import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { TaskTree, TaskTreeNode } from '@vertex-hub/contracts';
import {
  Avatar,
  Badge,
  cn,
  EmptyState,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
} from '@vertex-hub/ui';
import {
  ArrowUpLeftIcon,
  FlameIcon,
  ListIcon,
  ListTreeIcon,
  MilestoneIcon,
  NetworkIcon,
} from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { formatList } from '../../lib/format';
import { imageSrc } from '../../lib/images';
import { useDepartmentNames } from '../projects/project-badges';
import { BlockedBadge, formatDue, TaskOverdueBadge, TaskStatusBadge } from './task-badges';
import { type TaskTreeFilters, taskTreeQuery } from './tasks.queries';

export type TaskView = 'list' | 'tree';

/** F06B screen 6: the List / Tree switch of a project's Tasks tab and a retainer's month. */
export function TaskViewSwitch({
  value,
  onChange,
}: {
  value: TaskView;
  onChange: (view: TaskView) => void;
}) {
  const { t } = useTranslation();
  return (
    <ToggleGroup
      aria-label={t('tasks.tree.view')}
      value={[value]}
      onValueChange={(next: TaskView[]) => {
        if (next[0]) onChange(next[0]);
      }}
    >
      <ToggleGroupItem value="list">
        <ListIcon />
        {t('tasks.tree.list')}
      </ToggleGroupItem>
      <ToggleGroupItem value="tree">
        <NetworkIcon />
        {t('tasks.tree.tree')}
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

/**
 * F06B rule D4: milestones (or the cycle), each with its tasks and their subtasks indented under
 * the run mode, what each waits for, and the bottleneck highlighted. It shows the flow; it does
 * not edit it.
 */
export function TaskTreeView({ filters }: { filters: TaskTreeFilters }) {
  const { t } = useTranslation();
  const tree = useQuery(taskTreeQuery(filters));
  if (tree.isPending) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (tree.isError) {
    return <LoadError message={t('tasks.tree.loadError')} onRetry={() => tree.refetch()} />;
  }
  if (tree.data.groups.length === 0) {
    return <EmptyState icon={<ListTreeIcon />} title={t('tasks.tree.emptyTitle')} />;
  }
  return (
    <div className="flex flex-col gap-4">
      <TreeLegend bottleneck={tree.data.bottleneckId !== null} />
      {tree.data.groups.map((group) => (
        <TreeGroup key={group.milestone?.id ?? 'none'} tree={tree.data} group={group} />
      ))}
    </div>
  );
}

function TreeLegend({ bottleneck }: { bottleneck: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
      <span className="font-medium">{t('tasks.tree.legend')}</span>
      <span className="flex items-center gap-2 text-muted-foreground">
        <Badge tone="danger">
          <FlameIcon aria-hidden="true" />
          {t('tasks.tree.bottleneck')}
        </Badge>
        {bottleneck ? t('tasks.tree.bottleneckHint') : t('tasks.tree.noBottleneck')}
      </span>
      <span className="flex items-center gap-2 text-muted-foreground">
        <ArrowUpLeftIcon aria-hidden="true" className="size-4 rtl:-scale-x-100" />
        {t('tasks.tree.waitsHint')}
      </span>
    </div>
  );
}

function TreeGroup({ tree, group }: { tree: TaskTree; group: TaskTree['groups'][number] }) {
  const { t } = useTranslation();
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-lg border border-border bg-surface"
    >
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <MilestoneIcon aria-hidden="true" className="size-5 text-muted-foreground" />
        <h3 id={headingId} className="font-bold">
          {group.milestone?.name ?? t('tasks.projectTab.noMilestone')}
        </h3>
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {group.tasks.map((task) => (
          <li key={task.id} className="flex flex-col">
            <TreeNode tree={tree} node={task} />
            {task.subtasks.length > 0 && (
              <div className="flex flex-col gap-1 pb-3 ps-6">
                {task.runMode && (
                  <p className="px-4 text-xs text-muted-foreground">
                    {t('tasks.tree.runMode', {
                      mode: t(`tasks.subtasks.runModes.${task.runMode}`),
                    })}
                  </p>
                )}
                <ul className="flex flex-col border-s-2 border-border">
                  {task.subtasks.map((subtask) => (
                    <li key={subtask.id}>
                      <TreeNode tree={tree} node={subtask} nested />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

type TreeNodeData = Omit<TaskTreeNode, 'runMode' | 'subtasks'>;

function TreeNode({
  tree,
  node,
  nested,
}: {
  tree: TaskTree;
  node: TreeNodeData;
  nested?: boolean;
}) {
  const { t } = useTranslation();
  const departmentName = useDepartmentNames();
  const bottleneck = tree.bottleneckId === node.id;
  const waitsFor = tree.edges
    .filter((edge) => edge.taskId === node.id)
    .map((edge) => titleOf(tree, edge.dependsOnId));
  return (
    <div
      data-bottleneck={bottleneck || undefined}
      className={cn(
        'flex flex-col gap-1.5 px-4 py-3',
        nested && 'py-2',
        bottleneck && 'border-s-4 border-destructive bg-status-danger',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/tasks/$taskId"
          params={{ taskId: node.id }}
          className="font-medium hover:underline"
        >
          {node.title}
        </Link>
        <TaskStatusBadge status={node.status} />
        {bottleneck && (
          <Badge tone="danger">
            <FlameIcon aria-hidden="true" />
            {t('tasks.tree.bottleneck')}
          </Badge>
        )}
        {node.overdue && <TaskOverdueBadge />}
        {node.blocked && <BlockedBadge />}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {node.assignee ? (
            <>
              <Avatar
                name={node.assignee.name}
                src={imageSrc(node.assignee.imageId, 'sm')}
                size="sm"
              />
              {node.assignee.name}
            </>
          ) : (
            t('tasks.unassigned')
          )}
        </span>
        <span>{departmentName(node.department)}</span>
        <span className="tabular-nums">{formatDue(node)}</span>
      </div>
      {waitsFor.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ArrowUpLeftIcon aria-hidden="true" className="size-3.5 shrink-0 rtl:-scale-x-100" />
          {t('tasks.tree.waitsFor', { titles: formatList(waitsFor) })}
        </p>
      )}
    </div>
  );
}

/** A dependency's title: a task of the tree, or one outside it (edge case 11). */
function titleOf(tree: TaskTree, id: string): string {
  for (const group of tree.groups) {
    for (const task of group.tasks) {
      if (task.id === id) return task.title;
      const subtask = task.subtasks.find((item) => item.id === id);
      if (subtask) return subtask.title;
    }
  }
  return tree.outside.find((task) => task.id === id)?.title ?? '';
}
