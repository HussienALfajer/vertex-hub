import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  DEPARTMENT_CODES,
  type DepartmentCode,
  OPEN_TASK_STATUSES,
  TASK_PRIORITIES,
  TASK_SORTS,
  TASK_STATUSES,
  TASK_TYPES,
  type Task,
  type TaskPriority,
  type TaskStatus,
  type TaskType,
} from '@vertex-hub/contracts';
import {
  Avatar,
  Button,
  cn,
  EmptyState,
  Field,
  FieldLabel,
  Input,
  MultiCombobox,
  PageHeader,
  Pagination,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  type SortDirection,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSortHead,
  ToggleGroup,
  ToggleGroupItem,
} from '@vertex-hub/ui';
import {
  ArchiveIcon,
  CalendarClockIcon,
  ClipboardCheckIcon,
  FilterXIcon,
  HourglassIcon,
  ListTodoIcon,
  MessageSquareWarningIcon,
  SearchIcon,
  SendIcon,
} from 'lucide-react';
import { useCallback, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { canAll, useMe } from '../../lib/auth';
import { formatNumber } from '../../lib/format';
import {
  ALL,
  dayParam,
  flagParam,
  idParam,
  listParam,
  oneOfParam,
  pageParam,
  textParam,
} from '../../lib/search-params';
import { usePageInRange } from '../../lib/use-page-in-range';
import { useSearchText } from '../../lib/use-search-text';
import { clientListQuery } from '../clients/clients.queries';
import { departmentListQuery } from '../departments/departments.queries';
import { projectListQuery } from '../projects/projects.queries';
import { retainerListQuery } from '../retainers/retainers.queries';
import { userListQuery } from '../users/users.queries';
import { NewTaskButtons } from './my-tasks-page';
import {
  BlockedBadge,
  ChecklistCount,
  formatDue,
  NotInDepartmentBadge,
  OverLimitBadge,
  PriorityBadge,
  TaskArchivedBadge,
  TaskOverdueBadge,
  TaskStatusBadge,
  useEngagementLabel,
} from './task-badges';
import { type TaskListFilters, taskListQuery } from './tasks.queries';

type TaskSort = (typeof TASK_SORTS)[number];

export interface TaskListSearch {
  search?: string;
  /** Unset means the default: every open status. */
  status?: TaskStatus[];
  department?: DepartmentCode[];
  /** `me`, `unassigned` or a user id. */
  assignee?: string;
  /** `internal` (no client) or a client id. */
  clientId?: string;
  projectId?: string;
  retainerId?: string;
  milestoneId?: string;
  cycleLineId?: string;
  type?: TaskType;
  priority?: TaskPriority[];
  overdue?: true;
  blocked?: true;
  overLimit?: true;
  createdBy?: 'me';
  reviewer?: 'me';
  dueFrom?: string;
  dueTo?: string;
  archived?: true;
  sort?: TaskSort;
  order?: SortDirection;
  page?: number;
}

const PAGE_SIZE = 25;

export { ALL };

const DEFAULT_STATUSES: TaskStatus[] = [...OPEN_TASK_STATUSES];

/** Reads the task list filters from the URL, dropping anything malformed. */
export function parseTaskListSearch(search: Record<string, unknown>): TaskListSearch {
  return {
    search: textParam(search.search, 100),
    status: listParam(TASK_STATUSES, search.status),
    department: listParam(DEPARTMENT_CODES, search.department),
    assignee:
      search.assignee === 'me' || search.assignee === 'unassigned'
        ? search.assignee
        : idParam(search.assignee),
    clientId: search.clientId === 'internal' ? 'internal' : idParam(search.clientId),
    projectId: idParam(search.projectId),
    retainerId: idParam(search.retainerId),
    milestoneId: idParam(search.milestoneId),
    cycleLineId: idParam(search.cycleLineId),
    type: oneOfParam(TASK_TYPES, search.type),
    priority: listParam(TASK_PRIORITIES, search.priority),
    overdue: flagParam(search.overdue),
    blocked: flagParam(search.blocked),
    overLimit: flagParam(search.overLimit),
    createdBy: search.createdBy === 'me' ? 'me' : undefined,
    reviewer: search.reviewer === 'me' ? 'me' : undefined,
    dueFrom: dayParam(search.dueFrom),
    dueTo: dayParam(search.dueTo),
    archived: flagParam(search.archived),
    sort: TASK_SORTS.find((sort) => sort !== 'dueDate' && sort === search.sort),
    order: search.order === 'desc' ? 'desc' : undefined,
    page: pageParam(search.page),
  };
}

/** The API's query for the URL's filters. */
function filtersOf(search: TaskListSearch, archived: boolean): TaskListFilters {
  const flag = (value: true | undefined) => (value ? 'true' : undefined);
  return {
    search: search.search,
    // Archived tasks are listed whatever their status.
    status: archived ? [...TASK_STATUSES] : (search.status ?? DEFAULT_STATUSES),
    department: search.department,
    assigneeId: search.assignee === 'unassigned' ? undefined : search.assignee,
    unassigned: search.assignee === 'unassigned' ? 'true' : undefined,
    clientId: search.clientId === 'internal' ? undefined : search.clientId,
    internal: search.clientId === 'internal' ? 'true' : undefined,
    projectId: search.projectId,
    retainerId: search.retainerId,
    milestoneId: search.milestoneId,
    cycleLineId: search.cycleLineId,
    type: search.type,
    priority: search.priority,
    overdue: flag(search.overdue),
    blocked: flag(search.blocked),
    overLimit: flag(search.overLimit),
    createdBy: search.createdBy,
    reviewer: search.reviewer,
    dueFrom: search.dueFrom,
    dueTo: search.dueTo,
    archived: archived ? 'true' : undefined,
    sort: search.sort,
    order: search.order,
  };
}

export function TaskListPage({ search }: { search: TaskListSearch }) {
  const { t } = useTranslation();
  const me = useMe();
  const scopeAll = canAll(me, 'tasks.manage');
  const navigate = useNavigate({ from: '/tasks/list' });
  const page = search.page ?? 1;
  const archived = scopeAll && search.archived === true;
  const tasks = useQuery(
    taskListQuery({ ...filtersOf(search, archived), page, pageSize: PAGE_SIZE }),
  );
  usePageInRange(
    page,
    tasks.data?.total,
    PAGE_SIZE,
    useCallback(
      (next: number | undefined) =>
        navigate({ search: (previous) => ({ ...previous, page: next }), replace: true }),
      [navigate],
    ),
  );

  const setFilter = useCallback(
    (next: Partial<TaskListSearch>) =>
      navigate({
        search: (previous) => ({ ...previous, ...next, page: undefined }),
        replace: true,
      }),
    [navigate],
  );
  const filtered = Object.entries(search).some(
    ([key, value]) => !['page', 'archived', 'sort', 'order'].includes(key) && value !== undefined,
  );
  const sort = search.sort ?? 'dueDate';
  const order = search.order ?? 'asc';
  const sortBy = (column: TaskSort) => {
    // A second click turns the column around; priority starts with the most urgent.
    const first: SortDirection = column === 'priority' ? 'desc' : 'asc';
    const next = column !== sort ? first : order === 'asc' ? 'desc' : 'asc';
    return navigate({
      search: (previous) => ({
        ...previous,
        sort: column === 'dueDate' ? undefined : column,
        order: next === 'desc' ? 'desc' : undefined,
        page: undefined,
      }),
      replace: true,
    });
  };

  return (
    <>
      <PageHeader
        title={t('tasks.list.title')}
        description={t('tasks.list.subtitle')}
        actions={<NewTaskButtons />}
      />
      <Filters
        search={search}
        archived={archived}
        scopeAll={scopeAll}
        filtered={filtered}
        onChange={setFilter}
      />
      {tasks.isPending ? (
        <TableSkeleton />
      ) : tasks.isError ? (
        <LoadError message={t('tasks.list.loadError')} onRetry={() => tasks.refetch()} />
      ) : tasks.data.items.length === 0 ? (
        archived && !filtered ? (
          <EmptyState icon={<ArchiveIcon />} title={t('tasks.list.archivedEmptyTitle')} />
        ) : (
          <EmptyState
            icon={filtered ? <SearchIcon /> : <ListTodoIcon />}
            title={filtered ? t('tasks.list.emptyTitle') : t('tasks.list.noTasksTitle')}
            description={filtered ? t('tasks.list.emptyHint') : t('tasks.list.noTasksHint')}
            action={!filtered && <NewTaskButtons />}
          />
        )
      ) : (
        <div className="flex flex-col gap-4">
          <TasksTable
            tasks={tasks.data.items}
            archived={archived}
            sort={sort}
            order={order}
            onSort={sortBy}
          />
          <Pagination
            page={page}
            pageCount={Math.ceil(tasks.data.total / PAGE_SIZE)}
            onPageChange={(next) =>
              navigate({ search: (previous) => ({ ...previous, page: next }) })
            }
            summary={t('common.pageSummary', {
              from: formatNumber((page - 1) * PAGE_SIZE + 1),
              to: formatNumber((page - 1) * PAGE_SIZE + tasks.data.items.length),
              total: formatNumber(tasks.data.total),
            })}
            previousLabel={t('common.previous')}
            nextLabel={t('common.next')}
          />
        </div>
      )}
    </>
  );
}

function Filters({
  search,
  archived,
  scopeAll,
  filtered,
  onChange,
}: {
  search: TaskListSearch;
  archived: boolean;
  scopeAll: boolean;
  filtered: boolean;
  onChange: (next: Partial<TaskListSearch>) => void;
}) {
  const { t } = useTranslation();
  const ids = { from: useId(), to: useId(), departments: useId() };
  const clients = useQuery(
    clientListQuery({ status: ['active', 'paused', 'ended'], pageSize: 100 }),
  );
  const users = useQuery(userListQuery({ pageSize: 100 }));
  const departments = useQuery(departmentListQuery);
  const clientId = search.clientId && search.clientId !== 'internal' ? search.clientId : undefined;
  const projects = useQuery({
    ...projectListQuery({
      clientId,
      status: ['planned', 'active', 'on_hold', 'completed', 'cancelled'],
      pageSize: 100,
    }),
    enabled: !!clientId,
  });
  const retainers = useQuery({
    ...retainerListQuery({ clientId, status: ['active', 'paused', 'ended'], pageSize: 100 }),
    enabled: !!clientId,
  });
  const [text, setText] = useSearchText(search.search, onChange);

  const clientItems = [
    { value: ALL, label: t('tasks.filters.allClients') },
    { value: 'internal', label: t('tasks.filters.internal') },
    ...(clients.data?.items ?? []).map((client) => ({
      value: client.id,
      label: client.tradeName,
    })),
  ];
  const assigneeItems = [
    { value: ALL, label: t('tasks.filters.allAssignees') },
    { value: 'me', label: t('tasks.filters.me') },
    { value: 'unassigned', label: t('tasks.unassigned') },
    ...(users.data?.items ?? []).map((user) => ({ value: user.id, label: user.name })),
  ];
  const engagementItems = [
    { value: ALL, label: t('tasks.filters.allEngagements') },
    ...(projects.data?.items ?? []).map((project) => ({
      value: `project:${project.id}`,
      label: project.name,
    })),
    ...(retainers.data?.items ?? []).map((retainer) => ({
      value: `retainer:${retainer.id}`,
      label: retainer.name,
    })),
  ];
  const engagement = search.projectId
    ? `project:${search.projectId}`
    : search.retainerId
      ? `retainer:${search.retainerId}`
      : ALL;
  const typeItems = [
    { value: ALL, label: t('tasks.filters.allTypes') },
    ...TASK_TYPES.map((type) => ({ value: type, label: t(`tasks.types.${type}`) })),
  ];
  const departmentOptions = (departments.data?.items ?? []).map(({ code, name }) => ({
    code,
    name,
  }));
  const toggles = [
    { key: 'overdue', icon: CalendarClockIcon, label: t('tasks.filters.overdue') },
    { key: 'blocked', icon: HourglassIcon, label: t('tasks.filters.blocked') },
    { key: 'overLimit', icon: MessageSquareWarningIcon, label: t('tasks.filters.overLimit') },
  ] as const;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t('tasks.list.search')}
            aria-label={t('tasks.list.search')}
            className="ps-9"
          />
        </div>
        <ToggleGroup
          multiple
          aria-label={t('tasks.filters.priority')}
          value={search.priority ?? []}
          onValueChange={(next: TaskPriority[]) =>
            onChange({ priority: next.length > 0 ? next : undefined })
          }
        >
          {TASK_PRIORITIES.map((priority) => (
            <ToggleGroupItem key={priority} value={priority}>
              {t(`tasks.priorities.${priority}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {!archived && (
        <ToggleGroup
          multiple
          aria-label={t('tasks.filters.status')}
          value={search.status ?? DEFAULT_STATUSES}
          onValueChange={(next: TaskStatus[]) => {
            if (next.length === 0) return;
            const isDefault =
              next.length === DEFAULT_STATUSES.length &&
              DEFAULT_STATUSES.every((status) => next.includes(status));
            onChange({ status: isDefault ? undefined : next });
          }}
          className="max-w-full overflow-x-auto"
        >
          {TASK_STATUSES.map((status) => (
            <ToggleGroupItem key={status} value={status}>
              {t(`tasks.statuses.${status}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FilterSelect
          label={t('tasks.filters.client')}
          items={clientItems}
          value={search.clientId ?? ALL}
          onChange={(value) =>
            onChange({
              clientId: value === ALL ? undefined : value,
              projectId: undefined,
              retainerId: undefined,
              milestoneId: undefined,
              cycleLineId: undefined,
            })
          }
        />
        {clientId && (
          <FilterSelect
            label={t('tasks.filters.engagement')}
            items={engagementItems}
            value={engagement}
            onChange={(value) => {
              const [kind, id] = value.split(':');
              onChange({
                projectId: kind === 'project' ? id : undefined,
                retainerId: kind === 'retainer' ? id : undefined,
                milestoneId: undefined,
                cycleLineId: undefined,
              });
            }}
          />
        )}
        <FilterSelect
          label={t('tasks.filters.assignee')}
          items={assigneeItems}
          value={search.assignee ?? ALL}
          onChange={(value) => onChange({ assignee: value === ALL ? undefined : value })}
        />
        <FilterSelect
          label={t('tasks.filters.type')}
          items={typeItems}
          value={search.type ?? ALL}
          onChange={(value) => onChange({ type: TASK_TYPES.find((type) => type === value) })}
        />
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor={ids.departments} className="sr-only">
            {t('tasks.filters.department')}
          </FieldLabel>
          <MultiCombobox
            id={ids.departments}
            items={departmentOptions}
            value={(search.department ?? []).flatMap(
              (code) => departmentOptions.find((option) => option.code === code) ?? [],
            )}
            onValueChange={(next) =>
              onChange({ department: next.length > 0 ? next.map(({ code }) => code) : undefined })
            }
            itemToLabel={(item) => item.name}
            itemToKey={(item) => item.code}
            placeholder={t('tasks.filters.allDepartments')}
            emptyLabel={t('common.noMatches')}
            removeLabel={(label) => t('common.remove', { label })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3 sm:col-span-2">
          <Field>
            <FieldLabel htmlFor={ids.from} className="text-xs text-muted-foreground">
              {t('tasks.filters.dueFrom')}
            </FieldLabel>
            <Input
              id={ids.from}
              type="date"
              value={search.dueFrom ?? ''}
              onChange={(event) => onChange({ dueFrom: event.target.value || undefined })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={ids.to} className="text-xs text-muted-foreground">
              {t('tasks.filters.dueTo')}
            </FieldLabel>
            <Input
              id={ids.to}
              type="date"
              value={search.dueTo ?? ''}
              min={search.dueFrom}
              onChange={(event) => onChange({ dueTo: event.target.value || undefined })}
            />
          </Field>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {toggles.map(({ key, icon: Icon, label }) => (
          <Button
            key={key}
            variant={search[key] ? 'secondary' : 'outline'}
            size="sm"
            aria-pressed={search[key] === true}
            onClick={() => onChange({ [key]: search[key] ? undefined : true })}
          >
            <Icon />
            {label}
          </Button>
        ))}
        <Button
          variant={search.reviewer ? 'secondary' : 'outline'}
          size="sm"
          aria-pressed={search.reviewer === 'me'}
          onClick={() => onChange({ reviewer: search.reviewer ? undefined : 'me' })}
        >
          <ClipboardCheckIcon />
          {t('tasks.filters.toReview')}
        </Button>
        <Button
          variant={search.createdBy ? 'secondary' : 'outline'}
          size="sm"
          aria-pressed={search.createdBy === 'me'}
          onClick={() => onChange({ createdBy: search.createdBy ? undefined : 'me' })}
        >
          <SendIcon />
          {t('tasks.filters.requestedByMe')}
        </Button>
        {scopeAll && (
          <Button
            variant={archived ? 'secondary' : 'outline'}
            size="sm"
            aria-pressed={archived}
            onClick={() => onChange({ archived: archived ? undefined : true })}
          >
            <ArchiveIcon />
            {t('tasks.filters.archived')}
          </Button>
        )}
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            className="ms-auto"
            onClick={() =>
              onChange(
                Object.fromEntries(
                  Object.keys(search)
                    .filter((key) => !['archived', 'sort', 'order'].includes(key))
                    .map((key) => [key, undefined]),
                ),
              )
            }
          >
            <FilterXIcon />
            {t('tasks.filters.clear')}
          </Button>
        )}
      </div>
    </div>
  );
}

export function FilterSelect({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select items={items} value={value} onValueChange={(next) => onChange(next ?? ALL)}>
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TasksTable({
  tasks,
  archived,
  sort,
  order,
  onSort,
}: {
  tasks: Task[];
  archived: boolean;
  sort: TaskSort;
  order: SortDirection;
  onSort: (column: TaskSort) => void;
}) {
  const { t } = useTranslation();
  const engagementOf = useEngagementLabel();
  const direction = (column: TaskSort) => (sort === column ? order : null);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('tasks.columns.task')}</TableHead>
          <TableHead>{t('tasks.columns.assignee')}</TableHead>
          <TableHead>{t('tasks.columns.status')}</TableHead>
          <TableSortHead direction={direction('priority')} onSort={() => onSort('priority')}>
            {t('tasks.columns.priority')}
          </TableSortHead>
          <TableSortHead direction={direction('dueDate')} onSort={() => onSort('dueDate')}>
            {t('tasks.columns.dueDate')}
          </TableSortHead>
          <TableHead>{t('tasks.columns.progress')}</TableHead>
          <TableHead>{t('tasks.columns.type')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((task) => {
          const engagement = engagementOf(task);
          return (
            <TableRow key={task.id}>
              <TableCell className="min-w-64 whitespace-normal">
                <span className="flex flex-col gap-0.5">
                  <Link
                    to="/tasks/$taskId"
                    params={{ taskId: task.id }}
                    className={cn(
                      'font-medium hover:underline',
                      task.status === 'cancelled' && 'text-muted-foreground line-through',
                    )}
                  >
                    {task.title}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {[task.client?.name ?? t('tasks.internal'), engagement]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </TableCell>
              <TableCell>
                {task.assignee ? (
                  <span className="flex items-center gap-2">
                    <Avatar
                      name={task.assignee.name}
                      size="sm"
                      tone={task.assignee.archived ? 'muted' : 'brand'}
                    />
                    <span className="flex flex-col items-start gap-0.5">
                      {task.assignee.name}
                      {!task.assignee.inDepartment && <NotInDepartmentBadge />}
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">{t('tasks.unassigned')}</span>
                )}
              </TableCell>
              <TableCell>
                <span className="flex flex-wrap items-center gap-1.5">
                  <TaskStatusBadge status={task.status} />
                  {task.blocked && <BlockedBadge />}
                  {task.overLimitPending && <OverLimitBadge />}
                  {archived && <TaskArchivedBadge />}
                </span>
              </TableCell>
              <TableCell>
                <PriorityBadge priority={task.priority} />
              </TableCell>
              <TableCell>
                <span className="flex flex-col items-start gap-1">
                  <span>{formatDue(task)}</span>
                  {task.overdue && <TaskOverdueBadge />}
                </span>
              </TableCell>
              <TableCell>
                <span className="flex flex-col items-start gap-1">
                  <ChecklistCount checklist={task.checklist} />
                  {task.revisions.clientCount > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {t('tasks.revisionsCount', {
                        used: formatNumber(task.revisions.clientCount),
                        limit: formatNumber(task.revisions.limit),
                      })}
                    </span>
                  )}
                </span>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {t(`tasks.types.${task.type}`)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      {['a', 'b', 'c', 'd', 'e'].map((row) => (
        <div key={row} className="flex items-center gap-3">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="ms-auto h-4 w-32" />
        </div>
      ))}
    </div>
  );
}
