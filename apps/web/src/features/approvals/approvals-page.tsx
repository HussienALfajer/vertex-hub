import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type { MeResponse } from '@vertex-hub/contracts';
import {
  Avatar,
  Badge,
  EmptyState,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@vertex-hub/ui';
import { StethoscopeIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { can, useMe } from '../../lib/auth';
import { oneOfParam } from '../../lib/search-params';
import { useDepartmentNames } from '../projects/project-badges';
import { formatDue, PriorityBadge, TaskOverdueBadge } from '../tasks/task-badges';
import { taskListQuery } from '../tasks/tasks.queries';

/*
 * The Approvals page (spec F09, screen 1): the work waiting on a review or a client, one tab per
 * queue, each shown only to those who can act on it. The tab is kept in the URL.
 */

const APPROVAL_TABS = ['medical'] as const;

type ApprovalTab = (typeof APPROVAL_TABS)[number];

export interface ApprovalsSearch {
  /** Unset means the first tab the user may use. */
  tab?: ApprovalTab;
}

export function parseApprovalsSearch(search: Record<string, unknown>): ApprovalsSearch {
  return { tab: oneOfParam(APPROVAL_TABS, search.tab) };
}

/** The tabs the user can act on. Cosmetic: the API enforces each queue. */
export function approvalTabsFor(me: MeResponse): ApprovalTab[] {
  return APPROVAL_TABS.filter((tab) => tab !== 'medical' || can(me, 'approvals.review_medical'));
}

export function ApprovalsPage({ search }: { search: ApprovalsSearch }) {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate({ from: '/approvals/' });
  const tabs = approvalTabsFor(me);
  const tab = search.tab && tabs.includes(search.tab) ? search.tab : tabs[0];
  return (
    <>
      <PageHeader title={t('approvals.title')} description={t('approvals.subtitle')} />
      <Tabs
        value={tab}
        onValueChange={(next: ApprovalTab) =>
          navigate({ search: { tab: next === tabs[0] ? undefined : next }, replace: true })
        }
      >
        <TabsList aria-label={t('approvals.title')}>
          {tabs.includes('medical') && (
            <TabsTrigger value="medical">
              <StethoscopeIcon />
              {t('approvals.tabs.medical')}
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="medical">
          <MedicalQueue />
        </TabsContent>
      </Tabs>
    </>
  );
}

/** The medical stage has few tasks at a time: one request holds the whole queue. */
const QUEUE_SIZE = 100;

/**
 * Tasks in the medical stage, the longest untouched first. A reviewer's own task is listed too,
 * marked: another member reviews it (rule 4, edge case 8).
 */
function MedicalQueue() {
  const { t } = useTranslation();
  const me = useMe();
  const departmentName = useDepartmentNames();
  const queue = useQuery(
    taskListQuery({
      reviewStage: 'medical',
      status: ['internal_review'],
      sort: 'updatedAt',
      order: 'asc',
      pageSize: QUEUE_SIZE,
    }),
  );
  if (queue.isPending) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  }
  if (queue.isError) {
    return <LoadError message={t('approvals.medical.loadError')} onRetry={() => queue.refetch()} />;
  }
  if (queue.data.items.length === 0) {
    return (
      <EmptyState
        icon={<StethoscopeIcon />}
        title={t('approvals.medical.emptyTitle')}
        description={t('approvals.medical.emptyHint')}
      />
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('approvals.medical.columns.task')}</TableHead>
          <TableHead>{t('approvals.medical.columns.department')}</TableHead>
          <TableHead>{t('approvals.medical.columns.assignee')}</TableHead>
          <TableHead>{t('approvals.medical.columns.due')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {queue.data.items.map((task) => (
          <TableRow key={task.id}>
            <TableCell className="min-w-64 whitespace-normal">
              <span className="flex flex-col items-start gap-0.5">
                <Link
                  to="/tasks/$taskId"
                  params={{ taskId: task.id }}
                  className="font-medium hover:underline"
                >
                  {task.title}
                </Link>
                <span className="text-xs text-muted-foreground">{task.client?.name}</span>
              </span>
            </TableCell>
            <TableCell>{departmentName(task.department)}</TableCell>
            <TableCell>
              {task.assignee ? (
                <span className="flex items-center gap-2">
                  <Avatar
                    name={task.assignee.name}
                    size="sm"
                    tone={task.assignee.archived ? 'muted' : 'brand'}
                  />
                  <span className="flex flex-wrap items-center gap-2">
                    {task.assignee.name}
                    {task.assignee.id === me.user.id && (
                      <Badge tone="outline">{t('approvals.medical.own')}</Badge>
                    )}
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">{t('tasks.unassigned')}</span>
              )}
            </TableCell>
            <TableCell>
              <span className="flex flex-wrap items-center gap-2 tabular-nums">
                {formatDue(task)}
                <PriorityBadge priority={task.priority} />
                {task.overdue && <TaskOverdueBadge />}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
