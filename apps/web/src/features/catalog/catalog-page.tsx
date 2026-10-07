import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  CATALOG_BILLINGS,
  type CatalogBilling,
  type CatalogPackage,
  type CatalogService,
  type Currency,
  DEPARTMENT_CODES,
  type DepartmentCode,
} from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
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
  Tabs,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from '@vertex-hub/ui';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  BoxesIcon,
  EllipsisIcon,
  PackageIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { LoadError } from '../../components/load-error';
import { ApiError } from '../../lib/api/client';
import { can, useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { formatList, formatNumber } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { ALL, flagParam, oneOfParam, pageParam, textParam } from '../../lib/search-params';
import { usePageInRange } from '../../lib/use-page-in-range';
import { type ReturnFocus, useReturnFocus } from '../../lib/use-return-focus';
import { useSearchText } from '../../lib/use-search-text';
import { useDepartmentNames } from '../projects/project-badges';
import {
  packageListQuery,
  serviceListQuery,
  useSetPackageArchived,
  useSetServiceArchived,
} from './catalog.queries';
import type { Editing } from './catalog-dialog';
import { PackageDialog } from './package-dialog';
import { ServiceDialog } from './service-dialog';

const CATALOG_TABS = ['services', 'packages'] as const;

type CatalogTab = (typeof CATALOG_TABS)[number];

export interface CatalogSearch {
  tab?: CatalogTab;
  search?: string;
  billing?: CatalogBilling;
  department?: DepartmentCode;
  archived?: boolean;
  page?: number;
}

const PAGE_SIZE = 25;

/** Reads the tab and filters from the URL, dropping anything malformed. */
export function parseCatalogSearch(search: Record<string, unknown>): CatalogSearch {
  return {
    tab: CATALOG_TABS.find((tab) => tab !== 'services' && tab === search.tab),
    search: textParam(search.search, 100),
    billing: oneOfParam(CATALOG_BILLINGS, search.billing),
    department: oneOfParam(DEPARTMENT_CODES, search.department),
    archived: flagParam(search.archived),
    page: pageParam(search.page),
  };
}

/** Spec screen 1: the catalog's services and packages; managers add, edit and archive. */
export function CatalogPage({ search }: { search: CatalogSearch }) {
  const { t } = useTranslation();
  const me = useMe();
  const manager = can(me, 'catalog.manage');
  const navigate = useNavigate({ from: '/catalog/' });
  const tab = search.tab ?? 'services';
  const [editingService, setEditingService] = useState<Editing<CatalogService>>(null);
  const [editingPackage, setEditingPackage] = useState<Editing<CatalogPackage>>(null);
  const activeTab = useRef<HTMLButtonElement>(null);
  const returnFocus = useReturnFocus(activeTab);
  const openService = (service: CatalogService | 'new', opener: HTMLElement | null) => {
    returnFocus.from(opener);
    setEditingService(service);
  };
  const openPackage = (pkg: CatalogPackage | 'new', opener: HTMLElement | null) => {
    returnFocus.from(opener);
    setEditingPackage(pkg);
  };

  const setFilter = useCallback(
    (next: Partial<CatalogSearch>) =>
      navigate({
        search: (previous) => ({ ...previous, ...next, page: undefined }),
        replace: true,
      }),
    [navigate],
  );

  return (
    <>
      <PageHeader
        title={t('catalog.title')}
        description={t('catalog.subtitle')}
        actions={
          <>
            {can(me, 'quotes.read') && (
              <Button variant="outline" render={<Link to="/catalog/settings" />}>
                <SettingsIcon />
                {t('quotes.settings.link')}
              </Button>
            )}
            {manager &&
              (tab === 'services' ? (
                <Button onClick={(event) => openService('new', event.currentTarget)}>
                  <PlusIcon />
                  {t('catalog.services.new')}
                </Button>
              ) : (
                <Button onClick={(event) => openPackage('new', event.currentTarget)}>
                  <PlusIcon />
                  {t('catalog.packages.new')}
                </Button>
              ))}
          </>
        }
      />

      <Tabs
        value={tab}
        onValueChange={(next: CatalogTab) =>
          navigate({ search: { tab: next === 'services' ? undefined : next } })
        }
      >
        <TabsList aria-label={t('catalog.title')}>
          <TabsTrigger value="services" ref={tab === 'services' ? activeTab : undefined}>
            <BoxesIcon />
            {t('catalog.tabs.services')}
          </TabsTrigger>
          <TabsTrigger value="packages" ref={tab === 'packages' ? activeTab : undefined}>
            <PackageIcon />
            {t('catalog.tabs.packages')}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <Filters tab={tab} search={search} manager={manager} onChange={setFilter} />

      {tab === 'services' ? (
        <ServicesTab
          search={search}
          manager={manager}
          onOpen={openService}
          returnFocus={returnFocus}
        />
      ) : (
        <PackagesTab
          search={search}
          manager={manager}
          onOpen={openPackage}
          returnFocus={returnFocus}
        />
      )}

      {manager && (
        <>
          <ServiceDialog
            editing={editingService}
            onClose={() => setEditingService(null)}
            finalFocus={returnFocus.target}
          />
          <PackageDialog
            editing={editingPackage}
            onClose={() => setEditingPackage(null)}
            finalFocus={returnFocus.target}
          />
        </>
      )}
    </>
  );
}

function Filters({
  tab,
  search,
  manager,
  onChange,
}: {
  tab: CatalogTab;
  search: CatalogSearch;
  manager: boolean;
  onChange: (next: Partial<CatalogSearch>) => void;
}) {
  const { t } = useTranslation();
  const nameOf = useDepartmentNames();
  const [text, setText] = useSearchText(search.search, onChange);

  const billingItems = [
    { value: ALL, label: t('catalog.allBillings') },
    ...CATALOG_BILLINGS.map((billing) => ({
      value: billing,
      label: t(`catalog.billings.${billing}`),
    })),
  ];
  const departmentItems = [
    { value: ALL, label: t('catalog.allDepartments') },
    ...DEPARTMENT_CODES.map((code) => ({ value: code, label: nameOf(code) })),
  ];
  const stateItems = [
    { value: 'active', label: t('catalog.activeOnly') },
    { value: 'archived', label: t('catalog.archivedOnly') },
  ];

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 md:flex-row md:flex-wrap md:items-center">
      {/* Keeps room to type; the selects wrap under it when the row is narrow. */}
      <div className="relative flex-1 md:min-w-64">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('catalog.search')}
          aria-label={t('catalog.search')}
          className="ps-9"
        />
      </div>
      <FilterSelect
        label={t('catalog.billing')}
        items={billingItems}
        value={search.billing ?? ALL}
        onChange={(value) =>
          onChange({ billing: value === ALL ? undefined : (value as CatalogBilling) })
        }
      />
      {tab === 'services' && (
        <FilterSelect
          label={t('catalog.department')}
          items={departmentItems}
          value={search.department ?? ALL}
          onChange={(value) =>
            onChange({ department: value === ALL ? undefined : (value as DepartmentCode) })
          }
        />
      )}
      {manager && (
        <FilterSelect
          label={t('catalog.state')}
          items={stateItems}
          value={search.archived ? 'archived' : 'active'}
          onChange={(value) => onChange({ archived: value === 'archived' ? true : undefined })}
        />
      )}
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
      <SelectTrigger aria-label={label} className="md:w-44">
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

/** Paging shared by both tabs: keeps the page in range and moves through the URL. */
function usePaging(search: CatalogSearch, total: number | undefined) {
  const navigate = useNavigate({ from: '/catalog/' });
  const page = search.page ?? 1;
  const goTo = useCallback(
    (next: number | undefined) =>
      navigate({ search: (previous) => ({ ...previous, page: next }), replace: true }),
    [navigate],
  );
  usePageInRange(page, total, PAGE_SIZE, goTo);
  return { page, goTo };
}

function ListPagination({
  page,
  total,
  shown,
  onPageChange,
}: {
  page: number;
  total: number;
  shown: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <Pagination
      page={page}
      pageCount={Math.ceil(total / PAGE_SIZE)}
      onPageChange={onPageChange}
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

function ServicesTab({
  search,
  manager,
  onOpen,
  returnFocus,
}: {
  search: CatalogSearch;
  manager: boolean;
  onOpen: (service: CatalogService | 'new', opener: HTMLElement | null) => void;
  returnFocus: ReturnFocus;
}) {
  const { t } = useTranslation();
  const archived = manager && !!search.archived;
  const page = search.page ?? 1;
  const services = useQuery(
    serviceListQuery({
      search: search.search,
      billing: search.billing,
      department: search.department,
      archived: archived ? 'true' : undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
  );
  const paging = usePaging(search, services.data?.total);
  const filtered = !!(search.search || search.billing || search.department || archived);

  if (services.isPending) return <TableSkeleton />;
  if (services.isError) {
    return <LoadError message={t('catalog.loadError')} onRetry={() => services.refetch()} />;
  }
  if (services.data.items.length === 0) {
    return (
      <EmptyState
        icon={<BoxesIcon />}
        title={filtered ? t('catalog.noMatchesTitle') : t('catalog.services.emptyTitle')}
        description={
          filtered
            ? t('catalog.noMatchesHint')
            : manager
              ? t('catalog.services.emptyHint')
              : undefined
        }
        action={
          !filtered &&
          manager && (
            <Button onClick={(event) => onOpen('new', event.currentTarget)}>
              <PlusIcon />
              {t('catalog.services.new')}
            </Button>
          )
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <ServicesTable
        services={services.data.items}
        manager={manager}
        onEdit={onOpen}
        returnFocus={returnFocus}
      />
      <ListPagination
        page={paging.page}
        total={services.data.total}
        shown={services.data.items.length}
        onPageChange={paging.goTo}
      />
    </div>
  );
}

/** A price in its currency, or a dash when the catalog has none in that currency. */
function Price({ minor, currency }: { minor: number | null; currency: Currency }) {
  const { t } = useTranslation();
  if (minor === null) return <span className="text-muted-foreground">{t('common.none')}</span>;
  return (
    <span dir="ltr" className="tabular-nums">
      {formatMoney(minor, currency)}
    </span>
  );
}

function ServicesTable({
  services,
  manager,
  onEdit,
  returnFocus,
}: {
  services: CatalogService[];
  manager: boolean;
  onEdit: (service: CatalogService, opener: HTMLElement | null) => void;
  returnFocus: ReturnFocus;
}) {
  const { t } = useTranslation();
  const nameOf = useDepartmentNames();
  const [archiving, setArchiving] = useState<CatalogService | null>(null);
  const setArchived = useSetServiceArchived();

  async function restore(service: CatalogService, opener: HTMLElement | null) {
    try {
      await setArchived.mutateAsync({ id: service.id, archive: false });
      toast.add({ title: t('catalog.services.restored'), type: 'success' });
      // The restored row leaves the list of archived ones.
      returnFocus.toFallback();
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
      opener?.focus();
    }
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-48">{t('catalog.columns.name')}</TableHead>
            <TableHead>{t('catalog.department')}</TableHead>
            <TableHead>{t('catalog.billing')}</TableHead>
            <TableHead className="text-end">{t('catalog.columns.priceUsd')}</TableHead>
            <TableHead className="text-end">{t('catalog.columns.priceSyp')}</TableHead>
            <TableHead className="text-end">{t('catalog.columns.revisionRounds')}</TableHead>
            <TableHead>{t('catalog.columns.counted')}</TableHead>
            <TableHead>{t('catalog.columns.template')}</TableHead>
            {manager && (
              <TableHead>
                <span className="sr-only">{t('catalog.columns.actions')}</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {services.map((service) => (
            <TableRow key={service.id}>
              <TableCell className="whitespace-normal">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2 font-medium wrap-anywhere">
                    {service.name}
                    {service.archivedAt && (
                      <Badge tone="outline">{t('catalog.archivedBadge')}</Badge>
                    )}
                  </span>
                  {service.description && (
                    <span className="line-clamp-1 max-w-md text-sm text-muted-foreground">
                      {service.description}
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell>{nameOf(service.department)}</TableCell>
              <TableCell>
                <BillingBadge billing={service.billing} />
              </TableCell>
              <TableCell className="text-end">
                <Price minor={service.priceUsdMinor} currency="USD" />
              </TableCell>
              <TableCell className="text-end">
                <Price minor={service.priceSypMinor} currency="SYP" />
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {formatNumber(service.revisionRounds)}
              </TableCell>
              <TableCell>
                {service.deliverableKind ? (
                  <Badge tone="info">
                    {service.deliverableLabel ?? t(`retainers.kinds.${service.deliverableKind}`)}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">{t('catalog.notCounted')}</span>
                )}
              </TableCell>
              <TableCell className="whitespace-normal">
                <TemplateName template={service.template} />
              </TableCell>
              {manager && (
                <TableCell>
                  <RowActions
                    name={service.name}
                    archived={!!service.archivedAt}
                    onEdit={(opener) => onEdit(service, opener)}
                    onArchive={(opener) => {
                      returnFocus.from(opener);
                      setArchiving(service);
                    }}
                    onRestore={(opener) => restore(service, opener)}
                  />
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ConfirmDialog
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        title={t('catalog.services.archiveTitle', { name: archiving?.name ?? '' })}
        body={t('catalog.services.archiveBody')}
        action={t('catalog.archive')}
        destructive
        pending={setArchived.isPending}
        finalFocus={returnFocus.target}
        describeFailure={(error) => {
          // C1: name the active packages that hold the service.
          if (!(error instanceof ApiError) || error.knownCode !== 'SERVICE_IN_PACKAGE') return;
          const packages = (error.details as { packages?: { name: string }[] } | undefined)
            ?.packages;
          if (!packages?.length) return;
          return t('catalog.services.inPackages', {
            names: formatList(packages.map((pkg) => pkg.name)),
          });
        }}
        onConfirm={async () => {
          if (!archiving) return;
          await setArchived.mutateAsync({ id: archiving.id, archive: true });
          toast.add({ title: t('catalog.services.archived'), type: 'success' });
        }}
      />
    </>
  );
}

export function BillingBadge({ billing }: { billing: CatalogBilling }) {
  const { t } = useTranslation();
  return (
    <Badge tone={billing === 'monthly' ? 'brand' : 'neutral'}>
      {t(`catalog.billings.${billing}`)}
    </Badge>
  );
}

/** A linked template, flagged when it was archived after linking (C3). */
function TemplateName({ template }: { template: CatalogService['template'] }) {
  const { t } = useTranslation();
  if (!template) return <span className="text-muted-foreground">{t('common.none')}</span>;
  return (
    <span className="flex flex-wrap items-center gap-2">
      {template.name}
      {template.archived && (
        <Badge tone="warning">
          <TriangleAlertIcon aria-hidden="true" />
          {t('catalog.templateArchived')}
        </Badge>
      )}
    </span>
  );
}

/**
 * A row's menu. A chosen action owns the focus from then on (its dialog gives it back, or the
 * action moves it once the row is gone), so the menu does not return it to its button; each action
 * gets that button to come back to.
 */
function RowActions({
  name,
  archived,
  onEdit,
  onArchive,
  onRestore,
}: {
  name: string;
  archived: boolean;
  onEdit: (opener: HTMLElement | null) => void;
  onArchive: (opener: HTMLElement | null) => void;
  onRestore: (opener: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
  const menuButton = useRef<HTMLButtonElement>(null);
  const chosen = useRef(false);
  const choose = (action: (opener: HTMLElement | null) => void) => () => {
    chosen.current = true;
    action(menuButton.current);
  };
  const label = t('catalog.actions', { name });
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) chosen.current = false;
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={<Button ref={menuButton} variant="ghost" size="icon-sm" aria-label={label} />}
            />
          }
        >
          <EllipsisIcon />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" finalFocus={() => !chosen.current}>
        {archived ? (
          <DropdownMenuItem onClick={choose(onRestore)}>
            <ArchiveRestoreIcon />
            {t('catalog.restore')}
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onClick={choose(onEdit)}>
              <PencilIcon />
              {t('catalog.edit')}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={choose(onArchive)}>
              <ArchiveIcon />
              {t('catalog.archive')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PackagesTab({
  search,
  manager,
  onOpen,
  returnFocus,
}: {
  search: CatalogSearch;
  manager: boolean;
  onOpen: (pkg: CatalogPackage | 'new', opener: HTMLElement | null) => void;
  returnFocus: ReturnFocus;
}) {
  const { t } = useTranslation();
  const archived = manager && !!search.archived;
  const page = search.page ?? 1;
  const packages = useQuery(
    packageListQuery({
      search: search.search,
      billing: search.billing,
      archived: archived ? 'true' : undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
  );
  const paging = usePaging(search, packages.data?.total);
  const [archiving, setArchiving] = useState<CatalogPackage | null>(null);
  const setArchived = useSetPackageArchived();
  const filtered = !!(search.search || search.billing || archived);

  async function restore(pkg: CatalogPackage, opener: HTMLElement | null) {
    try {
      await setArchived.mutateAsync({ id: pkg.id, archive: false });
      toast.add({ title: t('catalog.packages.restored'), type: 'success' });
      // The restored row leaves the list of archived ones.
      returnFocus.toFallback();
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
      opener?.focus();
    }
  }

  if (packages.isPending) return <CardsSkeleton />;
  if (packages.isError) {
    return <LoadError message={t('catalog.loadError')} onRetry={() => packages.refetch()} />;
  }
  if (packages.data.items.length === 0) {
    return (
      <EmptyState
        icon={<PackageIcon />}
        title={filtered ? t('catalog.noMatchesTitle') : t('catalog.packages.emptyTitle')}
        description={
          filtered
            ? t('catalog.noMatchesHint')
            : manager
              ? t('catalog.packages.emptyHint')
              : undefined
        }
        action={
          !filtered &&
          manager && (
            <Button onClick={(event) => onOpen('new', event.currentTarget)}>
              <PlusIcon />
              {t('catalog.packages.new')}
            </Button>
          )
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {packages.data.items.map((pkg) => (
          <li key={pkg.id}>
            <PackageCard
              pkg={pkg}
              manager={manager}
              onEdit={(opener) => onOpen(pkg, opener)}
              onArchive={(opener) => {
                returnFocus.from(opener);
                setArchiving(pkg);
              }}
              onRestore={(opener) => restore(pkg, opener)}
            />
          </li>
        ))}
      </ul>
      <ListPagination
        page={paging.page}
        total={packages.data.total}
        shown={packages.data.items.length}
        onPageChange={paging.goTo}
      />
      <ConfirmDialog
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        title={t('catalog.packages.archiveTitle', { name: archiving?.name ?? '' })}
        body={t('catalog.packages.archiveBody')}
        action={t('catalog.archive')}
        destructive
        pending={setArchived.isPending}
        finalFocus={returnFocus.target}
        onConfirm={async () => {
          if (!archiving) return;
          await setArchived.mutateAsync({ id: archiving.id, archive: true });
          toast.add({ title: t('catalog.packages.archived'), type: 'success' });
        }}
      />
    </div>
  );
}

function PackageCard({
  pkg,
  manager,
  onEdit,
  onArchive,
  onRestore,
}: {
  pkg: CatalogPackage;
  manager: boolean;
  onEdit: (opener: HTMLElement | null) => void;
  onArchive: (opener: HTMLElement | null) => void;
  onRestore: (opener: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
  const items = pkg.items.map((item) =>
    t('catalog.packages.item', { n: formatNumber(item.quantity), name: item.name }),
  );
  return (
    <Card className="h-full gap-4 p-5">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="text-lg font-bold wrap-anywhere">{pkg.name}</h3>
          <span className="flex flex-wrap items-center gap-2">
            <BillingBadge billing={pkg.billing} />
            {pkg.archivedAt && <Badge tone="outline">{t('catalog.archivedBadge')}</Badge>}
          </span>
        </div>
        {manager && (
          <RowActions
            name={pkg.name}
            archived={!!pkg.archivedAt}
            onEdit={onEdit}
            onArchive={onArchive}
            onRestore={onRestore}
          />
        )}
      </div>
      {pkg.description && (
        <p className="text-sm whitespace-pre-line text-muted-foreground wrap-anywhere">
          {pkg.description}
        </p>
      )}
      <dl className="flex flex-col gap-1">
        <dt className="sr-only">{t('catalog.packages.price')}</dt>
        <dd className="text-xl font-bold">
          <Price minor={pkg.priceUsdMinor} currency="USD" />
          {pkg.billing === 'monthly' && (
            <span className="ms-1 text-sm font-normal text-muted-foreground">
              {t('catalog.perMonth')}
            </span>
          )}
        </dd>
        {pkg.priceSypMinor !== null && (
          <dd className="text-sm text-muted-foreground">
            <Price minor={pkg.priceSypMinor} currency="SYP" />
          </dd>
        )}
      </dl>
      <p className="text-sm">{items.join(' · ')}</p>
      {pkg.items.some((item) => item.archived) && (
        <Badge tone="warning" className="w-fit whitespace-normal">
          <TriangleAlertIcon aria-hidden="true" />
          {t('catalog.packages.archivedServices', {
            names: formatList(pkg.items.filter((item) => item.archived).map((item) => item.name)),
          })}
        </Badge>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
        <span className="text-muted-foreground">{t('catalog.columns.template')}</span>
        <TemplateName template={pkg.template} />
      </div>
    </Card>
  );
}

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      {['a', 'b', 'c', 'd'].map((row) => (
        <div key={row} className="flex items-center gap-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="ms-auto h-4 w-32" />
        </div>
      ))}
    </div>
  );
}

function CardsSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {['a', 'b', 'c'].map((card) => (
        <Skeleton key={card} className="h-48 w-full rounded-lg" />
      ))}
    </div>
  );
}
