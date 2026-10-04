import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type { RevenueReport } from '@vertex-hub/contracts';
import {
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
import { ChartNoAxesColumnIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { formatCalendarDate } from '../../lib/format';
import { oneOfParam } from '../../lib/search-params';
import { Money } from '../quotes/quote-badges';
import {
  BackToReports,
  ExportButton,
  PeriodPicker,
  type PeriodSearch,
  parsePeriodSearch,
  usePeriod,
} from './report-parts';
import { reportExportUrls, revenueReportQuery } from './reports.queries';

const REVENUE_VIEWS = ['client', 'service'] as const;

type RevenueView = (typeof REVENUE_VIEWS)[number];

export interface RevenueSearch extends PeriodSearch {
  /** Unset means by client. */
  view?: RevenueView;
}

export function parseRevenueSearch(search: Record<string, unknown>): RevenueSearch {
  return { ...parsePeriodSearch(search), view: oneOfParam(REVENUE_VIEWS, search.view) };
}

/** Screen 4: rules 11–15, by client and by service, in USD at the stored rates. */
export function RevenuePage({ search }: { search: RevenueSearch }) {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: '/reports/revenue' });
  const { period, query, valid } = usePeriod(search);
  const report = useQuery({ ...revenueReportQuery(query), enabled: valid });
  const setSearch = (next: Partial<RevenueSearch>) =>
    navigate({ search: (previous) => ({ ...previous, ...next }), replace: true });

  return (
    <>
      <BackToReports />
      <PageHeader
        title={t('reports.revenue.title')}
        description={t('reports.revenue.subtitle', {
          from: formatCalendarDate(period.from),
          to: formatCalendarDate(period.to),
        })}
        actions={<ExportButton href={reportExportUrls.revenue(query)} disabled={!valid} />}
      />
      <div className="rounded-lg border border-border bg-surface p-3">
        <PeriodPicker
          search={search}
          onChange={(next) => setSearch({ from: next.from, to: next.to })}
        />
      </div>
      {!valid ? null : report.isPending ? (
        <Skeleton className="h-96" />
      ) : report.isError ? (
        <LoadError message={t('reports.revenue.loadError')} onRetry={() => report.refetch()} />
      ) : (
        <>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Total label={t('reports.revenue.invoiced')} minor={report.data.invoicedUsdMinor} />
            <Total label={t('reports.revenue.collected')} minor={report.data.collectedUsdMinor} />
          </dl>
          <Tabs
            value={search.view ?? 'client'}
            onValueChange={(view) =>
              setSearch({ view: view === 'client' ? undefined : (view as RevenueView) })
            }
          >
            <TabsList>
              <TabsTrigger value="client">{t('reports.revenue.byClient')}</TabsTrigger>
              <TabsTrigger value="service">{t('reports.revenue.byService')}</TabsTrigger>
            </TabsList>
            <TabsContent value="client">
              <ByClient report={report.data} />
            </TabsContent>
            <TabsContent value="service">
              <ByService report={report.data} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </>
  );
}

function Total({ label, minor }: { label: string; minor: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-bold">
        <Money minor={minor} currency="USD" />
      </dd>
    </div>
  );
}

function Empty() {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={<ChartNoAxesColumnIcon />}
      title={t('reports.revenue.empty')}
      description={t('reports.revenue.emptyHint')}
    />
  );
}

function ByClient({ report }: { report: RevenueReport }) {
  const { t } = useTranslation();
  if (report.byClient.length === 0) return <Empty />;
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('reports.revenue.client')}</TableHead>
            <TableHead>{t('reports.revenue.accountManager')}</TableHead>
            <TableHead className="text-end">{t('reports.revenue.invoiced')}</TableHead>
            <TableHead className="text-end">{t('reports.revenue.collected')}</TableHead>
            <TableHead className="text-end">{t('reports.revenue.outstanding')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.byClient.map((row) => (
            <TableRow key={row.client.id}>
              <TableCell>
                <Link
                  to="/clients/$clientId"
                  params={{ clientId: row.client.id }}
                  search={{ tab: 'invoices' }}
                  className="font-medium hover:underline"
                >
                  {row.client.name}
                </Link>
              </TableCell>
              <TableCell>
                {row.accountManager?.name ?? (
                  <span className="text-muted-foreground">{t('common.none')}</span>
                )}
              </TableCell>
              <UsdCell minor={row.invoicedUsdMinor} />
              <UsdCell minor={row.collectedUsdMinor} />
              <UsdCell minor={row.outstandingUsdMinor} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Rule 14: "Unclassified" comes last, as the API sends it. */
function ByService({ report }: { report: RevenueReport }) {
  const { t } = useTranslation();
  if (report.byService.length === 0) return <Empty />;
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('reports.revenue.service')}</TableHead>
            <TableHead className="text-end">{t('reports.revenue.invoiced')}</TableHead>
            <TableHead className="text-end">{t('reports.revenue.collected')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.byService.map((row) => (
            <TableRow key={row.id ?? 'unclassified'}>
              <TableCell>
                {row.kind === 'unclassified' ? (
                  <span className="text-muted-foreground">{t('reports.revenue.unclassified')}</span>
                ) : (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{row.name}</span>
                    {row.kind === 'package' && (
                      <Badge tone="info">{t('reports.revenue.package')}</Badge>
                    )}
                    {row.archived && <Badge tone="neutral">{t('reports.revenue.archived')}</Badge>}
                  </span>
                )}
              </TableCell>
              <UsdCell minor={row.invoicedUsdMinor} />
              <UsdCell minor={row.collectedUsdMinor} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function UsdCell({ minor }: { minor: number }) {
  return (
    <TableCell className="text-end">
      <Money minor={minor} currency="USD" />
    </TableCell>
  );
}
