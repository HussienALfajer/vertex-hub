import { useQueries, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  DEPARTMENT_CODES,
  type DepartmentCode,
  RETAINER_STATUSES,
  type Retainer,
  type RetainerStatus,
} from '@vertex-hub/contracts';
import {
  Avatar,
  Button,
  cn,
  EmptyState,
  Input,
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
  type LucideIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RepeatIcon,
  SearchIcon,
  TrendingDownIcon,
  UserRoundCheckIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { canAll, scopesOf, useMe } from '../../lib/auth';
import { formatNumber } from '../../lib/format';
import { clientListQuery } from '../clients/clients.queries';
import { departmentListQuery } from '../departments/departments.queries';
import { projectCreateScope } from '../projects/project-access';
import { ArchivedBadge, DepartmentChips, PersonName } from '../projects/project-badges';
import { userListQuery } from '../users/users.queries';
import {
  BehindBadge,
  CycleCounters,
  DeliveryRate,
  RenewalBadge,
  RetainerStatusBadge,
} from './retainer-badges';
import { type RetainerListFilters, retainerListQuery } from './retainers.queries';

export interface RetainersSearch {
  search?: string;
  /** Unset means the default: active and paused. */
  status?: RetainerStatus[];
  clientId?: string;
  accountManagerId?: string;
  department?: DepartmentCode;
  behind?: true;
  renewalDue?: true;
  archived?: true;
  page?: number;
}

const PAGE_SIZE = 25;
const ALL = 'all';
const DEFAULT_STATUSES: RetainerStatus[] = ['active', 'paused'];

/** Reads the retainer list filters from the URL, dropping anything malformed. */
export function parseRetainersSearch(search: Record<string, unknown>): RetainersSearch {
  const text = (value: unknown, max: number) =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
  const statuses = Array.isArray(search.status)
    ? RETAINER_STATUSES.filter((status) => (search.status as unknown[]).includes(status))
    : [];
  const page = Number(search.page);
  return {
    search: text(search.search, 100),
    status: statuses.length > 0 ? statuses : undefined,
    clientId: text(search.clientId, 36),
    accountManagerId: text(search.accountManagerId, 36),
    department: DEPARTMENT_CODES.find((code) => code === search.department),
    behind: search.behind === true ? true : undefined,
    renewalDue: search.renewalDue === true ? true : undefined,
    archived: search.archived === true ? true : undefined,
    page: Number.isInteger(page) && page > 1 ? page : undefined,
  };
}

export function RetainersPage({ search }: { search: RetainersSearch }) {
  const { t } = useTranslation();
  const me = useMe();
  const scopeAll = canAll(me, 'projects.manage');
  const canCreate = projectCreateScope(me) !== null;
  const navigate = useNavigate({ from: '/retainers/' });
  const page = search.page ?? 1;
  const archived = scopeAll && search.archived === true;

  const retainers = useQuery(
    retainerListQuery({
      search: search.search,
      // Archived retainers are listed whatever their status.
      status: archived ? [...RETAINER_STATUSES] : (search.status ?? DEFAULT_STATUSES),
      clientId: search.clientId,
      accountManagerId: search.accountManagerId,
      department: search.department,
      behind: search.behind ? 'true' : undefined,
      renewalDue: search.renewalDue ? 'true' : undefined,
      archived: archived ? 'true' : undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
  );

  const setFilter = useCallback(
    (next: Partial<RetainersSearch>) =>
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
        title={t('retainers.title')}
        description={t('retainers.subtitle')}
        actions={
          canCreate && (
            <Button render={<Link to="/retainers/new" />}>
              <PlusIcon />
              {t('retainers.newRetainer')}
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

      {retainers.isPending ? (
        <TableSkeleton />
      ) : retainers.isError ? (
        <LoadError message={t('retainers.loadError')} onRetry={() => retainers.refetch()} />
      ) : retainers.data.items.length === 0 ? (
        <EmptyRetainers filtered={filtered} archived={archived} canCreate={canCreate} />
      ) : (
        <div className="flex flex-col gap-4">
          <RetainersTable retainers={retainers.data.items} archived={archived} />
          <Pagination
            page={page}
            pageCount={Math.ceil(retainers.data.total / PAGE_SIZE)}
            onPageChange={(next) =>
              navigate({ search: (previous) => ({ ...previous, page: next }) })
            }
            summary={t('common.pageSummary', {
              from: formatNumber((page - 1) * PAGE_SIZE + 1),
              to: formatNumber((page - 1) * PAGE_SIZE + retainers.data.items.length),
              total: formatNumber(retainers.data.total),
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
  key: 'active' | 'paused' | 'behind' | 'renewalDue';
  icon: LucideIcon;
  filters: RetainerListFilters;
  /** The list filter the tile applies when chosen. */
  apply: Partial<RetainersSearch>;
  /** Whether a count above zero needs attention. */
  alert?: boolean;
}

const CLEAR_TILES = { status: undefined, behind: undefined, renewalDue: undefined };

const PULSE_TILES: PulseTile[] = [
  {
    key: 'active',
    icon: PlayIcon,
    filters: { status: ['active'] },
    apply: { ...CLEAR_TILES, status: ['active'] },
  },
  {
    key: 'paused',
    icon: PauseIcon,
    filters: { status: ['paused'] },
    apply: { ...CLEAR_TILES, status: ['paused'] },
  },
  {
    key: 'behind',
    icon: TrendingDownIcon,
    filters: { behind: 'true' },
    apply: { ...CLEAR_TILES, behind: true },
    alert: true,
  },
  {
    key: 'renewalDue',
    icon: CalendarClockIcon,
    filters: { renewalDue: 'true' },
    apply: { ...CLEAR_TILES, renewalDue: true },
    alert: true,
  },
];

/**
 * The monthly work at a glance: running and paused retainers, the ones behind this month (R11)
 * and the ones due for renewal (R6). Each tile is a shortcut to that filter.
 */
function Pulse({
  search,
  onChange,
}: {
  search: RetainersSearch;
  onChange: (next: Partial<RetainersSearch>) => void;
}) {
  const { t } = useTranslation();
  // Only the totals are needed, so one row per request.
  const counts = useQueries({
    queries: PULSE_TILES.map((tile) => retainerListQuery({ ...tile.filters, pageSize: 1 })),
  });
  const isChosen = (tile: PulseTile) => {
    if (tile.key === 'behind') return search.behind === true && !search.status;
    if (tile.key === 'renewalDue') return search.renewalDue === true && !search.status;
    return (
      search.status?.length === 1 &&
      search.status[0] === tile.key &&
      !search.behind &&
      !search.renewalDue
    );
  };

  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {PULSE_TILES.map((tile, index) => {
        const { icon: Icon } = tile;
        const total = counts[index]?.data?.total;
        const chosen = isChosen(tile);
        const alert = !!tile.alert && (total ?? 0) > 0;
        return (
          <li key={tile.key}>
            <button
              type="button"
              aria-pressed={chosen}
              onClick={() => onChange(chosen ? CLEAR_TILES : tile.apply)}
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
                    ? tile.key === 'behind'
                      ? 'bg-status-danger text-status-danger-foreground'
                      : 'bg-status-warning text-status-warning-foreground'
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
                  {t(`retainers.pulse.${tile.key}`)}
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
  search: RetainersSearch;
  archived: boolean;
  scopeAll: boolean;
  filtered: boolean;
  onChange: (next: Partial<RetainersSearch>) => void;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const clients = useQuery(
    clientListQuery({ status: ['active', 'paused', 'ended'], pageSize: 100 }),
  );
  const managers = useQuery(userListQuery({ pageSize: 100 }));
  const departments = useQuery(departmentListQuery);
  const [text, setText] = useState(search.search ?? '');
  // "My clients" is for account managers: the retainers of the clients they manage.
  const accountManager = scopesOf(me, 'projects.manage').includes('own_clients');
  const mine = search.accountManagerId === me.user.id;

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
    { value: ALL, label: t('retainers.filters.allAccountManagers') },
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
            placeholder={t('retainers.search')}
            aria-label={t('retainers.search')}
            className="ps-9"
          />
        </div>
        {!archived && (
          <ToggleGroup
            multiple
            aria-label={t('projects.filters.status')}
            value={search.status ?? DEFAULT_STATUSES}
            onValueChange={(next: RetainerStatus[]) => {
              if (next.length === 0) return;
              const isDefault =
                next.length === DEFAULT_STATUSES.length &&
                DEFAULT_STATUSES.every((status) => next.includes(status));
              onChange({ status: isDefault ? undefined : next });
            }}
            className="max-w-full overflow-x-auto"
          >
            {RETAINER_STATUSES.map((status) => (
              <ToggleGroupItem key={status} value={status}>
                {t(`retainers.statuses.${status}`)}
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
          label={t('retainers.filters.accountManager')}
          items={managerItems}
          value={search.accountManagerId ?? ALL}
          onChange={(value) => onChange({ accountManagerId: value === ALL ? undefined : value })}
        />
        <FilterSelect
          label={t('projects.filters.department')}
          items={departmentItems}
          value={search.department ?? ALL}
          onChange={(value) =>
            onChange({ department: DEPARTMENT_CODES.find((code) => code === value) })
          }
        />
        <div className="flex flex-wrap items-center gap-2 md:ms-auto">
          <Button
            variant={search.behind ? 'secondary' : 'outline'}
            size="sm"
            aria-pressed={search.behind === true}
            onClick={() => onChange({ behind: search.behind ? undefined : true })}
          >
            <TrendingDownIcon />
            {t('retainers.filters.behind')}
          </Button>
          <Button
            variant={search.renewalDue ? 'secondary' : 'outline'}
            size="sm"
            aria-pressed={search.renewalDue === true}
            onClick={() => onChange({ renewalDue: search.renewalDue ? undefined : true })}
          >
            <CalendarClockIcon />
            {t('retainers.filters.renewalDue')}
          </Button>
          {accountManager && (
            <Button
              variant={mine ? 'secondary' : 'outline'}
              size="sm"
              aria-pressed={mine}
              onClick={() => onChange({ accountManagerId: mine ? undefined : me.user.id })}
            >
              <UserRoundCheckIcon />
              {t('retainers.filters.mine')}
            </Button>
          )}
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
                  accountManagerId: undefined,
                  department: undefined,
                  behind: undefined,
                  renewalDue: undefined,
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

function RetainersTable({ retainers, archived }: { retainers: Retainer[]; archived: boolean }) {
  const { t } = useTranslation();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('retainers.columns.retainer')}</TableHead>
          <TableHead>{t('retainers.columns.accountManager')}</TableHead>
          <TableHead>{t('projects.columns.departments')}</TableHead>
          <TableHead>{t('projects.columns.status')}</TableHead>
          <TableHead>{t('retainers.columns.thisMonth')}</TableHead>
          <TableHead>{t('retainers.columns.deliveryRate')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {retainers.map((retainer) => (
          <TableRow key={retainer.id}>
            <TableCell className="whitespace-normal">
              <Link
                to="/retainers/$retainerId"
                params={{ retainerId: retainer.id }}
                className="group flex items-center gap-3 rounded-md outline-offset-4"
              >
                <Avatar
                  name={retainer.client.name}
                  shape="square"
                  tone={archived || retainer.status === 'ended' ? 'muted' : 'brand'}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium group-hover:underline">{retainer.name}</span>
                  <span className="text-xs text-muted-foreground">{retainer.client.name}</span>
                </span>
              </Link>
            </TableCell>
            <TableCell>
              <PersonName name={retainer.accountManager.name} />
            </TableCell>
            <TableCell>
              <DepartmentChips codes={retainer.departments} max={2} />
            </TableCell>
            <TableCell>
              <span className="flex flex-col items-start gap-1">
                <RetainerStatusBadge status={retainer.status} />
                {retainer.renewal && <RenewalBadge state={retainer.renewal} />}
                {archived && <ArchivedBadge />}
              </span>
            </TableCell>
            <TableCell className="min-w-56 whitespace-normal">
              {retainer.currentCycle ? (
                <span className="flex flex-col items-start gap-1.5">
                  <CycleCounters lines={retainer.currentCycle.lines} />
                  {retainer.currentCycle.behind && <BehindBadge />}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <RepeatIcon aria-hidden="true" className="size-4" />
                  {t('retainers.noOpenCycle')}
                </span>
              )}
            </TableCell>
            <TableCell>
              <DeliveryRate rate={retainer.currentCycle?.deliveryRate ?? null} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function EmptyRetainers({
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
        title={t('retainers.emptyTitle')}
        description={t('projects.emptyHint')}
      />
    );
  }
  if (archived) {
    return <EmptyState icon={<ArchiveIcon />} title={t('retainers.archivedEmptyTitle')} />;
  }
  return (
    <EmptyState
      icon={<RepeatIcon />}
      title={t('retainers.noRetainersTitle')}
      description={t('retainers.noRetainersHint')}
      action={
        canCreate && (
          <Button render={<Link to="/retainers/new" />}>
            <PlusIcon />
            {t('retainers.newRetainer')}
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
