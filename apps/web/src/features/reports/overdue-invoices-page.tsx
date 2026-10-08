import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  type AgingBucket,
  CURRENCIES,
  type Currency,
  type OverdueInvoicesReport,
} from '@vertex-hub/contracts';
import {
  Badge,
  type BadgeProps,
  EmptyState,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-hub/ui';
import { CircleCheckBigIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { formatCalendarDate, formatNumber } from '../../lib/format';
import { ALL, idParam, oneOfParam } from '../../lib/search-params';
import { useClientAccountManagers } from '../clients/clients.queries';
import { ChoiceSelect } from '../quotes/choice-select';
import { Money } from '../quotes/quote-badges';
import { BackToReports, ExportButton } from './report-parts';
import { overdueInvoicesReportQuery, reportExportUrls } from './reports.queries';

export interface OverdueInvoicesSearch {
  accountManagerId?: string;
  currency?: Currency;
}

export function parseOverdueInvoicesSearch(search: Record<string, unknown>): OverdueInvoicesSearch {
  return {
    accountManagerId: idParam(search.accountManagerId),
    currency: oneOfParam(CURRENCIES, search.currency),
  };
}

/** Screen 5: rule 16, the invoices overdue today with their aging, most days overdue first. */
export function OverdueInvoicesPage({ search }: { search: OverdueInvoicesSearch }) {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: '/reports/overdue-invoices' });
  const report = useQuery(overdueInvoicesReportQuery(search));
  const managers = useClientAccountManagers();
  const setSearch = (next: Partial<OverdueInvoicesSearch>) =>
    navigate({ search: (previous) => ({ ...previous, ...next }), replace: true });

  const managerItems = [
    { value: ALL, label: t('reports.overdue.allManagers') },
    ...managers.map((user) => ({ value: user.id, label: user.name })),
  ];
  const currencyItems = [
    { value: ALL, label: t('reports.overdue.allCurrencies') },
    ...CURRENCIES.map((code) => ({ value: code, label: t(`invoices.currencies.${code}`) })),
  ];

  return (
    <>
      <BackToReports />
      <PageHeader
        title={t('reports.overdue.title')}
        description={
          report.data
            ? t('reports.overdue.subtitle', { date: formatCalendarDate(report.data.today) })
            : undefined
        }
        actions={<ExportButton href={reportExportUrls.overdueInvoices(search)} />}
      />
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 md:flex-row">
        <ChoiceSelect
          label={t('reports.overdue.accountManager')}
          items={managerItems}
          value={search.accountManagerId ?? ALL}
          onChange={(value) => setSearch({ accountManagerId: value === ALL ? undefined : value })}
          className="md:w-60"
        />
        <ChoiceSelect
          label={t('reports.overdue.currency')}
          items={currencyItems}
          value={search.currency ?? ALL}
          onChange={(value) =>
            setSearch({ currency: value === ALL ? undefined : (value as Currency) })
          }
          className="md:w-40"
        />
      </div>
      {report.isPending ? (
        <Skeleton className="h-96" />
      ) : report.isError ? (
        <LoadError message={t('reports.overdue.loadError')} onRetry={() => report.refetch()} />
      ) : report.data.invoices.length === 0 ? (
        <EmptyState
          icon={<CircleCheckBigIcon />}
          title={t('reports.overdue.empty')}
          description={t('reports.overdue.emptyHint')}
        />
      ) : (
        <>
          <Totals report={report.data} />
          <OverdueTable report={report.data} />
        </>
      )}
    </>
  );
}

function Totals({ report }: { report: OverdueInvoicesReport }) {
  const { t } = useTranslation();
  const { totals } = report;
  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4">
        <dt className="text-sm text-muted-foreground">{t('reports.overdue.count')}</dt>
        <dd className="text-2xl font-bold tabular-nums">{formatNumber(totals.count)}</dd>
      </div>
      <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4">
        <dt className="text-sm text-muted-foreground">{t('reports.overdue.totalUsd')}</dt>
        <dd className="text-2xl font-bold text-destructive-text">
          <Money minor={totals.usdMinor} currency="USD" />
        </dd>
      </div>
      <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4">
        <dt className="text-sm text-muted-foreground">{t('reports.overdue.byCurrency')}</dt>
        <dd className="flex flex-col gap-0.5 font-medium">
          {totals.byCurrency.map((row) => (
            <Money key={row.currency} minor={row.amountMinor} currency={row.currency} />
          ))}
        </dd>
      </div>
    </dl>
  );
}

const BUCKET_TONES: Record<AgingBucket, NonNullable<BadgeProps['tone']>> = {
  '1_30': 'gold',
  '31_60': 'warning',
  '61_90': 'danger',
  over_90: 'danger',
};

export function AgingBadge({ bucket }: { bucket: AgingBucket }) {
  const { t } = useTranslation();
  return <Badge tone={BUCKET_TONES[bucket]}>{t(`reports.overdue.buckets.${bucket}`)}</Badge>;
}

function OverdueTable({ report }: { report: OverdueInvoicesReport }) {
  const { t } = useTranslation();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('reports.overdue.number')}</TableHead>
          <TableHead>{t('reports.overdue.client')}</TableHead>
          <TableHead className="text-end">{t('reports.overdue.paid')}</TableHead>
          <TableHead className="text-end">{t('reports.overdue.balance')}</TableHead>
          <TableHead>{t('reports.overdue.dueOn')}</TableHead>
          <TableHead>{t('reports.overdue.aging')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {report.invoices.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <Link
                to="/invoices/$invoiceId"
                params={{ invoiceId: row.id }}
                className="font-medium hover:underline"
              >
                <span dir="ltr" className="tabular-nums">
                  {row.number}
                </span>
              </Link>
            </TableCell>
            <TableCell>
              <span className="flex flex-col">
                {row.client.name}
                {row.accountManager && (
                  <span className="text-xs text-muted-foreground">{row.accountManager.name}</span>
                )}
              </span>
            </TableCell>
            <TableCell className="text-end">
              <span className="flex flex-col items-end">
                <Money minor={row.paidMinor} currency={row.currency} />
                <span className="text-xs text-muted-foreground">
                  {t('reports.overdue.ofTotal')}{' '}
                  <Money minor={row.totalMinor} currency={row.currency} />
                </span>
              </span>
            </TableCell>
            {/* The USD balance only beside a SYP one: for USD it is the same amount. */}
            <TableCell className="text-end">
              <span className="flex flex-col items-end">
                <Money
                  minor={row.balanceMinor}
                  currency={row.currency}
                  className="font-medium"
                />
                {row.currency !== 'USD' && (
                  <Money
                    minor={row.balanceUsdMinor}
                    currency="USD"
                    className="text-xs text-muted-foreground"
                  />
                )}
              </span>
            </TableCell>
            <TableCell>
              <span className="flex flex-col">
                {formatCalendarDate(row.dueOn)}
                <span className="text-xs text-destructive-text">
                  {t('invoices.daysOverdue', {
                    count: row.daysOverdue,
                    n: formatNumber(row.daysOverdue),
                  })}
                </span>
              </span>
            </TableCell>
            <TableCell>
              <AgingBadge bucket={row.bucket} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
