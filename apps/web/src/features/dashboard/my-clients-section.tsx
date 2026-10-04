import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { MyClientsDashboard } from '@vertex-hub/contracts';
import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-hub/ui';
import { BriefcaseBusinessIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDate, formatNumber } from '../../lib/format';
import { LowBalanceBadge } from '../campaigns/campaign-badges';
import { Money } from '../quotes/quote-badges';
import { myClientsDashboardQuery } from '../reports/reports.queries';
import { BehindBadge, DeliveryRate } from '../retainers/retainer-badges';
import { DashboardSection } from './dashboard-parts';

type ClientRow = MyClientsDashboard['clients'][number];

/**
 * Rule 4: the clients the user is primary account manager of, those with a problem first. Money
 * and wallet columns show only when the API sends them (`invoices.read`, `campaigns.read`).
 */
export function MyClientsSection() {
  const { t } = useTranslation();
  const clients = useQuery(myClientsDashboardQuery);
  return (
    <DashboardSection
      id="clients"
      title={t('dashboard.clients.title')}
      icon={BriefcaseBusinessIcon}
      query={clients}
      loadError={t('dashboard.clients.loadError')}
      isEmpty={(data) => data.clients.length === 0}
      empty={{
        icon: <BriefcaseBusinessIcon />,
        title: t('dashboard.clients.emptyTitle'),
        description: t('dashboard.clients.emptyHint'),
      }}
    >
      {(data) => <ClientsTable rows={data.clients} />}
    </DashboardSection>
  );
}

function ClientsTable({ rows }: { rows: ClientRow[] }) {
  const { t } = useTranslation();
  const money = rows.some((row) => row.invoices !== null);
  const wallets = rows.some((row) => row.lowWallet !== null);
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('dashboard.clients.client')}</TableHead>
            <TableHead>{t('dashboard.clients.retainers')}</TableHead>
            <TableHead className="text-end">{t('dashboard.clients.openProjects')}</TableHead>
            <TableHead>{t('dashboard.clients.approvals')}</TableHead>
            {money && (
              <TableHead className="text-end">{t('dashboard.clients.outstanding')}</TableHead>
            )}
            {wallets && <TableHead>{t('dashboard.clients.wallet')}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.client.id}>
              <TableCell>
                <span className="flex items-center gap-2">
                  {row.hasProblem && (
                    <TriangleAlertIcon
                      role="img"
                      aria-label={t('dashboard.clients.needsAttention')}
                      className="size-4 shrink-0 text-destructive-text"
                    />
                  )}
                  <Link
                    to="/clients/$clientId"
                    params={{ clientId: row.client.id }}
                    className="font-medium hover:underline"
                  >
                    {row.client.name}
                  </Link>
                </span>
              </TableCell>
              <TableCell className="whitespace-normal">
                {row.retainers.length === 0 ? (
                  <span className="text-muted-foreground">{t('common.none')}</span>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {row.retainers.map(({ retainer, completion, behind }) => (
                      <li key={retainer.id} className="flex flex-wrap items-center gap-2">
                        <Link
                          to="/retainers/$retainerId"
                          params={{ retainerId: retainer.id }}
                          className="text-sm hover:underline"
                        >
                          {retainer.name}
                        </Link>
                        <DeliveryRate rate={completion} />
                        {behind && <BehindBadge />}
                      </li>
                    ))}
                  </ul>
                )}
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {formatNumber(row.openProjects)}
              </TableCell>
              <TableCell className="whitespace-normal">
                <Approvals approvals={row.approvals} clientId={row.client.id} />
              </TableCell>
              {money && (
                <TableCell className="text-end">
                  {row.invoices && (
                    <span className="flex flex-col items-end gap-1">
                      <Money minor={row.invoices.outstandingUsdMinor} currency="USD" />
                      {row.invoices.overdue > 0 && (
                        <Badge tone="danger">
                          {t('dashboard.clients.overdueInvoices', {
                            count: row.invoices.overdue,
                            n: formatNumber(row.invoices.overdue),
                          })}
                        </Badge>
                      )}
                    </span>
                  )}
                </TableCell>
              )}
              {wallets && (
                <TableCell>
                  {row.lowWallet ? (
                    <LowBalanceBadge />
                  ) : (
                    <span className="text-muted-foreground">{t('common.none')}</span>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Approvals({
  approvals,
  clientId,
}: {
  approvals: ClientRow['approvals'];
  clientId: string;
}) {
  const { t } = useTranslation();
  if (approvals.pending === 0) {
    return <span className="text-muted-foreground">{t('common.none')}</span>;
  }
  return (
    <span className="flex flex-col items-start gap-1">
      <Link
        to="/clients/$clientId"
        params={{ clientId }}
        search={{ tab: 'approvals' }}
        className="text-sm font-medium hover:underline"
      >
        {t('dashboard.clients.pending', {
          count: approvals.pending,
          n: formatNumber(approvals.pending),
        })}
      </Link>
      {approvals.oldestSentAt && (
        <span className="text-xs text-muted-foreground">
          {t('dashboard.clients.oldestSent', { date: formatDate(approvals.oldestSentAt) })}
        </span>
      )}
      {approvals.waiting && <Badge tone="warning">{t('dashboard.clients.waiting')}</Badge>}
    </span>
  );
}
