import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  OPEN_QUOTE_STATUSES,
  QUOTE_STATUSES,
  type Quote,
  type QuoteStatus,
} from '@vertex-hub/contracts';
import {
  Button,
  EmptyState,
  Input,
  PageHeader,
  Pagination,
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
  FileTextIcon,
  FilterXIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  StampIcon,
  UserRoundCheckIcon,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { can, canAll, useMe } from '../../lib/auth';
import { formatCalendarDate, formatNumber } from '../../lib/format';
import { ALL, flagParam, idParam, listParam, pageParam, textParam } from '../../lib/search-params';
import { usePageInRange } from '../../lib/use-page-in-range';
import { useSearchText } from '../../lib/use-search-text';
import { clientListQuery } from '../clients/clients.queries';
import { PersonName } from '../projects/project-badges';
import { userListQuery } from '../users/users.queries';
import { type Choice, ChoiceSelect } from './choice-select';
import { NewQuoteDialog } from './new-quote-dialog';
import {
  ApprovalBadge,
  DiscardedBadge,
  ExpiresSoonBadge,
  Money,
  QuoteStatusBadge,
} from './quote-badges';
import { quoteListQuery } from './quotes.queries';

export interface QuotesSearch {
  search?: string;
  /** Unset means the default: draft, sent and expired. */
  status?: QuoteStatus[];
  clientId?: string;
  accountManagerId?: string;
  /** Drafts awaiting the General Manager's discount approval. */
  awaiting?: true;
  archived?: true;
  page?: number;
}

const PAGE_SIZE = 25;
const DEFAULT_STATUSES: QuoteStatus[] = [...OPEN_QUOTE_STATUSES];

/** Reads the quote list filters from the URL, dropping anything malformed. */
export function parseQuotesSearch(search: Record<string, unknown>): QuotesSearch {
  return {
    search: textParam(search.search, 100),
    status: listParam(QUOTE_STATUSES, search.status),
    clientId: idParam(search.clientId),
    accountManagerId: idParam(search.accountManagerId),
    awaiting: flagParam(search.awaiting),
    archived: flagParam(search.archived),
    page: pageParam(search.page),
  };
}

/** Spec screen 3: the latest version of each quote, open ones by default. */
export function QuotesPage({ search }: { search: QuotesSearch }) {
  const { t } = useTranslation();
  const me = useMe();
  const canCreate = can(me, 'quotes.manage');
  const scopeAll = canAll(me, 'quotes.read');
  const navigate = useNavigate({ from: '/quotes/' });
  const page = search.page ?? 1;
  const archived = scopeAll && search.archived === true;
  const [creating, setCreating] = useState(false);

  const quotes = useQuery(
    quoteListQuery({
      search: search.search,
      // Awaiting approval and discarded quotes are drafts, whatever the status filter says.
      status: archived || search.awaiting ? ['draft'] : (search.status ?? DEFAULT_STATUSES),
      clientId: search.clientId,
      accountManagerId: search.accountManagerId,
      approval: search.awaiting ? 'pending' : undefined,
      archived: archived ? 'true' : undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
  );
  usePageInRange(
    page,
    quotes.data?.total,
    PAGE_SIZE,
    useCallback(
      (next: number | undefined) =>
        navigate({ search: (previous) => ({ ...previous, page: next }), replace: true }),
      [navigate],
    ),
  );

  const setFilter = useCallback(
    (next: Partial<QuotesSearch>) =>
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
        title={t('quotes.title')}
        description={t('quotes.subtitle')}
        actions={
          <>
            <Button variant="outline" render={<Link to="/catalog/settings" />}>
              <SettingsIcon />
              {t('quotes.settings.link')}
            </Button>
            {canCreate && (
              <Button onClick={() => setCreating(true)}>
                <PlusIcon />
                {t('quotes.new.action')}
              </Button>
            )}
          </>
        }
      />

      <Filters
        search={search}
        archived={archived}
        scopeAll={scopeAll}
        filtered={filtered}
        onChange={setFilter}
      />

      {quotes.isPending ? (
        <TableSkeleton />
      ) : quotes.isError ? (
        <LoadError message={t('quotes.loadError')} onRetry={() => quotes.refetch()} />
      ) : quotes.data.items.length === 0 ? (
        filtered || archived ? (
          <EmptyState
            icon={archived ? <ArchiveIcon /> : <SearchIcon />}
            title={archived ? t('quotes.archivedEmptyTitle') : t('quotes.emptyTitle')}
            description={archived ? undefined : t('quotes.emptyHint')}
          />
        ) : (
          <EmptyState
            icon={<FileTextIcon />}
            title={t('quotes.noQuotesTitle')}
            description={canCreate ? t('quotes.noQuotesHint') : undefined}
            action={
              canCreate && (
                <Button onClick={() => setCreating(true)}>
                  <PlusIcon />
                  {t('quotes.new.action')}
                </Button>
              )
            }
          />
        )
      ) : (
        <div className="flex flex-col gap-4">
          <QuotesTable quotes={quotes.data.items} />
          <Pagination
            page={page}
            pageCount={Math.ceil(quotes.data.total / PAGE_SIZE)}
            onPageChange={(next) =>
              navigate({ search: (previous) => ({ ...previous, page: next }) })
            }
            summary={t('common.pageSummary', {
              from: formatNumber((page - 1) * PAGE_SIZE + 1),
              to: formatNumber((page - 1) * PAGE_SIZE + quotes.data.items.length),
              total: formatNumber(quotes.data.total),
            })}
            previousLabel={t('common.previous')}
            nextLabel={t('common.next')}
          />
        </div>
      )}

      {canCreate && <NewQuoteDialog open={creating} onClose={() => setCreating(false)} />}
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
  search: QuotesSearch;
  archived: boolean;
  scopeAll: boolean;
  filtered: boolean;
  onChange: (next: Partial<QuotesSearch>) => void;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const approver = can(me, 'quotes.approve_discount');
  const clients = useQuery(
    clientListQuery({ status: ['active', 'paused', 'ended'], pageSize: 100 }),
  );
  const managers = useQuery({ ...userListQuery({ pageSize: 100 }), enabled: scopeAll });
  const [text, setText] = useSearchText(search.search, onChange);
  const mine = search.accountManagerId === me.user.id;

  const clientItems: Choice[] = [
    { value: ALL, label: t('quotes.filters.allClients') },
    ...(clients.data?.items ?? []).map((client) => ({
      value: client.id,
      label: client.tradeName,
    })),
  ];
  const managerItems: Choice[] = [
    { value: ALL, label: t('quotes.filters.allAccountManagers') },
    ...(managers.data?.items ?? []).map((user) => ({ value: user.id, label: user.name })),
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
            placeholder={t('quotes.search')}
            aria-label={t('quotes.search')}
            className="ps-9"
          />
        </div>
        {!archived && !search.awaiting && (
          <ToggleGroup
            multiple
            aria-label={t('quotes.filters.status')}
            value={search.status ?? DEFAULT_STATUSES}
            onValueChange={(next: QuoteStatus[]) => {
              if (next.length === 0) return;
              const isDefault =
                next.length === DEFAULT_STATUSES.length &&
                DEFAULT_STATUSES.every((status) => next.includes(status));
              onChange({ status: isDefault ? undefined : next });
            }}
            className="max-w-full overflow-x-auto"
          >
            {QUOTE_STATUSES.map((status) => (
              <ToggleGroupItem key={status} value={status}>
                {t(`quotes.statuses.${status}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </div>
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
        <ChoiceSelect
          label={t('quotes.filters.client')}
          items={clientItems}
          value={search.clientId ?? ALL}
          onChange={(value) => onChange({ clientId: value === ALL ? undefined : value })}
          className="md:w-52"
        />
        {scopeAll && (
          <ChoiceSelect
            label={t('quotes.filters.accountManager')}
            items={managerItems}
            value={search.accountManagerId ?? ALL}
            onChange={(value) => onChange({ accountManagerId: value === ALL ? undefined : value })}
            className="md:w-52"
          />
        )}
        <div className="flex flex-wrap items-center gap-2 md:ms-auto">
          {approver && (
            <Button
              variant={search.awaiting ? 'secondary' : 'outline'}
              size="sm"
              aria-pressed={search.awaiting === true}
              onClick={() => onChange({ awaiting: search.awaiting ? undefined : true })}
            >
              <StampIcon />
              {t('quotes.filters.awaiting')}
            </Button>
          )}
          <Button
            variant={mine ? 'secondary' : 'outline'}
            size="sm"
            aria-pressed={mine}
            onClick={() => onChange({ accountManagerId: mine ? undefined : me.user.id })}
          >
            <UserRoundCheckIcon />
            {t('quotes.filters.mine')}
          </Button>
          {scopeAll && (
            <Button
              variant={archived ? 'secondary' : 'outline'}
              size="sm"
              aria-pressed={archived}
              onClick={() => onChange({ archived: archived ? undefined : true })}
            >
              <ArchiveIcon />
              {t('quotes.filters.archived')}
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
                  awaiting: undefined,
                })
              }
            >
              <FilterXIcon />
              {t('quotes.filters.clear')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function QuotesTable({ quotes }: { quotes: Quote[] }) {
  const { t } = useTranslation();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('quotes.columns.quote')}</TableHead>
          <TableHead>{t('quotes.columns.client')}</TableHead>
          <TableHead>{t('quotes.columns.accountManager')}</TableHead>
          <TableHead>{t('quotes.columns.status')}</TableHead>
          <TableHead className="text-end">{t('quotes.columns.oneOff')}</TableHead>
          <TableHead className="text-end">{t('quotes.columns.monthly')}</TableHead>
          <TableHead>{t('quotes.columns.validUntil')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {quotes.map((quote) => (
          <TableRow key={quote.id}>
            <TableCell className="whitespace-normal">
              <Link
                to="/quotes/$quoteId"
                params={{ quoteId: quote.id }}
                className="group flex min-w-0 flex-col rounded-md outline-offset-4"
              >
                <span className="font-medium group-hover:underline">{quote.title}</span>
                <span dir="ltr" className="text-start text-xs text-muted-foreground tabular-nums">
                  {quote.displayNumber}
                </span>
              </Link>
            </TableCell>
            <TableCell>{quote.recipient.name}</TableCell>
            <TableCell>
              <PersonName name={quote.accountManager.name} />
            </TableCell>
            <TableCell>
              <span className="flex flex-wrap items-center gap-1.5">
                <QuoteStatusBadge status={quote.status} />
                <ApprovalBadge approval={quote.discountApproval} />
                {quote.archivedAt && <DiscardedBadge />}
              </span>
            </TableCell>
            <TableCell className="text-end">
              {quote.oneOffNetMinor > 0 ? (
                <Money minor={quote.oneOffNetMinor} currency={quote.currency} />
              ) : (
                <span className="text-muted-foreground">{t('common.none')}</span>
              )}
            </TableCell>
            <TableCell className="text-end">
              {quote.monthlyNetMinor > 0 ? (
                <span className="flex flex-col items-end">
                  <Money minor={quote.monthlyNetMinor} currency={quote.currency} />
                  <span className="text-xs text-muted-foreground">{t('quotes.perMonth')}</span>
                </span>
              ) : (
                <span className="text-muted-foreground">{t('common.none')}</span>
              )}
            </TableCell>
            <TableCell>
              {quote.validUntil ? (
                <span className="flex flex-col items-start gap-1">
                  <span>{formatCalendarDate(quote.validUntil)}</span>
                  {quote.expiresSoon && <ExpiresSoonBadge />}
                </span>
              ) : (
                <span className="text-muted-foreground">{t('common.none')}</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      {['a', 'b', 'c', 'd', 'e'].map((row) => (
        <div key={row} className="flex items-center gap-3">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="ms-auto h-4 w-32" />
        </div>
      ))}
    </div>
  );
}
