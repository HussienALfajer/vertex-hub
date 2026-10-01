import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { APPROVAL_REQUEST_STATES, type MeResponse } from '@vertex-hub/contracts';
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
import { SendIcon, SendToBackIcon, StethoscopeIcon } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { can, useMe } from '../../lib/auth';
import { flagParam, idParam, listParam, oneOfParam, pageParam } from '../../lib/search-params';
import { postListQuery } from '../content/content.queries';
import { formatPublish, PostPlatforms } from '../content/post-parts';
import { useDepartmentNames } from '../projects/project-badges';
import { formatDue, PriorityBadge, TaskOverdueBadge } from '../tasks/task-badges';
import { taskListQuery } from '../tasks/tasks.queries';
import { ItemKindBadge, reviewsMedical, sendsApprovals } from './approval-parts';
import { ReadyTab } from './ready-tab';
import { type SentSearch, SentTab } from './sent-tab';

/*
 * The Approvals page (spec F09, screen 1): the work waiting on a review or a client, one tab per
 * queue, each shown only to those who can act on it. The tab is kept in the URL.
 */

const APPROVAL_TABS = ['medical', 'ready', 'sent'] as const;

type ApprovalTab = (typeof APPROVAL_TABS)[number];

export interface ApprovalsSearch extends SentSearch {
  /** Unset means the first tab the user may use. */
  tab?: ApprovalTab;
}

export function parseApprovalsSearch(search: Record<string, unknown>): ApprovalsSearch {
  return {
    tab: oneOfParam(APPROVAL_TABS, search.tab),
    state: listParam(APPROVAL_REQUEST_STATES, search.state),
    clientId: idParam(search.clientId),
    mine: flagParam(search.mine),
    page: pageParam(search.page),
  };
}

/** Whether the user has a queue to act on: the page is in their navigation. */
export const hasApprovalQueue = (me: MeResponse) => reviewsMedical(me) || sendsApprovals(me);

/**
 * The tabs the user sees: the queues they can act on, and the sent requests, which everyone who
 * reads tasks may read. Cosmetic: the API enforces each one.
 */
export function approvalTabsFor(me: MeResponse): ApprovalTab[] {
  return APPROVAL_TABS.filter((tab) =>
    tab === 'medical'
      ? reviewsMedical(me)
      : tab === 'ready'
        ? sendsApprovals(me)
        : can(me, 'tasks.read'),
  );
}

export function ApprovalsPage({ search }: { search: ApprovalsSearch }) {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate({ from: '/approvals/' });
  const tabs = approvalTabsFor(me);
  const tab = search.tab && tabs.includes(search.tab) ? search.tab : tabs[0];
  const setSent = useCallback(
    (next: Partial<SentSearch>) =>
      navigate({ search: (previous) => ({ ...previous, ...next }), replace: true }),
    [navigate],
  );
  return (
    <>
      <PageHeader title={t('approvals.title')} description={t('approvals.subtitle')} />
      <Tabs
        value={tab}
        onValueChange={(next: ApprovalTab) =>
          // The filters belong to the Sent tab: they leave the URL with it.
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
          {tabs.includes('ready') && (
            <TabsTrigger value="ready">
              <SendToBackIcon />
              {t('approvals.tabs.ready')}
            </TabsTrigger>
          )}
          {tabs.includes('sent') && (
            <TabsTrigger value="sent">
              <SendIcon className="rtl:-scale-x-100" />
              {t('approvals.tabs.sent')}
            </TabsTrigger>
          )}
        </TabsList>
        {tabs.includes('medical') && (
          <TabsContent value="medical">
            <MedicalQueue />
          </TabsContent>
        )}
        {tabs.includes('ready') && (
          <TabsContent value="ready">
            <ReadyTab />
          </TabsContent>
        )}
        {tabs.includes('sent') && (
          <TabsContent value="sent">
            <SentTab search={search} onChange={setSent} />
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}

/** The medical stage has few items at a time: one request holds each queue. */
const QUEUE_SIZE = 100;

/**
 * Tasks and posts in the medical stage (F09 rule 4, F08 rule 13): tasks the longest untouched
 * first, then posts by publish date. A reviewer's own task or post is listed too, marked: another
 * member reviews it (edge case 8).
 */
function MedicalQueue() {
  const { t } = useTranslation();
  const me = useMe();
  const departmentName = useDepartmentNames();
  const tasks = useQuery(
    taskListQuery({
      reviewStage: 'medical',
      status: ['internal_review'],
      sort: 'updatedAt',
      order: 'asc',
      pageSize: QUEUE_SIZE,
    }),
  );
  const posts = useQuery(
    postListQuery({ reviewStage: 'medical', status: ['internal_review'], pageSize: QUEUE_SIZE }),
  );
  if (tasks.isPending || posts.isPending) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  }
  if (tasks.isError || posts.isError) {
    return (
      <LoadError
        message={t('approvals.medical.loadError')}
        onRetry={() => Promise.all([tasks.refetch(), posts.refetch()])}
      />
    );
  }
  if (tasks.data.items.length === 0 && posts.data.items.length === 0) {
    return (
      <EmptyState
        icon={<StethoscopeIcon />}
        title={t('approvals.medical.emptyTitle')}
        description={t('approvals.medical.emptyHint')}
      />
    );
  }
  const person = (person: { id: string; name: string; archived: boolean }) => (
    <span className="flex items-center gap-2">
      <Avatar name={person.name} size="sm" tone={person.archived ? 'muted' : 'brand'} />
      <span className="flex flex-wrap items-center gap-2">
        {person.name}
        {person.id === me.user.id && <Badge tone="outline">{t('approvals.medical.own')}</Badge>}
      </span>
    </span>
  );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('approvals.medical.columns.item')}</TableHead>
          <TableHead>{t('approvals.medical.columns.kind')}</TableHead>
          <TableHead>{t('approvals.medical.columns.person')}</TableHead>
          <TableHead>{t('approvals.medical.columns.date')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.data.items.map((task) => (
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
                <span className="text-xs text-muted-foreground">
                  {[task.client?.name, departmentName(task.department)].filter(Boolean).join(' · ')}
                </span>
              </span>
            </TableCell>
            <TableCell>
              <ItemKindBadge kind="task" />
            </TableCell>
            <TableCell>
              {task.assignee ? (
                person(task.assignee)
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
        {posts.data.items.map((post) => (
          <TableRow key={post.id}>
            <TableCell className="min-w-64 whitespace-normal">
              <span className="flex flex-col items-start gap-0.5">
                <Link
                  to="/content/posts/$postId"
                  params={{ postId: post.id }}
                  className="font-medium hover:underline"
                >
                  {post.title}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {[post.client.name, t(`content.types.${post.type}`)].join(' · ')}
                </span>
              </span>
            </TableCell>
            <TableCell>
              <ItemKindBadge kind="post" />
            </TableCell>
            <TableCell>{person(post.responsible)}</TableCell>
            <TableCell>
              <span className="flex flex-wrap items-center gap-2 tabular-nums">
                {formatPublish(post)}
                <PostPlatforms platforms={post.platforms} />
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
