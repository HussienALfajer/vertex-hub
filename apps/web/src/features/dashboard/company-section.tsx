import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type CompanyDashboard, weekOf } from '@vertex-hub/contracts';
import {
  Badge,
  cn,
  Meter,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-hub/ui';
import { Building2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDateTime, formatNumber } from '../../lib/format';
import { Balance } from '../campaigns/campaign-badges';
import { useDepartmentNames } from '../projects/project-badges';
import { companyDashboardQuery } from '../reports/reports.queries';
import { DeliveryRate } from '../retainers/retainer-badges';
import type { TaskListSearch } from '../tasks/task-list-page';
import { DashboardSection, LastMonth, SeeLink, StatCard, SubHeading } from './dashboard-parts';

/** Rule 1: the company at a glance, for the General Manager and the Operations manager. */
export function CompanySection() {
  const { t } = useTranslation();
  const company = useQuery(companyDashboardQuery);
  return (
    <DashboardSection
      id="company"
      title={t('dashboard.company.title')}
      icon={Building2Icon}
      query={company}
      loadError={t('dashboard.company.loadError')}
    >
      {(data) => (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <EngagementCards data={data} />
            <ApprovalsCard data={data} />
          </div>
          <LeadsCards data={data} />
          <DepartmentsTable data={data} />
          <div className="grid gap-4 lg:grid-cols-2">
            <RetainersBehind data={data} />
            <LowWallets data={data} />
          </div>
        </>
      )}
    </DashboardSection>
  );
}

function EngagementCards({ data }: { data: CompanyDashboard }) {
  const { t } = useTranslation();
  const { projects, retainers } = data.activeEngagements;
  const total = projects.reduce((sum, row) => sum + row.count, 0);
  return (
    <>
      <StatCard
        label={t('dashboard.company.activeProjects')}
        value={formatNumber(total)}
        detail={
          <span className="flex flex-wrap gap-x-3">
            {projects.map(({ status, count }) => (
              <span key={status}>
                {t(`projects.statuses.${status}`)}{' '}
                <span className="font-medium text-foreground tabular-nums">
                  {formatNumber(count)}
                </span>
              </span>
            ))}
          </span>
        }
        link={{ to: '/projects', label: t('dashboard.company.openProjects') }}
      />
      <StatCard
        label={t('dashboard.company.activeRetainers')}
        value={formatNumber(retainers)}
        link={{ to: '/retainers', label: t('dashboard.company.openRetainers') }}
      />
    </>
  );
}

/** Pending items whose link went out more than 48 hours ago, with the oldest of them. */
function ApprovalsCard({ data }: { data: CompanyDashboard }) {
  const { t } = useTranslation();
  const { count, oldest } = data.approvalsWaiting;
  return (
    <StatCard
      className="xl:col-span-2"
      label={t('dashboard.company.approvalsWaiting')}
      value={formatNumber(count)}
      alert={count > 0}
      detail={
        oldest && (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {t('dashboard.company.oldestApproval', {
              title: oldest.title,
              client: oldest.client.name,
              when: formatDateTime(oldest.sentAt),
            })}
            {oldest.expired && <Badge tone="warning">{t('dashboard.company.linkExpired')}</Badge>}
          </span>
        )
      }
      link={{
        to: '/approvals',
        search: { tab: 'sent' },
        label: t('dashboard.company.openApprovals'),
      }}
    />
  );
}

function LeadsCards({ data }: { data: CompanyDashboard }) {
  const { t } = useTranslation();
  const { thisMonth, lastMonth } = data.leads;
  const rate = (value: number | null) =>
    value === null ? t('common.none') : formatNumber(value / 100, { style: 'percent' });
  const cards = [
    { key: 'new', value: formatNumber(thisMonth.new), last: formatNumber(lastMonth.new) },
    { key: 'won', value: formatNumber(thisMonth.won), last: formatNumber(lastMonth.won) },
    { key: 'lost', value: formatNumber(thisMonth.lost), last: formatNumber(lastMonth.lost) },
    {
      key: 'conversion',
      value: rate(thisMonth.conversionRate),
      last: rate(lastMonth.conversionRate),
    },
  ] as const;
  return (
    <section aria-labelledby="dashboard-leads" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SubHeading id="dashboard-leads">{t('dashboard.company.leads')}</SubHeading>
        <SeeLink to="/leads" label={t('dashboard.company.openLeads')} />
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {cards.map((card) => (
          <StatCard
            key={card.key}
            label={t(`dashboard.company.leadMeasures.${card.key}`)}
            value={card.value}
            detail={<LastMonth>{card.last}</LastMonth>}
          />
        ))}
      </div>
    </section>
  );
}

/** Per department, the F06 workload counts; the bars compare open tasks across departments. */
function DepartmentsTable({ data }: { data: CompanyDashboard }) {
  const { t } = useTranslation();
  const departmentName = useDepartmentNames();
  const most = Math.max(1, ...data.departments.map((row) => row.open));
  const week = weekOf(data.months.thisMonth.to);
  return (
    <section aria-labelledby="dashboard-departments-load" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SubHeading id="dashboard-departments-load">
          {t('dashboard.company.departments')}
        </SubHeading>
        <SeeLink to="/tasks/workload" label={t('dashboard.company.openWorkload')} />
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('dashboard.columns.department')}</TableHead>
              <TableHead className="text-end">{t('dashboard.columns.overdue')}</TableHead>
              <TableHead className="text-end">{t('dashboard.columns.dueThisWeek')}</TableHead>
              <TableHead className="text-end">{t('dashboard.columns.unassigned')}</TableHead>
              <TableHead className="text-end">{t('dashboard.columns.open')}</TableHead>
              <TableHead className="w-1/5">
                <span className="sr-only">{t('dashboard.columns.load')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.departments.map((row) => {
              const name = departmentName(row.department);
              const department = [row.department];
              return (
                <TableRow key={row.department}>
                  <TableCell className="font-medium">{name}</TableCell>
                  <CountCell
                    count={row.overdue}
                    alert
                    label={t('dashboard.columns.overdueOf', { name })}
                    search={{ department, overdue: true }}
                  />
                  <CountCell
                    count={row.dueThisWeek}
                    label={t('dashboard.columns.dueThisWeekOf', { name })}
                    search={{ department, dueFrom: week.from, dueTo: week.to }}
                  />
                  <CountCell
                    count={row.unassigned}
                    label={t('dashboard.columns.unassignedOf', { name })}
                    search={{ department, assignee: 'unassigned' }}
                  />
                  <CountCell
                    count={row.open}
                    label={t('dashboard.columns.openOf', { name })}
                    search={{ department }}
                  />
                  <TableCell>
                    <Meter
                      value={row.open}
                      max={most}
                      tone={row.overdue > 0 ? 'danger' : 'brand'}
                      aria-label={t('dashboard.columns.openOf', { name })}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

/** A count that opens its tasks in the list; zero is plain text. */
export function CountCell({
  count,
  search,
  label,
  alert,
}: {
  count: number;
  search: TaskListSearch;
  label: string;
  alert?: boolean;
}) {
  return (
    <TableCell className="text-end tabular-nums">
      {count > 0 ? (
        <Link
          to="/tasks/list"
          search={search}
          aria-label={`${label}: ${formatNumber(count)}`}
          className={cn('font-bold hover:underline', alert && 'text-destructive-text')}
        >
          {formatNumber(count)}
        </Link>
      ) : (
        <span className="text-muted-foreground">{formatNumber(count)}</span>
      )}
    </TableCell>
  );
}

function RetainersBehind({ data }: { data: CompanyDashboard }) {
  const { t } = useTranslation();
  return (
    <section
      aria-labelledby="dashboard-behind"
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SubHeading id="dashboard-behind">{t('dashboard.company.retainersBehind')}</SubHeading>
        {data.retainersBehind.length > 0 && (
          <SeeLink
            to="/retainers"
            search={{ behind: true }}
            label={t('dashboard.company.openBehind')}
          />
        )}
      </div>
      {data.retainersBehind.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('dashboard.company.noneBehind')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {data.retainersBehind.map((row) => (
            <li key={row.cycleId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
              {/* A base width: on a phone the badge and the rate wrap under the name. */}
              <span className="flex min-w-0 flex-1 basis-48 flex-col">
                <Link
                  to="/retainers/$retainerId"
                  params={{ retainerId: row.retainer.id }}
                  className="w-fit font-medium hover:underline"
                >
                  {row.retainer.name}
                </Link>
                <span className="text-xs text-muted-foreground">{row.client.name}</span>
              </span>
              <Badge tone="warning">
                {t('dashboard.company.linesBehind', {
                  count: row.linesBehind,
                  n: formatNumber(row.linesBehind),
                })}
              </Badge>
              <DeliveryRate rate={row.completion} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LowWallets({ data }: { data: CompanyDashboard }) {
  const { t } = useTranslation();
  return (
    <section
      aria-labelledby="dashboard-wallets"
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SubHeading id="dashboard-wallets">{t('dashboard.company.lowWallets')}</SubHeading>
        <SeeLink to="/campaigns" label={t('dashboard.company.openCampaigns')} />
      </div>
      {data.lowWallets.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('dashboard.company.noLowWallets')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {data.lowWallets.map((row) => (
            <li key={row.client.id} className="flex items-center justify-between gap-4 py-2">
              <Link
                to="/clients/$clientId"
                params={{ clientId: row.client.id }}
                search={{ tab: 'ads' }}
                className="font-medium hover:underline"
              >
                {row.client.name}
              </Link>
              <Balance minor={row.balanceUsdMinor} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
