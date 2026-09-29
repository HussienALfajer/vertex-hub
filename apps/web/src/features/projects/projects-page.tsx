import { useQueries, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  DEPARTMENT_CODES,
  type DepartmentCode,
  OPEN_PROJECT_STATUSES,
  PROJECT_STATUSES,
  type Project,
  type ProjectStatus,
} from '@vertex-hub/contracts';
import {
  Avatar,
  Button,
  cn,
  EmptyState,
  Input,
  Meter,
  PageHeader,
  Pagination,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToggleGroup,
  ToggleGroupItem,
} from '@vertex-hub/ui';
import {
  ArchiveIcon,
  CalendarClockIcon,
  FilterXIcon,
  FolderKanbanIcon,
  type LucideIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  SproutIcon,
  UserRoundCheckIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { canAll, useMe } from '../../lib/auth';
import { formatCalendarDate, formatNumber } from '../../lib/format';
import { clientListQuery } from '../clients/clients.queries';
import { departmentListQuery } from '../departments/departments.queries';
import { userListQuery } from '../users/users.queries';
import { projectCreateScope } from './project-access';
import {
  ArchivedBadge,
  DepartmentChips,
  MilestoneProgress,
  OverdueBadge,
  PersonName,
  ProjectStatusBadge,
} from './project-badges';
import { type ProjectListFilters, projectListQuery } from './projects.queries';

export interface ProjectsSearch {
  search?: string;
  /** Unset means the default: planned, active and on hold. */
  status?: ProjectStatus[];
  clientId?: string;
  projectManagerId?: string;
  department?: DepartmentCode;
  overdue?: true;
  archived?: true;
  page?: number;
}

const PAGE_SIZE = 25;
const ALL = 'all';
const DEFAULT_STATUSES: ProjectStatus[] = [...OPEN_PROJECT_STATUSES];

/** Reads the project list filters from the URL, dropping anything malformed. */
export function parseProjectsSearch(search: Record<string, unknown>): ProjectsSearch {
  const text = (value: unknown, max: number) =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
  const statuses = Array.isArray(search.status)
    ? PROJECT_STATUSES.filter((status) => (search.status as unknown[]).includes(status))
    : [];
  const page = Number(search.page);
  return {
    search: text(search.search, 100),
    status: statuses.length > 0 ? statuses : undefined,
    clientId: text(search.clientId, 36),
    projectManagerId: text(search.projectManagerId, 36),
    department: DEPARTMENT_CODES.find((code) => code === search.department),
    overdue: search.overdue === true ? true : undefined,
    archived: search.archived === true ? true : undefined,
    page: Number.isInteger(page) && page > 1 ? page : undefined,
  };
}

export function ProjectsPage({ search }: { search: ProjectsSearch }) {
  const { t } = useTranslation();
  const me = useMe();
  const scopeAll = canAll(me, 'projects.manage');
  const canCreate = projectCreateScope(me) !== null;
  const navigate = useNavigate({ from: '/projects/' });
  const page = search.page ?? 1;
  const archived = scopeAll && search.archived === true;

  const projects = useQuery(
    projectListQuery({
      search: search.search,
      // Archived projects are listed whatever their status.
      status: archived ? [...PROJECT_STATUSES] : (search.status ?? DEFAULT_STATUSES),
      clientId: search.clientId,
      projectManagerId: search.projectManagerId,
      department: search.department,
      overdue: search.overdue ? 'true' : undefined,
      archived: archived ? 'true' : undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
  );

  const setFilter = useCallback(
    (next: Partial<ProjectsSearch>) =>
      navigate({
        search: (previous) => ({ ...previous, ...next, page: undefined }),
        replace: true,
      }),
    [navigate],
  );
  const filtered = Object.entries(search).some(
    ([key, value]) => key !== 'page' && key !== 'archived' && value !== undefined,
  );

  return (
    <>
      <PageHeader
        title={t('projects.title')}
        description={t('projects.subtitle')}
        actions={
          canCreate && (
            <Button render={<Link to="/projects/new" />}>
              <PlusIcon />
              {t('projects.newProject')}
            </Button>
          )
        }
      />

      {!archived && <Pulse search={search} onChange={setFilter} />}

      <Filters
        search={search}
        archived={archived}
        scopeAll={scopeAll}
        filtered={filtered}
        onChange={setFilter}
      />

      {projects.isPending ? (
        <TableSkeleton />
      ) : projects.isError ? (
        <LoadError message={t('projects.loadError')} onRetry={() => projects.refetch()} />
      ) : projects.data.items.length === 0 ? (
        <EmptyProjects filtered={filtered} archived={archived} canCreate={canCreate} />
      ) : (
        <div className="flex flex-col gap-4">
          <ProjectsTable projects={projects.data.items} archived={archived} />
          <Pagination
            page={page}
            pageCount={Math.ceil(projects.data.total / PAGE_SIZE)}
            onPageChange={(next) =>
              navigate({ search: (previous) => ({ ...previous, page: next }) })
            }
            summary={t('common.pageSummary', {
              from: formatNumber((page - 1) * PAGE_SIZE + 1),
              to: formatNumber((page - 1) * PAGE_SIZE + projects.data.items.length),
              total: formatNumber(projects.data.total),
            })}
            previousLabel={t('common.previous')}
            nextLabel={t('common.next')}
          />
        </div>
      )}
    </>
  );
}

interface PulseTile {
  key: 'planned' | 'active' | 'on_hold' | 'overdue';
  icon: LucideIcon;
  filters: ProjectListFilters;
  /** The list filter the tile applies when chosen. */
  apply: Partial<ProjectsSearch>;
}

const PULSE_TILES: PulseTile[] = [
  {
    key: 'active',
    icon: PlayIcon,
    filters: { status: ['active'] },
    apply: { status: ['active'], overdue: undefined },
  },
  {
    key: 'planned',
    icon: SproutIcon,
    filters: { status: ['planned'] },
    apply: { status: ['planned'], overdue: undefined },
  },
  {
    key: 'on_hold',
    icon: PauseIcon,
    filters: { status: ['on_hold'] },
    apply: { status: ['on_hold'], overdue: undefined },
  },
  {
    key: 'overdue',
    icon: CalendarClockIcon,
    filters: { overdue: 'true' },
    apply: { status: undefined, overdue: true },
  },
];

/**
 * The agency's running work at a glance: a count per open status and the overdue ones. Each tile
 * is a shortcut to that filter.
 */
function Pulse({
  search,
  onChange,
}: {
  search: ProjectsSearch;
  onChange: (next: Partial<ProjectsSearch>) => void;
}) {
  const { t } = useTranslation();
  // Only the totals are needed, so one row per request.
  const counts = useQueries({
    queries: PULSE_TILES.map((tile) => projectListQuery({ ...tile.filters, pageSize: 1 })),
  });
  const isChosen = (tile: PulseTile) =>
    tile.key === 'overdue'
      ? search.overdue === true && !search.status
      : search.status?.length === 1 && search.status[0] === tile.key && !search.overdue;

  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {PULSE_TILES.map((tile, index) => {
        const { icon: Icon } = tile;
        const total = counts[index]?.data?.total;
        const chosen = isChosen(tile);
        const alert = tile.key === 'overdue' && (total ?? 0) > 0;
        return (
          <li key={tile.key}>
            <button
              type="button"
              aria-pressed={chosen}
              onClick={() =>
                onChange(chosen ? { status: undefined, overdue: undefined } : tile.apply)
              }
              className={cn(
                'group relative flex w-full items-center gap-3 overflow-hidden rounded-lg border border-border bg-surface p-4 text-start',
                'transition-colors duration-150 ease-out hover:bg-muted/50',
                'aria-pressed:border-primary',
              )}
            >
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
                <span className="text-2xl font-bold tabular-nums">
                  {total === undefined ? t('common.none') : formatNumber(total)}
                </span>
                <span className="truncate text-sm text-muted-foreground">
                  {t(`projects.pulse.${tile.key}`)}
                </span>
              </span>
              <span
                aria-hidden="true"
                className="absolute inset-y-3 start-0 w-1 -skew-x-30 bg-accent opacity-0 transition-opacity duration-150 group-aria-pressed:opacity-100"
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Filters({
  search,
  archived,
  scopeAll,
  filtered,
  onChange,
}: {
  search: ProjectsSearch;
  archived: boolean;
  scopeAll: boolean;
  filtered: boolean;
  onChange: (next: Partial<ProjectsSearch>) => void;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const clients = useQuery(
    clientListQuery({ status: ['active', 'paused', 'ended'], pageSize: 100 }),
  );
  const managers = useQuery(userListQuery({ pageSize: 100 }));
  const departments = useQuery(departmentListQuery);
  const [text, setText] = useState(search.search ?? '');
  const mine = search.projectManagerId === me.user.id;

  // Follow the URL when it changes from outside (the sidebar link clears the search).
  useEffect(() => setText(search.search ?? ''), [search.search]);

  // Search as the user types, without a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      if ((search.search ?? '') !== text.trim()) onChange({ search: text.trim() || undefined });
    }, 300);
    return () => clearTimeout(timer);
  }, [text, search.search, onChange]);

  const clientItems = [
    { value: ALL, label: t('projects.filters.allClients') },
    ...(clients.data?.items ?? []).map((client) => ({
      value: client.id,
      label: client.tradeName,
    })),
  ];
  const managerItems = [
    { value: ALL, label: t('projects.filters.allManagers') },
    ...(managers.data?.items ?? []).map((user) => ({ value: user.id, label: user.name })),
  ];
  const departmentItems = [
    { value: ALL, label: t('projects.filters.allDepartments') },
    ...(departments.data?.items ?? []).map((department) => ({
      value: department.code,
      label: department.name,
    })),
  ];

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
            placeholder={t('projects.search')}
            aria-label={t('projects.search')}
            className="ps-9"
          />
        </div>
        {!archived && (
          <ToggleGroup
            multiple
            aria-label={t('projects.filters.status')}
            value={search.status ?? DEFAULT_STATUSES}
            onValueChange={(next: ProjectStatus[]) => {
              if (next.length === 0) return;
              const isDefault =
                next.length === DEFAULT_STATUSES.length &&
                DEFAULT_STATUSES.every((status) => next.includes(status));
              onChange({ status: isDefault ? undefined : next });
            }}
            className="max-w-full overflow-x-auto"
          >
            {PROJECT_STATUSES.map((status) => (
              <ToggleGroupItem key={status} value={status}>
                {t(`projects.statuses.${status}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </div>
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
        <FilterSelect
          label={t('projects.filters.client')}
          items={clientItems}
          value={search.clientId ?? ALL}
          onChange={(value) => onChange({ clientId: value === ALL ? undefined : value })}
        />
        <FilterSelect
          label={t('projects.filters.projectManager')}
          items={managerItems}
          value={search.projectManagerId ?? ALL}
          onChange={(value) => onChange({ projectManagerId: value === ALL ? undefined : value })}
        />
        <FilterSelect
          label={t('projects.filters.department')}
          items={departmentItems}
          value={search.department ?? ALL}
          onChange={(value) =>
            onChange({
              department: DEPARTMENT_CODES.find((code) => code === value),
            })
          }
        />
        <div className="flex flex-wrap items-center gap-2 md:ms-auto">
          <Button
            variant={search.overdue ? 'secondary' : 'outline'}
            size="sm"
            aria-pressed={search.overdue === true}
            onClick={() => onChange({ overdue: search.overdue ? undefined : true })}
          >
            <CalendarClockIcon />
            {t('projects.filters.overdue')}
          </Button>
          <Button
            variant={mine ? 'secondary' : 'outline'}
            size="sm"
            aria-pressed={mine}
            onClick={() => onChange({ projectManagerId: mine ? undefined : me.user.id })}
          >
            <UserRoundCheckIcon />
            {t('projects.filters.mine')}
          </Button>
          {scopeAll && (
            <Button
              variant={archived ? 'secondary' : 'outline'}
              size="sm"
              aria-pressed={archived}
              onClick={() => onChange({ archived: archived ? undefined : true })}
            >
              <ArchiveIcon />
              {t('projects.filters.archived')}
            </Button>
          )}
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onChange({
                  search: undefined,
                  status: undefined,
                  clientId: undefined,
                  projectManagerId: undefined,
                  department: undefined,
                  overdue: undefined,
                })
              }
            >
              <FilterXIcon />
              {t('projects.filters.clear')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterSelect({
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
      <SelectTrigger aria-label={label} className="md:w-52">
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

function ProjectsTable({ projects, archived }: { projects: Project[]; archived: boolean }) {
  const { t } = useTranslation();
  // Progress comes from tasks (F06); the column appears once some project has tasks.
  const showProgress = projects.some((project) => project.progress !== null);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('projects.columns.project')}</TableHead>
          <TableHead>{t('projects.columns.projectManager')}</TableHead>
          <TableHead>{t('projects.columns.departments')}</TableHead>
          <TableHead>{t('projects.columns.status')}</TableHead>
          <TableHead>{t('projects.columns.dueDate')}</TableHead>
          <TableHead>{t('projects.columns.milestones')}</TableHead>
          {showProgress && <TableHead>{t('projects.columns.progress')}</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {projects.map((project) => (
          <TableRow key={project.id}>
            <TableCell className="whitespace-normal">
              <Link
                to="/projects/$projectId"
                params={{ projectId: project.id }}
                className="group flex items-center gap-3 rounded-md outline-offset-4"
              >
                <Avatar
                  name={project.client.name}
                  shape="square"
                  tone={archived || project.status === 'cancelled' ? 'muted' : 'brand'}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium group-hover:underline">{project.name}</span>
                  <span className="text-xs text-muted-foreground">{project.client.name}</span>
                </span>
              </Link>
            </TableCell>
            <TableCell>
              <PersonName
                name={project.projectManager.name}
                archived={project.projectManager.archived}
              />
            </TableCell>
            <TableCell>
              <DepartmentChips codes={project.departments} max={2} />
            </TableCell>
            <TableCell>
              <span className="flex flex-wrap items-center gap-1.5">
                <ProjectStatusBadge status={project.status} />
                {archived && <ArchivedBadge />}
              </span>
            </TableCell>
            <TableCell>
              <span className="flex flex-col items-start gap-1">
                <span>{formatCalendarDate(project.dueDate)}</span>
                {project.overdue && <OverdueBadge />}
              </span>
            </TableCell>
            <TableCell>
              <MilestoneProgress progress={project.milestoneProgress} />
            </TableCell>
            {showProgress && (
              <TableCell>
                {project.progress !== null && (
                  <span className="flex items-center gap-2">
                    <Meter
                      value={project.progress}
                      aria-label={t('projects.columns.progress')}
                      className="w-20"
                    />
                    <span className="text-xs text-muted-foreground">
                      {formatNumber(project.progress / 100, { style: 'percent' })}
                    </span>
                  </span>
                )}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function EmptyProjects({
  filtered,
  archived,
  canCreate,
}: {
  filtered: boolean;
  archived: boolean;
  canCreate: boolean;
}) {
  const { t } = useTranslation();
  if (filtered) {
    return (
      <EmptyState
        icon={<SearchIcon />}
        title={t('projects.emptyTitle')}
        description={t('projects.emptyHint')}
      />
    );
  }
  if (archived) {
    return <EmptyState icon={<ArchiveIcon />} title={t('projects.archivedEmptyTitle')} />;
  }
  return (
    <EmptyState
      icon={<FolderKanbanIcon />}
      title={t('projects.noProjectsTitle')}
      description={t('projects.noProjectsHint')}
      action={
        canCreate && (
          <Button render={<Link to="/projects/new" />}>
            <PlusIcon />
            {t('projects.newProject')}
          </Button>
        )
      }
    />
  );
}

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      {['a', 'b', 'c', 'd', 'e'].map((row) => (
        <div key={row} className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-lg" />
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="ms-auto h-4 w-32" />
        </div>
      ))}
    </div>
  );
}
