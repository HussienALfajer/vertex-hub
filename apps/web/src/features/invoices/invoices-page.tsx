import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  CURRENCIES,
  type Currency,
  INVOICE_STATUSES,
  type Invoice,
  type InvoicePage,
  type InvoiceStatus,
  OPEN_INVOICE_STATUSES,
} from '@vertex-hub/contracts';
import {
  Button,
  Card,
  EmptyState,
  Field,
  FieldLabel,
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
  Tabs,
  TabsList,
  TabsTrigger,
} from '@vertex-hub/ui';
import {
  FilterXIcon,
  PlusIcon,
  ReceiptTextIcon,
  SearchIcon,
  SettingsIcon,
  UserRoundCheckIcon,
} from 'lucide-react';
import { type ReactNode, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { can, canAll, useMe } from '../../lib/auth';
import { formatCalendarDate, formatNumber } from '../../lib/format';
import { ALL, dayParam, idParam, oneOfParam, pageParam, textParam } from '../../lib/search-params';
import { usePageInRange } from '../../lib/use-page-in-range';
import { useSearchText } from '../../lib/use-search-text';
import { clientListQuery } from '../clients/clients.queries';
import { PersonName } from '../projects/project-badges';
import { type Choice, ChoiceSelect } from '../quotes/choice-select';
import { Money } from '../quotes/quote-badges';
import { userListQuery } from '../users/users.queries';
import { DaysOverdueBadge, InvoiceStatusBadge, OriginBadge } from './invoice-badges';
import { invoiceListQuery } from './invoices.queries';
import { NewInvoiceDialog } from './new-invoice-dialog';

export const INVOICE_TABS = ['to_issue', 'open', 'overdue', 'paid', 'void', 'all'] as const;

export type InvoiceTab = (typeof INVOICE_TABS)[number];

const TAB_STATUSES: Record<InvoiceTab, InvoiceStatus[]> = {
  to_issue: ['draft'],
  open: [...OPEN_INVOICE_STATUSES],
  overdue: ['overdue'],
  paid: ['paid'],
  void: ['void'],
  all: [...INVOICE_STATUSES],
};

export interface InvoicesSearch {
  /** Unset means the first tab the user may use. */
  tab?: InvoiceTab;
  search?: string;
  clientId?: string;
  currency?: Currency;
  accountManagerId?: string;
  dueFrom?: string;
  dueTo?: string;
  page?: number;
}

const PAGE_SIZE = 25;

/** Reads the invoice list filters from the URL, dropping anything malformed. */
export function parseInvoicesSearch(search: Record<string, unknown>): InvoicesSearch {
  return {
    tab: oneOfParam(INVOICE_TABS, search.tab),
    search: textParam(search.search, 100),
    clientId: idParam(search.clientId),
    currency: oneOfParam(CURRENCIES, search.currency),
    accountManagerId: idParam(search.accountManagerId),
    dueFrom: dayParam(search.dueFrom),
    dueTo: dayParam(search.dueTo),
    page: pageParam(search.page),
  };
}

/** Spec screen 1: invoices by stage, with what is outstanding and overdue above them. */
export function InvoicesPage({ search }: { search: InvoicesSearch }) {
  const { t } = useTranslation();
  const me = useMe();
  const manages = can(me, 'invoices.manage');
  const navigate = useNavigate({ from: '/invoices/' });
  // Drafts are the managers' work queue (spec screen 1).
  const tabs = INVOICE_TABS.filter((tab) => tab !== 'to_issue' || manages);
  const tab: InvoiceTab =
    search.tab && tabs.includes(search.tab) ? search.tab : (tabs[0] ?? 'open');
  const page = search.page ?? 1;
  const [creating, setCreating] = useState(false);

  const invoices = useQuery(
    invoiceListQuery({
      status: TAB_STATUSES[tab],
      search: search.search,
      clientId: search.clientId,
      currency: search.currency,
      accountManagerId: search.accountManagerId,
      dueFrom: search.dueFrom,
      dueTo: search.dueTo,
      // Open invoices by what falls due first; the rest by their last change.
      ...(tab === 'open' || tab === 'overdue' ? { sort: 'dueOn', order: 'asc' } : {}),
      page,
      pageSize: PAGE_SIZE,
    }),
  );
  usePageInRange(
    page,
    invoices.data?.total,
    PAGE_SIZE,
    useCallback(
      (next: number | undefined) =>
        navigate({ search: (previous) => ({ ...previous, page: next }), replace: true }),
      [navigate],
    ),
  );

  const setFilter = useCallback(
    (next: Partial<InvoicesSearch>) =>
      navigate({
        search: (previous) => ({ ...previous, ...next, page: undefined }),
        replace: true,
      }),
    [navigate],
  );
  const filtered = Object.entries(search).some(
    ([key, value]) => key !== 'page' && key !== 'tab' && value !== undefined,
  );

  return (
    <>
      <PageHeader
        title={t('invoices.title')}
        description={t('invoices.subtitle')}
        actions={
          <>
            <Button variant="outline" render={<Link to="/invoices/settings" />}>
              <SettingsIcon />
              {t('invoices.settings.link')}
            </Button>
            {manages && (
              <Button onClick={() => setCreating(true)}>
                <PlusIcon />
                {t('invoices.new.action')}
              </Button>
            )}
          </>
        }
      />

      {invoices.data && <Totals totals={invoices.data.totals} />}

      <Tabs
        value={tab}
        onValueChange={(next: InvoiceTab) =>
          setFilter({ tab: next === tabs[0] ? undefined : next })
        }
      >
        <TabsList aria-label={t('invoices.tabs.label')}>
          {tabs.map((item) => (
            <TabsTrigger key={item} value={item}>
              {t(`invoices.tabs.${item}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Filters search={search} filtered={filtered} onChange={setFilter} />

      {invoices.isPending ? (
        <TableSkeleton />
      ) : invoices.isError ? (
        <LoadError message={t('invoices.loadError')} onRetry={() => invoices.refetch()} />
      ) : invoices.data.items.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={<SearchIcon />}
            title={t('invoices.emptyTitle')}
            description={t('invoices.emptyHint')}
          />
        ) : (
          <EmptyState
            icon={<ReceiptTextIcon />}
            title={t(`invoices.emptyTabs.${tab}`)}
            description={tab === 'to_issue' ? t('invoices.emptyToIssueHint') : undefined}
          />
        )
      ) : (
        <div className="flex flex-col gap-4">
          <InvoicesTable invoices={invoices.data.items} />
          <Pagination
            page={page}
            pageCount={Math.ceil(invoices.data.total / PAGE_SIZE)}
            onPageChange={(next) =>
              navigate({ search: (previous) => ({ ...previous, page: next }) })
            }
            summary={t('common.pageSummary', {
              from: formatNumber((page - 1) * PAGE_SIZE + 1),
              to: formatNumber((page - 1) * PAGE_SIZE + invoices.data.items.length),
              total: formatNumber(invoices.data.total),
            })}
            previousLabel={t('common.previous')}
            nextLabel={t('common.next')}
          />
        </div>
      )}

      {manages && <NewInvoiceDialog open={creating} onClose={() => setCreating(false)} />}
    </>
  );
}

/** Outstanding and overdue per currency and in USD, over every invoice the filters match. */
function Totals({ totals }: { totals: InvoicePage['totals'] }) {
  const { t } = useTranslation();
  // With USD balances only, the total in USD would repeat the USD card.
  const usdOnly = totals.byCurrency.length === 1 && totals.byCurrency[0]?.currency === 'USD';
  return (
    <section aria-label={t('invoices.totals.label')} className="grid gap-3 sm:grid-cols-3">
      {totals.byCurrency.map((row) => (
        <Card key={row.currency} className="gap-2 p-4">
          <h2 className="text-sm text-muted-foreground">
            {t(`invoices.totals.currency.${row.currency}`)}
          </h2>
          <TotalLine label={t('invoices.totals.outstanding')}>
            <Money minor={row.outstandingMinor} currency={row.currency} className="font-bold" />
          </TotalLine>
          <TotalLine label={t('invoices.totals.overdue')}>
            <Money minor={row.overdueMinor} currency={row.currency} />
          </TotalLine>
        </Card>
      ))}
      {!usdOnly && (
        <Card className="gap-2 p-4">
          <h2 className="text-sm text-muted-foreground">{t('invoices.totals.usd')}</h2>
          <TotalLine label={t('invoices.totals.outstanding')}>
            <Money minor={totals.usd.outstandingMinor} currency="USD" className="font-bold" />
          </TotalLine>
          <TotalLine label={t('invoices.totals.overdue')}>
            <Money minor={totals.usd.overdueMinor} currency="USD" />
          </TotalLine>
        </Card>
      )}
    </section>
  );
}

function TotalLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="flex items-baseline justify-between gap-3 text-sm">
      <span>{label}</span>
      {children}
    </p>
  );
}

function Filters({
  search,
  filtered,
  onChange,
}: {
  search: InvoicesSearch;
  filtered: boolean;
  onChange: (next: Partial<InvoicesSearch>) => void;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const scopeAll = canAll(me, 'invoices.read');
  const clients = useQuery(
    clientListQuery({
      status: ['active', 'paused', 'ended'],
      accountManagerId: scopeAll ? undefined : me.user.id,
      pageSize: 100,
    }),
  );
  const managers = useQuery({ ...userListQuery({ pageSize: 100 }), enabled: scopeAll });
  const [text, setText] = useSearchText(search.search, onChange);
  const mine = search.accountManagerId === me.user.id;
  const accountManager = me.roles.includes('account_manager');

  const clientItems: Choice[] = [
    { value: ALL, label: t('invoices.filters.allClients') },
    ...(clients.data?.items ?? []).map((client) => ({
      value: client.id,
      label: client.tradeName,
    })),
  ];
  const currencyItems: Choice[] = [
    { value: ALL, label: t('invoices.filters.allCurrencies') },
    ...CURRENCIES.map((currency) => ({ value: currency, label: currency })),
  ];
  const managerItems: Choice[] = [
    { value: ALL, label: t('invoices.filters.allAccountManagers') },
    ...(managers.data?.items ?? []).map((user) => ({ value: user.id, label: user.name })),
  ];

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
        <div className="relative flex-1 md:min-w-64">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t('invoices.search')}
            aria-label={t('invoices.search')}
            className="ps-9"
          />
        </div>
        <ChoiceSelect
          label={t('invoices.filters.client')}
          items={clientItems}
          value={search.clientId ?? ALL}
          onChange={(value) => onChange({ clientId: value === ALL ? undefined : value })}
          className="md:w-52"
        />
        <ChoiceSelect
          label={t('invoices.filters.currency')}
          items={currencyItems}
          value={search.currency ?? ALL}
          onChange={(value) =>
            onChange({ currency: value === ALL ? undefined : (value as Currency) })
          }
          className="md:w-36"
        />
        {scopeAll && (
          <ChoiceSelect
            label={t('invoices.filters.accountManager')}
            items={managerItems}
            value={search.accountManagerId ?? ALL}
            onChange={(value) => onChange({ accountManagerId: value === ALL ? undefined : value })}
            className="md:w-52"
          />
        )}
      </div>
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
        <Field className="md:w-44">
          <FieldLabel>{t('invoices.filters.dueFrom')}</FieldLabel>
          <Input
            type="date"
            dir="ltr"
            value={search.dueFrom ?? ''}
            onChange={(event) => onChange({ dueFrom: event.target.value || undefined })}
          />
        </Field>
        <Field className="md:w-44">
          <FieldLabel>{t('invoices.filters.dueTo')}</FieldLabel>
          <Input
            type="date"
            dir="ltr"
            value={search.dueTo ?? ''}
            onChange={(event) => onChange({ dueTo: event.target.value || undefined })}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2 md:ms-auto">
          {accountManager && (
            <Button
              variant={mine ? 'secondary' : 'outline'}
              size="sm"
              aria-pressed={mine}
              onClick={() => onChange({ accountManagerId: mine ? undefined : me.user.id })}
            >
              <UserRoundCheckIcon />
              {t('invoices.filters.mine')}
            </Button>
          )}
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onChange({
                  search: undefined,
                  clientId: undefined,
                  currency: undefined,
                  accountManagerId: undefined,
                  dueFrom: undefined,
                  dueTo: undefined,
                })
              }
            >
              <FilterXIcon />
              {t('invoices.filters.clear')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The invoice table; on a client's or an engagement's page the columns it already names are left out. */
export function InvoicesTable({
  invoices,
  showClient = true,
  showEngagement = true,
}: {
  invoices: Invoice[];
  showClient?: boolean;
  showEngagement?: boolean;
}) {
  const { t } = useTranslation();
  const none = <span className="text-muted-foreground">{t('common.none')}</span>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('invoices.columns.number')}</TableHead>
          {showClient && <TableHead>{t('invoices.columns.client')}</TableHead>}
          {showEngagement && <TableHead>{t('invoices.columns.engagement')}</TableHead>}
          <TableHead>{t('invoices.columns.status')}</TableHead>
          <TableHead className="text-end">{t('invoices.columns.total')}</TableHead>
          <TableHead className="text-end">{t('invoices.columns.paid')}</TableHead>
          <TableHead className="text-end">{t('invoices.columns.balance')}</TableHead>
          <TableHead>{t('invoices.columns.issued')}</TableHead>
          <TableHead>{t('invoices.columns.due')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoices.map((invoice) => (
          <TableRow key={invoice.id}>
            <TableCell>
              <Link
                to="/invoices/$invoiceId"
                params={{ invoiceId: invoice.id }}
                className="flex flex-col items-start gap-1 rounded-md font-medium outline-offset-4 hover:underline"
              >
                {invoice.displayNumber ? (
                  <span dir="ltr" className="tabular-nums">
                    {invoice.displayNumber}
                  </span>
                ) : (
                  t('invoices.draftNumber')
                )}
              </Link>
              <OriginBadge origin={invoice.origin} />
            </TableCell>
            {showClient && (
              <TableCell className="whitespace-normal">
                <span className="flex flex-col">
                  <span>{invoice.client.name}</span>
                  <span className="text-xs text-muted-foreground">
                    <PersonName name={invoice.accountManager.name} />
                  </span>
                </span>
              </TableCell>
            )}
            {showEngagement && (
              <TableCell className="whitespace-normal">
                {invoice.engagement?.name ?? none}
              </TableCell>
            )}
            <TableCell>
              <InvoiceStatusBadge status={invoice.status} />
            </TableCell>
            <TableCell className="text-end">
              <Money minor={invoice.totalMinor} currency={invoice.currency} />
            </TableCell>
            <TableCell className="text-end">
              <Money minor={invoice.paidMinor} currency={invoice.currency} />
            </TableCell>
            <TableCell className="text-end font-medium">
              <Money minor={invoice.balanceMinor} currency={invoice.currency} />
            </TableCell>
            <TableCell>{invoice.issuedOn ? formatCalendarDate(invoice.issuedOn) : none}</TableCell>
            <TableCell>
              {invoice.dueOn ? (
                <span className="flex flex-col items-start gap-1">
                  <span>{formatCalendarDate(invoice.dueOn)}</span>
                  {invoice.daysOverdue !== null && <DaysOverdueBadge days={invoice.daysOverdue} />}
                </span>
              ) : (
                none
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function TableSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      {['a', 'b', 'c', 'd', 'e'].map((row) => (
        <div key={row} className="flex items-center gap-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="ms-auto h-4 w-28" />
        </div>
      ))}
    </div>
  );
}
