import { useQuery } from '@tanstack/react-query';
import type { DepartmentCode, DepartmentDashboard } from '@vertex-hub/contracts';
import {
  Avatar,
  Meter,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-hub/ui';
import { CircleCheckBigIcon, UsersIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../lib/format';
import { useDepartmentNames } from '../projects/project-badges';
import { ChoiceSelect } from '../quotes/choice-select';
import { departmentDashboardQuery } from '../reports/reports.queries';
import { TaskStatusBadge } from '../tasks/task-badges';
import { TaskRows } from '../tasks/task-rows';
import { CountCell } from './company-section';
import { DashboardSection, SeeLink, StatCard, SubHeading } from './dashboard-parts';

/**
 * Rule 3: one department at a time, the first the user manages by default; a picker when the user
 * holds `all` or manages several (edge case 2).
 */
export function DepartmentsSection() {
  const { t } = useTranslation();
  const departmentName = useDepartmentNames();
  const [department, setDepartment] = useState<DepartmentCode | undefined>();
  const dashboard = useQuery(departmentDashboardQuery(department));
  return (
    <DashboardSection
      id="departments"
      title={t('dashboard.departments.title')}
      icon={UsersIcon}
      query={dashboard}
      loadError={t('dashboard.departments.loadError')}
      actions={
        dashboard.data &&
        (dashboard.data.departments.length > 1 ? (
          <DepartmentPicker
            departments={dashboard.data.departments}
            value={dashboard.data.department}
            onChange={setDepartment}
          />
        ) : (
          <span className="text-sm font-medium text-muted-foreground">
            {departmentName(dashboard.data.department)}
          </span>
        ))
      }
    >
      {(data) => <DepartmentContent data={data} />}
    </DashboardSection>
  );
}

function DepartmentPicker({
  departments,
  value,
  onChange,
}: {
  departments: DepartmentCode[];
  value: DepartmentCode;
  onChange: (department: DepartmentCode) => void;
}) {
  const { t } = useTranslation();
  const departmentName = useDepartmentNames();
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <span id={id} className="text-sm text-muted-foreground">
        {t('dashboard.departments.pick')}
      </span>
      <ChoiceSelect
        labelledBy={id}
        className="w-56"
        items={departments.map((code) => ({ value: code, label: departmentName(code) }))}
        value={value}
        onChange={(next) => onChange(next as DepartmentCode)}
      />
    </div>
  );
}

function DepartmentContent({ data }: { data: DepartmentDashboard }) {
  const { t } = useTranslation();
  const department = [data.department];
  const open = data.byStatus.reduce((sum, row) => sum + row.count, 0);
  return (
    <>
      <div className="grid gap-3 md:grid-cols-3">
        <StatCard
          label={t('dashboard.departments.open')}
          value={formatNumber(open)}
          detail={
            <span className="flex flex-wrap gap-1.5 pt-1">
              {data.byStatus
                .filter((row) => row.count > 0)
                .map((row) => (
                  <span key={row.status} className="flex items-center gap-1">
                    <TaskStatusBadge status={row.status} />
                    <span className="font-medium text-foreground tabular-nums">
                      {formatNumber(row.count)}
                    </span>
                  </span>
                ))}
            </span>
          }
          link={{
            to: '/tasks/board',
            search: { department },
            label: t('dashboard.departments.openBoard'),
          }}
        />
        <StatCard
          label={t('dashboard.departments.overdue')}
          value={formatNumber(data.overdue.count)}
          alert={data.overdue.count > 0}
          link={{
            to: '/tasks/list',
            search: { department, overdue: true },
            label: t('dashboard.departments.openOverdue'),
          }}
        />
        <StatCard
          label={t('dashboard.departments.unassigned')}
          value={formatNumber(data.unassigned)}
          alert={data.unassigned > 0}
          link={{
            to: '/tasks/list',
            search: { department, assignee: 'unassigned' },
            label: t('dashboard.departments.openUnassigned'),
          }}
        />
      </div>
      <section aria-labelledby="dashboard-overdue-tasks" className="flex flex-col gap-3">
        <SubHeading id="dashboard-overdue-tasks">
          {t('dashboard.departments.oldestOverdue')}
        </SubHeading>
        {data.overdue.oldest.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleCheckBigIcon aria-hidden="true" className="size-4" />
            {t('dashboard.departments.noOverdue')}
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <TaskRows tasks={data.overdue.oldest} showAssignee />
          </div>
        )}
      </section>
      <PeopleTable data={data} />
    </>
  );
}

/** As F06 Workload: per member, this week's numbers, each opening its tasks in the list. */
function PeopleTable({ data }: { data: DepartmentDashboard }) {
  const { t } = useTranslation();
  const most = Math.max(1, ...data.people.map((person) => person.open));
  const { from, to } = data.week;
  return (
    <section aria-labelledby="dashboard-people" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SubHeading id="dashboard-people">{t('dashboard.departments.people')}</SubHeading>
        <SeeLink
          to="/tasks/workload"
          search={{ department: [data.department] }}
          label={t('dashboard.departments.openWorkload')}
        />
      </div>
      {data.people.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('dashboard.departments.noPeople')}</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('dashboard.columns.person')}</TableHead>
                <TableHead className="text-end">{t('dashboard.columns.overdue')}</TableHead>
                <TableHead className="text-end">{t('dashboard.columns.dueThisWeek')}</TableHead>
                <TableHead className="text-end">{t('dashboard.columns.open')}</TableHead>
                <TableHead className="w-1/4">
                  <span className="sr-only">{t('dashboard.columns.load')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.people.map(({ user, overdue, dueThisWeek, open }) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <span className="flex items-center gap-3">
                      <Avatar name={user.name} size="sm" />
                      <span className="font-medium">{user.name}</span>
                    </span>
                  </TableCell>
                  <CountCell
                    count={overdue}
                    alert
                    label={t('dashboard.columns.overdueOf', { name: user.name })}
                    search={{ assignee: user.id, overdue: true }}
                  />
                  <CountCell
                    count={dueThisWeek}
                    label={t('dashboard.columns.dueThisWeekOf', { name: user.name })}
                    search={{ assignee: user.id, dueFrom: from, dueTo: to }}
                  />
                  <CountCell
                    count={open}
                    label={t('dashboard.columns.openOf', { name: user.name })}
                    search={{ assignee: user.id }}
                  />
                  <TableCell>
                    <Meter
                      value={open}
                      max={most}
                      tone={overdue > 0 ? 'danger' : 'brand'}
                      aria-label={t('dashboard.columns.openOf', { name: user.name })}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
