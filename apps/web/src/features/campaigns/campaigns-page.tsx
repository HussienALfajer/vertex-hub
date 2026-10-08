import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  AD_CAMPAIGN_STATUSES,
  AD_FUNDINGS,
  AD_PLATFORMS,
  type AdCampaignStatus,
  type AdFunding,
  type AdPlatform,
  type Campaign,
  OPEN_AD_CAMPAIGN_STATUSES,
  type WalletSummary,
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
  Tabs,
  TabsList,
  TabsTrigger,
} from '@vertex-hub/ui';
import {
  FilterXIcon,
  MegaphoneIcon,
  PlusIcon,
  SearchIcon,
  TriangleAlertIcon,
  UserRoundCheckIcon,
  WalletIcon,
} from 'lucide-react';
import { type RefObject, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { can, canAll, useMe } from '../../lib/auth';
import { formatCalendarDate, formatNumber, isolateLtr } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { ALL, flagParam, idParam, oneOfParam, pageParam, textParam } from '../../lib/search-params';
import { usePageInRange } from '../../lib/use-page-in-range';
import { useSearchText } from '../../lib/use-search-text';
import { clientListQuery } from '../clients/clients.queries';
import { PersonName } from '../projects/project-badges';
import { type Choice, ChoiceSelect } from '../quotes/choice-select';
import { Money } from '../quotes/quote-badges';
import { userListQuery } from '../users/users.queries';
import {
  Balance,
  BudgetUsed,
  CampaignStatusBadge,
  CostPerResult,
  DirectFundingBadge,
  EndPassedBadge,
  LowBalanceBadge,
  NoUpdateBadge,
  PlatformName,
} from './campaign-badges';
import { CampaignDialog } from './campaign-dialog';
import { campaignListQuery, walletListQuery } from './campaigns.queries';

export const CAMPAIGN_TABS = ['campaigns', 'budgets'] as const;

export type CampaignTab = (typeof CAMPAIGN_TABS)[number];

/** The status filter: running or about to run (the default), one status, or every status. */
const STATUS_FILTERS = ['open', ...AD_CAMPAIGN_STATUSES, 'all'] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number];

const FILTER_STATUSES: Record<StatusFilter, AdCampaignStatus[]> = {
  open: [...OPEN_AD_CAMPAIGN_STATUSES],
  all: [...AD_CAMPAIGN_STATUSES],
  ...(Object.fromEntries(AD_CAMPAIGN_STATUSES.map((status) => [status, [status]])) as Record<
    AdCampaignStatus,
    AdCampaignStatus[]
  >),
};

export interface CampaignsSearch {
  /** Unset means the Campaigns tab. */
  tab?: CampaignTab;
  search?: string;
  /** Unset means `open`. */
  status?: StatusFilter;
  clientId?: string;
  platform?: AdPlatform;
  funding?: AdFunding;
  ownerId?: string;
  accountManagerId?: string;
  mine?: true;
  /** Ad budgets: only balances below their threshold. */
  low?: true;
  page?: number;
}

const PAGE_SIZE = 25;

/** Reads the Campaigns page filters from the URL, dropping anything malformed. */
export function parseCampaignsSearch(search: Record<string, unknown>): CampaignsSearch {
  return {
    tab: oneOfParam(CAMPAIGN_TABS, search.tab),
    search: textParam(search.search, 100),
    status: oneOfParam(STATUS_FILTERS, search.status),
    clientId: idParam(search.clientId),
    platform: oneOfParam(AD_PLATFORMS, search.platform),
    funding: oneOfParam(AD_FUNDINGS, search.funding),
    ownerId: idParam(search.ownerId),
    accountManagerId: idParam(search.accountManagerId),
    mine: flagParam(search.mine),
    low: flagParam(search.low),
    page: pageParam(search.page),
  };
}

/** Spec screen 1: the campaigns, and the clients' ad budgets. */
export function CampaignsPage({ search }: { search: CampaignsSearch }) {
  const { t } = useTranslation();
  const me = useMe();
  const manages = can(me, 'campaigns.manage');
  const navigate = useNavigate({ from: '/campaigns/' });
  const tab = search.tab ?? 'campaigns';
  const [creating, setCreating] = useState(false);
  const newButton = useRef<HTMLButtonElement>(null);

  const setFilter = useCallback(
    (next: Partial<CampaignsSearch>) =>
      navigate({
        search: (previous) => ({ ...previous, ...next, page: undefined }),
        replace: true,
      }),
    [navigate],
  );
  const setPage = useCallback(
    (next: number | undefined, replace = false) =>
      navigate({ search: (previous) => ({ ...previous, page: next }), replace }),
    [navigate],
  );

  return (
    <>
      <PageHeader
        title={t('campaigns.title')}
        description={t('campaigns.subtitle')}
        actions={
          manages && (
            <Button ref={newButton} onClick={() => setCreating(true)}>
              <PlusIcon />
              {t('campaigns.new.action')}
            </Button>
          )
        }
      />

      <Tabs
        value={tab}
        onValueChange={(next: CampaignTab) =>
          // Each tab has its own filters.
          navigate({ search: { tab: next === 'campaigns' ? undefined : next }, replace: true })
        }
      >
        <TabsList aria-label={t('campaigns.tabs.label')}>
          <TabsTrigger value="campaigns">
            <MegaphoneIcon />
            {t('campaigns.tabs.campaigns')}
          </TabsTrigger>
          <TabsTrigger value="budgets">
            <WalletIcon />
            {t('campaigns.tabs.budgets')}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'campaigns' ? (
        <CampaignsTab search={search} onChange={setFilter} onPage={setPage} />
      ) : (
        <BudgetsTab search={search} onChange={setFilter} onPage={setPage} />
      )}

      {manages && (
        <CampaignDialog open={creating} onClose={() => setCreating(false)} finalFocus={newButton} />
      )}
    </>
  );
}

interface TabProps {
  search: CampaignsSearch;
  onChange: (next: Partial<CampaignsSearch>) => void;
  onPage: (page: number | undefined, replace?: boolean) => void;
}

function CampaignsTab({ search, onChange, onPage }: TabProps) {
  const { t } = useTranslation();
  const page = search.page ?? 1;
  const campaigns = useQuery(
    campaignListQuery({
      status: FILTER_STATUSES[search.status ?? 'open'],
      search: search.search,
      clientId: search.clientId,
      platform: search.platform,
      funding: search.funding,
      ownerId: search.ownerId,
      accountManagerId: search.accountManagerId,
      ...(search.mine && { mine: 'true' }),
      page,
      pageSize: PAGE_SIZE,
    }),
  );
  usePageInRange(
    page,
    campaigns.data?.total,
    PAGE_SIZE,
    useCallback((next: number | undefined) => onPage(next, true), [onPage]),
  );
  const filtered = Object.entries(search).some(
    ([key, value]) => key !== 'page' && key !== 'tab' && value !== undefined,
  );

  return (
    <>
      <CampaignFilters search={search} filtered={filtered} onChange={onChange} />
      {campaigns.isPending ? (
        <TableSkeleton />
      ) : campaigns.isError ? (
        <LoadError message={t('campaigns.loadError')} onRetry={() => campaigns.refetch()} />
      ) : campaigns.data.items.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={<SearchIcon />}
            title={t('campaigns.emptyFiltered')}
            description={t('campaigns.emptyFilteredHint')}
          />
        ) : (
          <EmptyState
            icon={<MegaphoneIcon />}
            title={t('campaigns.empty')}
            description={t('campaigns.emptyHint')}
          />
        )
      ) : (
        <div className="flex flex-col gap-4">
          <CampaignsTable campaigns={campaigns.data.items} />
          <Paging
            page={page}
            total={campaigns.data.total}
            shown={campaigns.data.items.length}
            onPage={onPage}
          />
        </div>
      )}
    </>
  );
}

function Paging({
  page,
  total,
  shown,
  onPage,
}: {
  page: number;
  total: number;
  shown: number;
  onPage: (page: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <Pagination
      page={page}
      pageCount={Math.ceil(total / PAGE_SIZE)}
      onPageChange={onPage}
      summary={t('common.pageSummary', {
        from: formatNumber((page - 1) * PAGE_SIZE + 1),
        to: formatNumber((page - 1) * PAGE_SIZE + shown),
        total: formatNumber(total),
      })}
      previousLabel={t('common.previous')}
      nextLabel={t('common.next')}
    />
  );
}

function SearchBox({
  value,
  onChange,
  label,
  inputRef,
}: {
  value: string | undefined;
  onChange: (next: { search: string | undefined }) => void;
  label: string;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const [text, setText] = useSearchText(value, onChange);
  return (
    <div className="relative flex-1 md:min-w-64">
      <SearchIcon
        aria-hidden="true"
        className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        ref={inputRef}
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={label}
        aria-label={label}
        className="ps-9"
      />
    </div>
  );
}

/** Account managers to filter by: only for readers of every client. */
function useAccountManagerItems(enabled: boolean): Choice[] {
  const { t } = useTranslation();
  const managers = useQuery({
    // No role filter: it is for user managers only (F01), as on the invoice list.
    ...userListQuery({ pageSize: 100 }),
    enabled,
  });
  return [
    { value: ALL, label: t('campaigns.filters.allAccountManagers') },
    ...(managers.data?.items ?? []).map((user) => ({ value: user.id, label: user.name })),
  ];
}

function CampaignFilters({
  search,
  filtered,
  onChange,
}: {
  search: CampaignsSearch;
  filtered: boolean;
  onChange: (next: Partial<CampaignsSearch>) => void;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const scopeAll = canAll(me, 'campaigns.read');
  const clients = useQuery(
    clientListQuery({
      status: ['active', 'paused', 'ended'],
      accountManagerId: scopeAll ? undefined : me.user.id,
      pageSize: 100,
    }),
  );
  const users = useQuery(userListQuery({ pageSize: 100 }));
  const managerItems = useAccountManagerItems(scopeAll);
  const searchField = useRef<HTMLInputElement>(null);

  const statusItems: Choice[] = STATUS_FILTERS.map((status) => ({
    value: status,
    label: t(`campaigns.filters.statuses.${status}`),
  }));
  const clientItems: Choice[] = [
    { value: ALL, label: t('campaigns.filters.allClients') },
    ...(clients.data?.items ?? []).map((client) => ({ value: client.id, label: client.tradeName })),
  ];
  const platformItems: Choice[] = [
    { value: ALL, label: t('campaigns.filters.allPlatforms') },
    ...AD_PLATFORMS.map((platform) => ({
      value: platform,
      label: t(`campaigns.platforms.${platform}`),
    })),
  ];
  const fundingItems: Choice[] = [
    { value: ALL, label: t('campaigns.filters.allFundings') },
    ...AD_FUNDINGS.map((funding) => ({ value: funding, label: t(`campaigns.funding.${funding}`) })),
  ];
  const ownerItems: Choice[] = [
    { value: ALL, label: t('campaigns.filters.allOwners') },
    ...(users.data?.items ?? []).map((user) => ({ value: user.id, label: user.name })),
  ];

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
        <SearchBox
          value={search.search}
          onChange={onChange}
          label={t('campaigns.search')}
          inputRef={searchField}
        />
        <ChoiceSelect
          label={t('campaigns.filters.status')}
          items={statusItems}
          value={search.status ?? 'open'}
          onChange={(value) =>
            onChange({ status: value === 'open' ? undefined : (value as StatusFilter) })
          }
          className="md:w-44"
        />
        <ChoiceSelect
          label={t('campaigns.filters.client')}
          items={clientItems}
          value={search.clientId ?? ALL}
          onChange={(value) => onChange({ clientId: value === ALL ? undefined : value })}
          className="md:w-52"
        />
      </div>
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
        <ChoiceSelect
          label={t('campaigns.filters.platform')}
          items={platformItems}
          value={search.platform ?? ALL}
          onChange={(value) =>
            onChange({ platform: value === ALL ? undefined : (value as AdPlatform) })
          }
          className="md:w-44"
        />
        <ChoiceSelect
          label={t('campaigns.filters.funding')}
          items={fundingItems}
          value={search.funding ?? ALL}
          onChange={(value) =>
            onChange({ funding: value === ALL ? undefined : (value as AdFunding) })
          }
          className="md:w-44"
        />
        <ChoiceSelect
          label={t('campaigns.filters.owner')}
          items={ownerItems}
          value={search.ownerId ?? ALL}
          onChange={(value) => onChange({ ownerId: value === ALL ? undefined : value })}
          className="md:w-48"
        />
        {scopeAll && (
          <ChoiceSelect
            label={t('campaigns.filters.accountManager')}
            items={managerItems}
            value={search.accountManagerId ?? ALL}
            onChange={(value) => onChange({ accountManagerId: value === ALL ? undefined : value })}
            className="md:w-48"
          />
        )}
        <div className="flex flex-wrap items-center gap-2 md:ms-auto">
          <Button
            variant={search.mine ? 'secondary' : 'outline'}
            size="sm"
            aria-pressed={!!search.mine}
            onClick={() => onChange({ mine: search.mine ? undefined : true })}
          >
            <UserRoundCheckIcon />
            {t('campaigns.filters.mine')}
          </Button>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                // The button leaves with the filters: the focus goes to the first filter.
                searchField.current?.focus();
                onChange({
                  search: undefined,
                  status: undefined,
                  clientId: undefined,
                  platform: undefined,
                  funding: undefined,
                  ownerId: undefined,
                  accountManagerId: undefined,
                  mine: undefined,
                });
              }}
            >
              <FilterXIcon />
              {t('campaigns.filters.clear')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The campaign table; on a client's Ads tab the client column is left out. */
export function CampaignsTable({
  campaigns,
  showClient = true,
}: {
  campaigns: Campaign[];
  showClient?: boolean;
}) {
  const { t } = useTranslation();
  const none = <span className="text-muted-foreground">{t('common.none')}</span>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            {showClient ? t('campaigns.columns.nameAndClient') : t('campaigns.columns.name')}
          </TableHead>
          <TableHead>{t('campaigns.columns.platform')}</TableHead>
          <TableHead>{t('campaigns.columns.status')}</TableHead>
          <TableHead>{t('campaigns.columns.dates')}</TableHead>
          <TableHead>{t('campaigns.columns.owner')}</TableHead>
          <TableHead>{t('campaigns.columns.spent')}</TableHead>
          <TableHead>{t('campaigns.columns.results')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {campaigns.map((campaign) => (
          <TableRow key={campaign.id}>
            <TableCell className="whitespace-normal">
              <span className="flex flex-col items-start gap-1">
                <Link
                  to="/campaigns/$campaignId"
                  params={{ campaignId: campaign.id }}
                  className="rounded-md font-medium outline-offset-4 hover:underline"
                >
                  {campaign.name}
                </Link>
                {showClient && (
                  <Link
                    to="/clients/$clientId"
                    params={{ clientId: campaign.client.id }}
                    search={{ tab: 'ads' }}
                    className="text-xs text-muted-foreground hover:underline"
                  >
                    {campaign.client.name}
                  </Link>
                )}
                {campaign.funding === 'client_direct' && <DirectFundingBadge />}
              </span>
            </TableCell>
            <TableCell>
              <span className="flex flex-col gap-0.5">
                <PlatformName platform={campaign.platform} />
                <span className="text-xs text-muted-foreground">
                  {t(`campaigns.objectives.${campaign.objective}`)}
                </span>
              </span>
            </TableCell>
            <TableCell>
              <span className="flex flex-col items-start gap-1">
                <CampaignStatusBadge status={campaign.status} />
                {campaign.daysWithoutUpdate !== null && (
                  <NoUpdateBadge days={campaign.daysWithoutUpdate} />
                )}
              </span>
            </TableCell>
            <TableCell className="min-w-36 whitespace-normal">
              <span className="flex flex-col items-start gap-1">
                <span>
                  {campaign.endsOn
                    ? t('campaigns.dateRange', {
                        from: formatCalendarDate(campaign.startsOn),
                        to: formatCalendarDate(campaign.endsOn),
                      })
                    : t('campaigns.openEnded', { from: formatCalendarDate(campaign.startsOn) })}
                </span>
                {campaign.endPassed && <EndPassedBadge />}
              </span>
            </TableCell>
            <TableCell>
              <PersonName name={campaign.owner.name} archived={campaign.owner.archived} />
            </TableCell>
            <TableCell>
              <span className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">
                  {t('campaigns.updates.ofBudget', {
                    spend: isolateLtr(formatMoney(campaign.spendMinor, 'USD')),
                    budget: isolateLtr(formatMoney(campaign.budgetMinor, 'USD')),
                  })}
                </span>
                <BudgetUsed percent={campaign.budgetUsed} />
              </span>
            </TableCell>
            <TableCell>
              {campaign.lastUpdateEnd === null ? (
                none
              ) : (
                <span className="flex flex-col">
                  <span className="tabular-nums">{formatNumber(campaign.results)}</span>
                  <span className="text-xs text-muted-foreground">
                    <CostPerResult minor={campaign.costPerResultMinor} />
                  </span>
                </span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function BudgetsTab({ search, onChange, onPage }: TabProps) {
  const { t } = useTranslation();
  const me = useMe();
  const scopeAll = canAll(me, 'campaigns.read');
  const page = search.page ?? 1;
  const wallets = useQuery(
    walletListQuery({
      search: search.search,
      accountManagerId: search.accountManagerId,
      ...(search.low && { low: 'true' }),
      page,
      pageSize: PAGE_SIZE,
    }),
  );
  usePageInRange(
    page,
    wallets.data?.total,
    PAGE_SIZE,
    useCallback((next: number | undefined) => onPage(next, true), [onPage]),
  );
  const managerItems = useAccountManagerItems(scopeAll);
  const filtered =
    search.search !== undefined || search.accountManagerId !== undefined || !!search.low;

  return (
    <>
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 md:flex-row md:flex-wrap md:items-center">
        <SearchBox
          value={search.search}
          onChange={onChange}
          label={t('campaigns.wallets.search')}
        />
        {scopeAll && (
          <ChoiceSelect
            label={t('campaigns.filters.accountManager')}
            items={managerItems}
            value={search.accountManagerId ?? ALL}
            onChange={(value) => onChange({ accountManagerId: value === ALL ? undefined : value })}
            className="md:w-52"
          />
        )}
        <Button
          variant={search.low ? 'secondary' : 'outline'}
          size="sm"
          aria-pressed={!!search.low}
          onClick={() => onChange({ low: search.low ? undefined : true })}
        >
          <TriangleAlertIcon />
          {t('campaigns.wallets.onlyLow')}
        </Button>
      </div>
      {wallets.isPending ? (
        <TableSkeleton />
      ) : wallets.isError ? (
        <LoadError message={t('campaigns.wallets.loadError')} onRetry={() => wallets.refetch()} />
      ) : wallets.data.items.length === 0 ? (
        <EmptyState
          icon={filtered ? <SearchIcon /> : <WalletIcon />}
          title={filtered ? t('campaigns.emptyFiltered') : t('campaigns.wallets.empty')}
          description={
            filtered ? t('campaigns.emptyFilteredHint') : t('campaigns.wallets.emptyHint')
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <WalletsTable wallets={wallets.data.items} />
          <Paging
            page={page}
            total={wallets.data.total}
            shown={wallets.data.items.length}
            onPage={onPage}
          />
        </div>
      )}
    </>
  );
}

function WalletsTable({ wallets }: { wallets: WalletSummary[] }) {
  const { t } = useTranslation();
  const none = <span className="text-muted-foreground">{t('common.none')}</span>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('campaigns.wallets.columns.client')}</TableHead>
          <TableHead>{t('campaigns.wallets.columns.accountManager')}</TableHead>
          <TableHead className="text-end">{t('campaigns.wallets.columns.deposited')}</TableHead>
          <TableHead className="text-end">{t('campaigns.wallets.columns.spent')}</TableHead>
          <TableHead className="text-end">{t('campaigns.wallets.columns.balance')}</TableHead>
          <TableHead className="text-end">{t('campaigns.wallets.columns.threshold')}</TableHead>
          <TableHead>{t('campaigns.wallets.columns.lastDeposit')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {wallets.map((wallet) => (
          <TableRow key={wallet.client.id}>
            <TableCell className="whitespace-normal">
              <span className="flex flex-col items-start gap-1">
                <Link
                  to="/clients/$clientId"
                  params={{ clientId: wallet.client.id }}
                  search={{ tab: 'ads' }}
                  className="rounded-md font-medium outline-offset-4 hover:underline"
                >
                  {wallet.client.name}
                </Link>
                {wallet.low && <LowBalanceBadge />}
              </span>
            </TableCell>
            <TableCell>
              <PersonName name={wallet.accountManager.name} />
            </TableCell>
            <TableCell className="text-end">
              <Money minor={wallet.depositedMinor} currency="USD" />
            </TableCell>
            <TableCell className="text-end">
              <Money minor={wallet.spentMinor} currency="USD" />
            </TableCell>
            <TableCell className="text-end font-medium">
              <Balance minor={wallet.balanceMinor} />
            </TableCell>
            <TableCell className="text-end">
              {wallet.lowBalanceThresholdMinor === null ? (
                <span className="text-muted-foreground">{t('campaigns.wallet.thresholdOff')}</span>
              ) : (
                <Money minor={wallet.lowBalanceThresholdMinor} currency="USD" />
              )}
            </TableCell>
            <TableCell>
              {wallet.lastDepositOn ? formatCalendarDate(wallet.lastDepositOn) : none}
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
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="ms-auto h-4 w-28" />
        </div>
      ))}
    </div>
  );
}
