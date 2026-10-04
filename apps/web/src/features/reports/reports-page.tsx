import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { addMonths, businessDate, CLIENT_STATUSES, type MeResponse } from '@vertex-hub/contracts';
import { Button, Card, Field, FieldLabel, PageHeader } from '@vertex-hub/ui';
import {
  ChartNoAxesColumnIcon,
  ClockAlertIcon,
  FileChartColumnIcon,
  type LucideIcon,
  UsersIcon,
} from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { can, scopesOf, useMe } from '../../lib/auth';
import { clientListQuery } from '../clients/clients.queries';
import { SeeLink } from '../dashboard/dashboard-parts';
import { ChoiceSelect } from '../quotes/choice-select';
import { MonthSelect } from './report-parts';

/** Which reports the user can open (rule 23; the API enforces it). */
export function reportsFor(me: MeResponse) {
  const scopes = scopesOf(me, 'reports.read');
  return {
    productivity: scopes.includes('all') || scopes.includes('department'),
    finance: can(me, 'reports.finance'),
    clientReport: scopes.includes('all') || scopes.includes('own_clients'),
  };
}

export function hasReports(me: MeResponse): boolean {
  return can(me, 'reports.read') || can(me, 'reports.finance');
}

/** Screen 2: the reports the user can open, with a line on what each shows. */
export function ReportsPage() {
  const { t } = useTranslation();
  const me = useMe();
  const open = reportsFor(me);
  return (
    <>
      <PageHeader title={t('reports.title')} description={t('reports.subtitle')} />
      <div className="grid gap-4 md:grid-cols-2">
        {open.clientReport && <ClientReportCard />}
        {open.productivity && (
          <ReportCard
            icon={UsersIcon}
            title={t('reports.productivity.title')}
            description={t('reports.productivity.about')}
            to="/reports/productivity"
          />
        )}
        {open.finance && (
          <>
            <ReportCard
              icon={ChartNoAxesColumnIcon}
              title={t('reports.revenue.title')}
              description={t('reports.revenue.about')}
              to="/reports/revenue"
            />
            <ReportCard
              icon={ClockAlertIcon}
              title={t('reports.overdue.title')}
              description={t('reports.overdue.about')}
              to="/reports/overdue-invoices"
            />
          </>
        )}
      </div>
    </>
  );
}

function ReportCard({
  icon: Icon,
  title,
  description,
  to,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  to: '/reports/productivity' | '/reports/revenue' | '/reports/overdue-invoices';
}) {
  const { t } = useTranslation();
  return (
    <Card className="gap-3">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-5">
          <Icon aria-hidden="true" />
        </span>
        <h2 className="text-lg font-bold">{title}</h2>
      </div>
      <p className="text-sm text-muted-foreground">{description}</p>
      <SeeLink to={to} label={t('reports.open')} className="mt-auto" />
    </Card>
  );
}

/**
 * Screen 6's entry: a client in the user's report scope (all clients, or those they are account
 * manager of) and a month up to the current one; last month by default.
 */
function ClientReportCard() {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const ids = { client: useId(), month: useId() };
  const all = scopesOf(me, 'reports.read').includes('all');
  const clients = useQuery(
    clientListQuery({
      status: [...CLIENT_STATUSES],
      accountManagerId: all ? undefined : me.user.id,
      pageSize: 100,
    }),
  );
  const [clientId, setClientId] = useState<string | null>(null);
  const [month, setMonth] = useState(addMonths(businessDate(), -1).slice(0, 7));

  return (
    <Card className="gap-3 md:col-span-2">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-5">
          <FileChartColumnIcon aria-hidden="true" />
        </span>
        <h2 className="text-lg font-bold">{t('reports.client.title')}</h2>
      </div>
      <p className="text-sm text-muted-foreground">{t('reports.client.about')}</p>
      <form
        className="flex flex-col gap-3 md:flex-row md:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          if (!clientId) return;
          void navigate({
            to: '/clients/$clientId/report',
            params: { clientId },
            search: { month },
          });
        }}
      >
        <Field className="md:w-72">
          <FieldLabel id={ids.client} render={<span />}>
            {t('reports.client.client')}
          </FieldLabel>
          <ChoiceSelect
            labelledBy={ids.client}
            placeholder={t('reports.client.pickClient')}
            items={(clients.data?.items ?? []).map((client) => ({
              value: client.id,
              label: client.tradeName,
            }))}
            value={clientId}
            onChange={setClientId}
          />
        </Field>
        <Field className="md:w-48">
          <FieldLabel id={ids.month} render={<span />}>
            {t('reports.client.month')}
          </FieldLabel>
          <MonthSelect labelledBy={ids.month} value={month} onChange={setMonth} />
        </Field>
        <Button type="submit" disabled={!clientId}>
          {t('reports.client.open')}
        </Button>
      </form>
    </Card>
  );
}
