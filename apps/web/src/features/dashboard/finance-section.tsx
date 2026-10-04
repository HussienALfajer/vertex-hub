import { useQuery } from '@tanstack/react-query';
import type { FinanceDashboard } from '@vertex-hub/contracts';
import { LandmarkIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../lib/format';
import { Money } from '../quotes/quote-badges';
import { financeDashboardQuery } from '../reports/reports.queries';
import { DashboardSection, LastMonth, StatCard } from './dashboard-parts';

/** Rule 2: money in and owed, in USD at the stored rates (General Manager, Operations, Finance). */
export function FinanceSection() {
  const { t } = useTranslation();
  const finance = useQuery(financeDashboardQuery);
  return (
    <DashboardSection
      id="finance"
      title={t('dashboard.finance.title')}
      icon={LandmarkIcon}
      query={finance}
      loadError={t('dashboard.finance.loadError')}
    >
      {(data) => (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={t('dashboard.finance.invoiced')}
            value={<Usd minor={data.invoicedUsdMinor.thisMonth} />}
            detail={
              <LastMonth>
                <Usd minor={data.invoicedUsdMinor.lastMonth} />
              </LastMonth>
            }
            link={{
              to: '/invoices',
              search: { tab: 'all' },
              label: t('dashboard.finance.openInvoices'),
            }}
          />
          <StatCard
            label={t('dashboard.finance.collected')}
            value={<Usd minor={data.collectedUsdMinor.thisMonth} />}
            detail={
              <LastMonth>
                <Usd minor={data.collectedUsdMinor.lastMonth} />
              </LastMonth>
            }
            link={{ to: '/reports/revenue', label: t('dashboard.finance.openRevenue') }}
          />
          <StatCard
            label={t('dashboard.finance.outstanding')}
            value={<Usd minor={data.outstanding.usdMinor} />}
            detail={<ByCurrency rows={data.outstanding.byCurrency} />}
            link={{
              to: '/invoices',
              search: { tab: 'open' },
              label: t('dashboard.finance.openOpen'),
            }}
          />
          <StatCard
            label={t('dashboard.finance.overdue', {
              count: data.overdue.count,
              n: formatNumber(data.overdue.count),
            })}
            value={<Usd minor={data.overdue.usdMinor} />}
            alert={data.overdue.count > 0}
            detail={<ByCurrency rows={data.overdue.byCurrency} />}
            link={{ to: '/reports/overdue-invoices', label: t('dashboard.finance.openOverdue') }}
          />
        </div>
      )}
    </DashboardSection>
  );
}

function Usd({ minor }: { minor: number }) {
  return <Money minor={minor} currency="USD" />;
}

/** The amounts in their own currencies, when any is not USD. */
function ByCurrency({ rows }: { rows: FinanceDashboard['outstanding']['byCurrency'] }) {
  if (rows.length === 0 || rows.every((row) => row.currency === 'USD')) return null;
  return (
    <span className="flex flex-wrap gap-x-3">
      {rows.map((row) => (
        <Money key={row.currency} minor={row.amountMinor} currency={row.currency} />
      ))}
    </span>
  );
}
