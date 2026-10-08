import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { CLIENT_STATUSES, type ClientResponse, type ClientStatus } from '@vertex-hub/contracts';
import {
  Avatar,
  Badge,
  Button,
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
  BriefcaseBusinessIcon,
  FilterXIcon,
  PlusIcon,
  SearchIcon,
  UserRoundCheckIcon,
} from 'lucide-react';
import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { canAll, useMe } from '../../lib/auth';
import { formatNumber } from '../../lib/format';
import { ALL, flagParam, idParam, listParam, pageParam, textParam } from '../../lib/search-params';
import { usePageInRange } from '../../lib/use-page-in-range';
import { useSearchText } from '../../lib/use-search-text';
import { ClientStatusBadge, HealthcareBadge, NoApprovalContactBadge } from './client-badges';
import { clientListQuery, sectorsQuery, useClientAccountManagers } from './clients.queries';

export interface ClientsSearch {
  search?: string;
  /** Unset means the default: active and paused. */
  status?: ClientStatus[];
  accountManagerId?: string;
  sector?: string;
  healthcare?: boolean;
  archived?: true;
  page?: number;
}

const PAGE_SIZE = 25;
const DEFAULT_STATUSES: ClientStatus[] = ['active', 'paused'];

const queryFlag = (value: boolean | undefined) =>
  value === undefined ? undefined : value ? ('true' as const) : ('false' as const);

/** Reads the client list filters from the URL, dropping anything malformed. */
export function parseClientsSearch(search: Record<string, unknown>): ClientsSearch {
  return {
    search: textParam(search.search, 100),
    status: listParam(CLIENT_STATUSES, search.status),
    accountManagerId: idParam(search.accountManagerId),
    sector: textParam(search.sector, 60),
    healthcare: typeof search.healthcare === 'boolean' ? search.healthcare : undefined,
    archived: flagParam(search.archived),
    page: pageParam(search.page),
  };
}

export function ClientsPage({ search }: { search: ClientsSearch }) {
  const { t } = useTranslation();
  const me = useMe();
  const scopeAll = canAll(me, 'clients.manage');
  const navigate = useNavigate({ from: '/clients/' });
  const page = search.page ?? 1;
  const archived = scopeAll && search.archived === true;

  const clients = useQuery(
    clientListQuery({
      search: search.search,
      // Archived clients are listed whatever their status.
      status: archived ? [...CLIENT_STATUSES] : (search.status ?? DEFAULT_STATUSES),
      accountManagerId: search.accountManagerId,
      sector: search.sector,
      healthcare: queryFlag(search.healthcare),
      archived: queryFlag(archived),
      page,
      pageSize: PAGE_SIZE,
    }),
  );
  usePageInRange(
    page,
    clients.data?.total,
    PAGE_SIZE,
    useCallback(
      (next: number | undefined) =>
        navigate({ search: (previous) => ({ ...previous, page: next }), replace: true }),
      [navigate],
    ),
  );

  const setFilter = useCallback(
    (next: Partial<ClientsSearch>) =>
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
        title={t('clients.title')}
        description={t('clients.subtitle')}
        actions={
          scopeAll && (
            <Button render={<Link to="/clients/new" />}>
              <PlusIcon />
              {t('clients.newClient')}
            </Button>
          )
        }
      />

      <Filters
        search={search}
        archived={archived}
        scopeAll={scopeAll}
        filtered={filtered}
        onChange={setFilter}
      />

      {clients.isPending ? (
        <TableSkeleton />
      ) : clients.isError ? (
        <LoadError message={t('clients.loadError')} onRetry={() => clients.refetch()} />
      ) : clients.data.items.length === 0 ? (
        <EmptyClients filtered={filtered} archived={archived} scopeAll={scopeAll} />
      ) : (
        <div className="flex flex-col gap-4">
          <ClientsTable clients={clients.data.items} archived={archived} />
          <Pagination
            page={page}
            pageCount={Math.ceil(clients.data.total / PAGE_SIZE)}
            onPageChange={(next) =>
              navigate({ search: (previous) => ({ ...previous, page: next }) })
            }
            summary={t('common.pageSummary', {
              from: formatNumber((page - 1) * PAGE_SIZE + 1),
              to: formatNumber((page - 1) * PAGE_SIZE + clients.data.items.length),
              total: formatNumber(clients.data.total),
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
  search: ClientsSearch;
  archived: boolean;
  scopeAll: boolean;
  filtered: boolean;
  onChange: (next: Partial<ClientsSearch>) => void;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const managers = useClientAccountManagers();
  const sectors = useQuery(sectorsQuery);
  const [text, setText] = useSearchText(search.search, onChange);
  const searchField = useRef<HTMLInputElement>(null);
  const isAccountManager = me.roles.includes('account_manager');
  const mine = search.accountManagerId === me.user.id;

  const managerItems = [
    { value: ALL, label: t('clients.filters.allManagers') },
    ...managers.map(({ id, name }) => ({ value: id, label: name })),
  ];
  const sectorItems = [
    { value: ALL, label: t('clients.filters.allSectors') },
    ...(sectors.data?.items ?? []).map((sector) => ({ value: sector, label: sector })),
  ];
  const healthcareItems = [
    { value: ALL, label: t('clients.filters.healthcareAny') },
    { value: 'yes', label: t('clients.filters.healthcareOnly') },
    { value: 'no', label: t('clients.filters.healthcareNone') },
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
            ref={searchField}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t('clients.search')}
            aria-label={t('clients.search')}
            className="ps-9"
          />
        </div>
        {!archived && (
          <ToggleGroup
            multiple
            aria-label={t('clients.filters.status')}
            value={search.status ?? DEFAULT_STATUSES}
            onValueChange={(next: ClientStatus[]) => {
              if (next.length === 0) return;
              const isDefault =
                next.length === DEFAULT_STATUSES.length &&
                DEFAULT_STATUSES.every((status) => next.includes(status));
              onChange({ status: isDefault ? undefined : next });
            }}
          >
            {CLIENT_STATUSES.map((status) => (
              <ToggleGroupItem key={status} value={status}>
                {t(`clients.statuses.${status}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </div>
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
        <FilterSelect
          label={t('clients.filters.accountManager')}
          items={managerItems}
          value={search.accountManagerId ?? ALL}
          onChange={(value) => onChange({ accountManagerId: value === ALL ? undefined : value })}
        />
        <FilterSelect
          label={t('clients.filters.sector')}
          items={sectorItems}
          value={search.sector ?? ALL}
          onChange={(value) => onChange({ sector: value === ALL ? undefined : value })}
        />
        <FilterSelect
          label={t('clients.filters.healthcare')}
          items={healthcareItems}
          value={search.healthcare === undefined ? ALL : search.healthcare ? 'yes' : 'no'}
          onChange={(value) =>
            onChange({ healthcare: value === ALL ? undefined : value === 'yes' })
          }
        />
        <div className="flex flex-wrap items-center gap-2 md:ms-auto">
          {isAccountManager && (
            <Button
              variant={mine ? 'secondary' : 'outline'}
              size="sm"
              aria-pressed={mine}
              onClick={() => onChange({ accountManagerId: mine ? undefined : me.user.id })}
            >
              <UserRoundCheckIcon />
              {t('clients.filters.mine')}
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
              {t('clients.filters.archived')}
            </Button>
          )}
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange({
                  search: undefined,
                  status: undefined,
                  accountManagerId: undefined,
                  sector: undefined,
                  healthcare: undefined,
                });
                // The button leaves with the filters: the focus goes to the search field.
                searchField.current?.focus();
              }}
            >
              <FilterXIcon />
              {t('clients.filters.clear')}
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

function ClientsTable({ clients, archived }: { clients: ClientResponse[]; archived: boolean }) {
  const { t } = useTranslation();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('clients.columns.client')}</TableHead>
          <TableHead>{t('clients.columns.sector')}</TableHead>
          <TableHead>{t('clients.columns.accountManager')}</TableHead>
          <TableHead>{t('clients.columns.status')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {clients.map((client) => {
          // The approval warning is about live work: an archived client has none.
          const noApproval = !client.hasApprovalContact && !archived;
          return (
            <TableRow key={client.id}>
              <TableCell className="whitespace-normal">
                <Link
                  to="/clients/$clientId"
                  params={{ clientId: client.id }}
                  className="group flex items-center gap-3 rounded-md outline-offset-4"
                >
                  <Avatar
                    name={client.tradeName}
                    shape="square"
                    tone={archived || client.status === 'ended' ? 'muted' : 'brand'}
                  />
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="font-medium group-hover:underline">{client.tradeName}</span>
                    {(client.isHealthcare || noApproval) && (
                      <span className="flex flex-wrap gap-1">
                        {client.isHealthcare && <HealthcareBadge />}
                        {noApproval && <NoApprovalContactBadge />}
                      </span>
                    )}
                  </span>
                </Link>
              </TableCell>
              <TableCell>
                {client.sector ?? <span className="text-muted-foreground">{t('common.none')}</span>}
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-2">
                  <Avatar
                    name={client.accountManager.name}
                    size="sm"
                    tone={client.accountManager.archived ? 'muted' : 'brand'}
                  />
                  <span>{client.accountManager.name}</span>
                  {client.accountManager.archived && (
                    <Badge tone="outline">{t('clients.archivedBadge')}</Badge>
                  )}
                </span>
              </TableCell>
              <TableCell>
                <span className="flex flex-wrap items-center gap-1.5">
                  <ClientStatusBadge status={client.status} />
                  {archived && <Badge tone="neutral">{t('clients.archivedBadge')}</Badge>}
                </span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function EmptyClients({
  filtered,
  archived,
  scopeAll,
}: {
  filtered: boolean;
  archived: boolean;
  scopeAll: boolean;
}) {
  const { t } = useTranslation();
  if (filtered) {
    return (
      <EmptyState
        icon={<SearchIcon />}
        title={t('clients.emptyTitle')}
        description={t('clients.emptyHint')}
      />
    );
  }
  if (archived) {
    return (
      <EmptyState
        icon={<ArchiveIcon />}
        title={t('clients.archivedEmptyTitle')}
        description={t('clients.archivedEmptyHint')}
      />
    );
  }
  return (
    <EmptyState
      icon={<BriefcaseBusinessIcon />}
      title={t('clients.noClientsTitle')}
      description={scopeAll ? t('clients.noClientsHint') : undefined}
      action={
        scopeAll && (
          <Button render={<Link to="/clients/new" />}>
            <PlusIcon />
            {t('clients.newClient')}
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
