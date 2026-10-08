import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  addDays,
  businessDate,
  type MyTaskSummary,
  type Task,
  weekOf,
} from '@vertex-hub/contracts';
import { Badge, Button, cn, EmptyState, PageHeader, Skeleton } from '@vertex-hub/ui';
import {
  ArrowLeftIcon,
  CalendarClockIcon,
  CalendarDaysIcon,
  CalendarRangeIcon,
  ClipboardCheckIcon,
  HourglassIcon,
  InboxIcon,
  type LucideIcon,
  PlusIcon,
  SendIcon,
  SendToBackIcon,
  StethoscopeIcon,
  SunIcon,
  UserRoundSearchIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { useMe } from '../../lib/auth';
import { formatNumber } from '../../lib/format';
import { approvalReadyQuery } from '../approvals/approvals.queries';
import { managedDepartments } from './task-access';
import type { TaskListSearch } from './task-list-page';
import { TaskRows } from './task-rows';
import { myTaskSummaryQuery, type TaskListFilters, taskListQuery } from './tasks.queries';

type SectionKey = keyof MyTaskSummary;

interface Section {
  key: SectionKey;
  icon: LucideIcon;
  /** The list requests behind the section; several are merged (waiting on others). */
  filters: TaskListFilters[];
  /** The tasks come from the approvals module instead: those ready to send (F09 rule 8). */
  ready?: boolean;
  /** Drops tasks a request cannot leave out (requested by me: not assigned to me). */
  keep?: (task: Task) => boolean;
  /** The same tasks in the full list, when its filters can express them. */
  listSearch?: TaskListSearch;
  /** The same tasks on a tab of the Approvals page, which is where they are acted on. */
  approvalsTab?: 'medical' | 'ready';
  /** Needs attention first: shown in the danger tone. */
  alert?: boolean;
  /** The tasks belong to other people, so rows name their assignee. */
  others?: boolean;
}

/** Tasks of a section on this page; the rest are one click away in the list. */
const SECTION_SIZE = 20;

function sectionsFor(meId: string, managed: string[]): Section[] {
  const today = businessDate();
  const weekEnd = weekOf(today).to;
  const mine = { assigneeId: 'me' } as const;
  return [
    {
      key: 'overdue',
      icon: CalendarClockIcon,
      alert: true,
      filters: [{ ...mine, overdue: 'true' }],
      listSearch: { assignee: 'me', overdue: true },
    },
    {
      key: 'today',
      icon: SunIcon,
      filters: [{ ...mine, dueFrom: today, dueTo: today, overdue: 'false' }],
      listSearch: { assignee: 'me', dueFrom: today, dueTo: today },
    },
    {
      key: 'thisWeek',
      icon: CalendarDaysIcon,
      filters: [{ ...mine, dueFrom: addDays(today, 1), dueTo: weekEnd }],
      listSearch: { assignee: 'me', dueFrom: addDays(today, 1), dueTo: weekEnd },
    },
    {
      key: 'later',
      icon: CalendarRangeIcon,
      filters: [{ ...mine, dueFrom: addDays(weekEnd, 1) }],
      listSearch: { assignee: 'me', dueFrom: addDays(weekEnd, 1) },
    },
    {
      key: 'waiting',
      icon: HourglassIcon,
      filters: [
        { ...mine, blocked: 'true' },
        { ...mine, status: ['awaiting_client'] },
      ],
    },
    {
      key: 'toReview',
      icon: ClipboardCheckIcon,
      others: true,
      filters: [{ reviewer: 'me', status: ['internal_review'] }],
      listSearch: { reviewer: 'me', status: ['internal_review'] },
    },
    {
      key: 'medicalReview',
      icon: StethoscopeIcon,
      others: true,
      filters: [{ reviewStage: 'medical', status: ['internal_review'] }],
      // Rule 4: never the reviewer's own task.
      keep: (task) => task.assignee?.id !== meId,
      approvalsTab: 'medical',
    },
    {
      key: 'readyToSend',
      icon: SendToBackIcon,
      others: true,
      filters: [],
      ready: true,
      approvalsTab: 'ready',
    },
    {
      key: 'unassignedInMyDepartments',
      icon: InboxIcon,
      alert: true,
      filters: [{ unassigned: 'true', department: managed as TaskListFilters['department'] }],
      listSearch: {
        assignee: 'unassigned',
        department: managed as TaskListSearch['department'],
      },
    },
    {
      key: 'requestedByMe',
      icon: SendIcon,
      others: true,
      filters: [{ createdBy: 'me' }],
      keep: (task) => task.assignee?.id !== meId,
      listSearch: { createdBy: 'me' },
    },
  ];
}

/**
 * The user's day: their open tasks by when they are due, what waits on others, and for managers
 * what waits on them (review, unassigned requests). Counts come from the summary; each section
 * loads its tasks only when it has some.
 */
export function MyTasksPage() {
  const { t } = useTranslation();
  const me = useMe();
  const summary = useQuery(myTaskSummaryQuery);
  const sections = sectionsFor(me.user.id, managedDepartments(me));
  const shown = summary.data
    ? sections.filter((section) => (summary.data[section.key] ?? 0) > 0)
    : [];

  return (
    <>
      <PageHeader
        title={t('tasks.my.title')}
        description={t('tasks.my.subtitle')}
        actions={<NewTaskButtons />}
      />
      {summary.isPending ? (
        <PageSkeleton />
      ) : summary.isError ? (
        <LoadError message={t('tasks.my.loadError')} onRetry={() => summary.refetch()} />
      ) : (
        <>
          <DueTiles summary={summary.data} />
          {shown.length === 0 ? (
            <EmptyState
              icon={<UserRoundSearchIcon />}
              title={t('tasks.my.emptyTitle')}
              description={t('tasks.my.emptyHint')}
              action={<NewTaskButtons />}
            />
          ) : (
            shown.map((section) => (
              <TaskSection
                key={section.key}
                section={section}
                count={summary.data[section.key] ?? 0}
              />
            ))
          )}
        </>
      )}
    </>
  );
}

export function NewTaskButtons() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" render={<Link to="/tasks/new" search={{ mode: 'request' }} />}>
        <SendIcon className="rtl:-scale-x-100" />
        {t('tasks.actions.request')}
      </Button>
      <Button render={<Link to="/tasks/new" />}>
        <PlusIcon />
        {t('tasks.actions.new')}
      </Button>
    </div>
  );
}

const DUE_TILES = [
  { key: 'overdue', icon: CalendarClockIcon },
  { key: 'today', icon: SunIcon },
  { key: 'thisWeek', icon: CalendarDaysIcon },
  { key: 'later', icon: CalendarRangeIcon },
] as const;

/** Where the user's own open tasks fall due, at a glance; each jumps to its section. */
function DueTiles({ summary }: { summary: MyTaskSummary }) {
  const { t } = useTranslation();
  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {DUE_TILES.map(({ key, icon: Icon }) => {
        const count = summary[key];
        const alert = key === 'overdue' && count > 0;
        const content = (
          <>
            <span
              className={cn(
                'flex size-10 shrink-0 items-center justify-center rounded-md [&_svg]:size-5',
                alert
                  ? 'bg-status-danger text-status-danger-foreground'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              <Icon aria-hidden="true" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-2xl font-bold tabular-nums">{formatNumber(count)}</span>
              <span className="text-sm text-muted-foreground">{t(`tasks.my.sections.${key}`)}</span>
            </span>
          </>
        );
        const tile =
          'flex w-full items-center gap-3 rounded-lg border border-border bg-surface p-4 text-start';
        return (
          <li key={key}>
            {count > 0 ? (
              <a
                href={`#section-${key}`}
                className={cn(tile, 'transition-colors duration-150 ease-out hover:bg-muted/50')}
              >
                {content}
              </a>
            ) : (
              <div className={tile}>{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function TaskSection({ section, count }: { section: Section; count: number }) {
  const { t } = useTranslation();
  const lists = useQueries({
    queries: section.filters.map((filters) =>
      // Rows dropped here (requested by me: assigned to me) would leave the section short.
      taskListQuery({ ...filters, pageSize: section.keep ? 100 : SECTION_SIZE }),
    ),
  });
  const ready = useQuery({ ...approvalReadyQuery(), enabled: section.ready === true });
  const sources = section.ready ? [ready] : lists;
  const pending = sources.some((source) => source.isPending);
  const failed = sources.find((source) => source.isError);
  // Merged requests can hold the same task twice (blocked and awaiting the client).
  const byId = new Map<string, Task>();
  for (const list of lists) for (const task of list.data?.items ?? []) byId.set(task.id, task);
  // A disabled query still answers from the cache: only the ready section reads it.
  for (const { tasks: sendable } of section.ready ? (ready.data?.clients ?? []) : []) {
    for (const task of sendable) byId.set(task.id, task);
  }
  const tasks = [...byId.values()]
    .filter(section.keep ?? (() => true))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, SECTION_SIZE);
  const { icon: Icon } = section;
  const titleId = `section-${section.key}`;

  return (
    <section
      id={titleId}
      aria-labelledby={`${titleId}-title`}
      className="scroll-mt-24 overflow-hidden rounded-lg border border-border bg-surface"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <Icon
          aria-hidden="true"
          className={cn(
            'size-5',
            section.alert ? 'text-destructive-text' : 'text-muted-foreground',
          )}
        />
        <h2 id={`${titleId}-title`} className="text-base font-bold">
          {t(`tasks.my.sections.${section.key}`)}
        </h2>
        <Badge tone={section.alert ? 'danger' : 'neutral'} className="tabular-nums">
          {formatNumber(count)}
        </Badge>
        {section.approvalsTab && (
          <Button
            variant="ghost"
            size="sm"
            className="ms-auto"
            render={<Link to="/approvals" search={{ tab: section.approvalsTab }} />}
          >
            {t('tasks.my.openApprovals')}
            <ArrowLeftIcon className="ltr:-scale-x-100" />
          </Button>
        )}
        {section.listSearch && count > tasks.length && (
          <Button
            variant="ghost"
            size="sm"
            className="ms-auto"
            render={<Link to="/tasks/list" search={section.listSearch} />}
          >
            {t('tasks.my.seeAll')}
            <ArrowLeftIcon className="ltr:-scale-x-100" />
          </Button>
        )}
      </div>
      {pending ? (
        <div className="flex flex-col gap-2 p-4">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : failed ? (
        <div className="p-4">
          <LoadError message={t('tasks.my.loadError')} onRetry={() => failed.refetch()} />
        </div>
      ) : (
        <TaskRows tasks={tasks} showAssignee={section.others} />
      )}
    </section>
  );
}

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {['a', 'b', 'c', 'd'].map((tile) => (
          <Skeleton key={tile} className="h-[4.5rem]" />
        ))}
      </div>
      <Skeleton className="h-40" />
      <Skeleton className="h-40" />
    </div>
  );
}
