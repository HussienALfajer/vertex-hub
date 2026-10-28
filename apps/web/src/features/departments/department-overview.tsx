import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type {
  DepartmentDetailResponse,
  DepartmentOverview as Overview,
} from '@vertex-hub/contracts';
import {
  Avatar,
  Button,
  Card,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-hub/ui';
import { UserPlusIcon, UsersIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { can, useMe } from '../../lib/auth';
import { formatCalendarDate, formatNumber } from '../../lib/format';
import { imageSrc } from '../../lib/images';
import { departmentOverviewQuery } from './departments.queries';

/**
 * Rules 24 and 25: the department's counts, each opening the filtered list, and for those who
 * read its reports, the workload per member and who is on leave today.
 */
export function DepartmentOverview({
  department,
  onAddMembers,
}: {
  department: DepartmentDetailResponse;
  onAddMembers: () => void;
}) {
  const { t } = useTranslation();
  const canManage = can(useMe(), 'users.manage');
  const overview = useQuery(departmentOverviewQuery(department.id));

  if (overview.isPending) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((key) => (
          <Skeleton key={key} className="h-24" />
        ))}
      </div>
    );
  }
  if (overview.isError) {
    return (
      <LoadError message={t('departments.overview.loadError')} onRetry={() => overview.refetch()} />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {department.members.length === 0 && (
        // Edge case 16: counts can still be non-zero (queue tasks) without members.
        <EmptyState
          icon={<UsersIcon />}
          title={t('departments.detail.noMembers')}
          description={canManage ? t('departments.overview.addMembersHint') : undefined}
          action={
            canManage && (
              <Button variant="outline" onClick={onAddMembers}>
                <UserPlusIcon />
                {t('departments.members.add')}
              </Button>
            )
          }
          className="rounded-lg border border-dashed border-border py-8"
        />
      )}
      <CountTiles department={department} overview={overview.data} />
      {overview.data.members && <Workload overview={overview.data} />}
      {overview.data.onLeave && <OnLeave overview={overview.data} />}
    </div>
  );
}

function CountTiles({
  department,
  overview,
}: {
  department: DepartmentDetailResponse;
  overview: Overview;
}) {
  const { t } = useTranslation();
  const departments = [department.code];
  return (
    <section aria-label={t('departments.overview.counts')}>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {overview.byStatus.map(({ status, count }) => (
          <li key={status}>
            <Link
              to="/tasks/list"
              search={{ department: departments, status: [status] }}
              className={tileClass}
            >
              <Tile label={t(`tasks.statuses.${status}`)} count={count} />
            </Link>
          </li>
        ))}
        <li>
          <Link
            to="/tasks/list"
            search={{ department: departments, overdue: true }}
            className={tileClass}
          >
            <Tile label={t('departments.overview.overdue')} count={overview.overdue} alert />
          </Link>
        </li>
        <li>
          <Link
            to="/tasks/list"
            search={{
              department: departments,
              dueFrom: overview.week.from,
              dueTo: overview.week.to,
            }}
            className={tileClass}
          >
            <Tile label={t('departments.overview.dueThisWeek')} count={overview.dueThisWeek} />
          </Link>
        </li>
        <li>
          <Link
            to="/tasks/list"
            search={{ department: departments, assignee: 'unassigned' }}
            className={tileClass}
          >
            <Tile label={t('departments.overview.unassigned')} count={overview.unassigned} />
          </Link>
        </li>
        <li>
          <Link to="/catalog" search={{ department: department.code }} className={tileClass}>
            <Tile label={t('departments.overview.services')} count={overview.services} />
          </Link>
        </li>
        <li>
          <Link to="/projects" search={{ department: department.code }} className={tileClass}>
            <Tile label={t('departments.overview.projects')} count={overview.projects} />
          </Link>
        </li>
        <li>
          <Link to="/retainers" search={{ department: department.code }} className={tileClass}>
            <Tile label={t('departments.overview.retainers')} count={overview.retainers} />
          </Link>
        </li>
      </ul>
    </section>
  );
}

const tileClass =
  'flex h-full flex-col gap-1 rounded-lg border border-border bg-surface p-4 transition-colors duration-150 ease-out hover:border-primary';

function Tile({ label, count, alert = false }: { label: string; count: number; alert?: boolean }) {
  return (
    <>
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={cn(
          'text-2xl font-bold tabular-nums',
          alert && count > 0 && 'text-destructive-text',
        )}
      >
        {formatNumber(count)}
      </span>
    </>
  );
}

function Workload({ overview }: { overview: Overview }) {
  const { t } = useTranslation();
  const members = overview.members ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('departments.overview.workload')}</CardTitle>
      </CardHeader>
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('departments.overview.noWorkload')}</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('tasks.workload.person')}</TableHead>
                <TableHead className="text-end">{t('tasks.workload.overdue')}</TableHead>
                <TableHead className="text-end">{t('tasks.workload.dueThisWeek')}</TableHead>
                <TableHead className="text-end">{t('tasks.workload.open')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map(({ user, overdue, dueThisWeek, open }) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <Avatar name={user.name} src={imageSrc(user.imageId, 'sm')} size="sm" />
                      <span className="font-medium">{user.name}</span>
                    </span>
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-end tabular-nums',
                      overdue > 0 && 'font-bold text-destructive-text',
                    )}
                  >
                    {formatNumber(overdue)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatNumber(dueThisWeek)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{formatNumber(open)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

/** Rule 25: name and dates only, never the leave type (F17). */
function OnLeave({ overview }: { overview: Overview }) {
  const { t } = useTranslation();
  const onLeave = overview.onLeave ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('departments.overview.onLeave')}</CardTitle>
      </CardHeader>
      {onLeave.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('departments.overview.nobodyOnLeave')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {onLeave.map(({ user, startsOn, endsOn }) => (
            <li key={user.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
              <Avatar name={user.name} src={imageSrc(user.imageId, 'sm')} size="sm" />
              <span className="min-w-0 flex-1 truncate font-medium">{user.name}</span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {t('departments.overview.leaveDates', {
                  from: formatCalendarDate(startsOn),
                  to: formatCalendarDate(endsOn),
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
