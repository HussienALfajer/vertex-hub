import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  EMPLOYEE_STATUSES,
  type EmployeeStatus,
  type EmployeeSummary,
  type MeResponse,
} from '@vertex-hub/contracts';
import {
  Avatar,
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
} from '@vertex-hub/ui';
import { SearchIcon, UsersIcon } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { can, useMe } from '../../lib/auth';
import { formatDate, formatNumber } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { ALL, idParam, oneOfParam, pageParam, textParam } from '../../lib/search-params';
import { usePageInRange } from '../../lib/use-page-in-range';
import { useSearchText } from '../../lib/use-search-text';
import { departmentListQuery } from '../departments/departments.queries';
import { ChoiceSelect } from '../quotes/choice-select';
import { DepartmentChips } from '../users/user-badges';
import { EmployeeStatusBadge } from './employee-badges';
import { employeeListQuery } from './hr.queries';

/** People lists the files for `employees.read` and the pay for `salaries.read` (spec F17). */
export const hasPeopleAccess = (me: MeResponse) =>
  can(me, 'employees.read') || can(me, 'salaries.read');

export interface PeopleSearch {
  search?: string;
  departmentId?: string;
  status?: EmployeeStatus;
  page?: number;
}

const PAGE_SIZE = 25;

/** Reads the People filters from the URL, dropping anything malformed. */
export function parsePeopleSearch(search: Record<string, unknown>): PeopleSearch {
  return {
    search: textParam(search.search, 100),
    departmentId: idParam(search.departmentId),
    status: oneOfParam(EMPLOYEE_STATUSES, search.status),
    page: pageParam(search.page),
  };
}

export function PeoplePage({ search }: { search: PeopleSearch }) {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate({ from: '/hr/people/' });
  const page = search.page ?? 1;
  const files = can(me, 'employees.read');
  const pay = can(me, 'salaries.read');

  const employees = useQuery(
    employeeListQuery({
      search: search.search,
      departmentId: search.departmentId,
      status: search.status ?? 'active',
      page,
      pageSize: PAGE_SIZE,
    }),
  );
  usePageInRange(
    page,
    employees.data?.total,
    PAGE_SIZE,
    useCallback(
      (next: number | undefined) =>
        navigate({ search: (previous) => ({ ...previous, page: next }), replace: true }),
      [navigate],
    ),
  );

  const setFilter = useCallback(
    (next: Partial<PeopleSearch>) =>
      navigate({
        search: (previous) => ({ ...previous, ...next, page: undefined }),
        replace: true,
      }),
    [navigate],
  );

  return (
    <>
      <PageHeader title={t('hr.people.title')} description={t('hr.people.subtitle')} />

      <Filters search={search} onChange={setFilter} />

      {employees.isPending ? (
        <TableSkeleton />
      ) : employees.isError ? (
        <LoadError message={t('hr.people.loadError')} onRetry={() => employees.refetch()} />
      ) : employees.data.items.length === 0 ? (
        <EmptyState
          icon={<UsersIcon />}
          title={t('hr.people.emptyTitle')}
          description={t('hr.people.emptyHint')}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <PeopleTable employees={employees.data.items} files={files} pay={pay} />
          <Pagination
            page={page}
            pageCount={Math.ceil(employees.data.total / PAGE_SIZE)}
            onPageChange={(next) =>
              navigate({ search: (previous) => ({ ...previous, page: next }) })
            }
            summary={t('common.pageSummary', {
              from: formatNumber((page - 1) * PAGE_SIZE + 1),
              to: formatNumber((page - 1) * PAGE_SIZE + employees.data.items.length),
              total: formatNumber(employees.data.total),
            })}
            previousLabel={t('common.previous')}
            nextLabel={t('common.next')}
          />
        </div>
      )}
    </>
  );
}

function Filters({
  search,
  onChange,
}: {
  search: PeopleSearch;
  onChange: (next: Partial<PeopleSearch>) => void;
}) {
  const { t } = useTranslation();
  const departments = useQuery(departmentListQuery);
  const [text, setText] = useSearchText(search.search, onChange);

  const departmentItems = [
    { value: ALL, label: t('users.allDepartments') },
    ...(departments.data?.items ?? []).map((d) => ({ value: d.id, label: d.name })),
  ];
  const statusItems = EMPLOYEE_STATUSES.map((status) => ({
    value: status,
    label: t(`hr.statuses.${status}`),
  }));

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 md:flex-row md:flex-wrap md:items-center">
      <div className="relative flex-1 md:min-w-64">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('hr.people.search')}
          aria-label={t('hr.people.search')}
          className="ps-9"
        />
      </div>
      <ChoiceSelect
        label={t('users.department')}
        items={departmentItems}
        value={search.departmentId ?? ALL}
        onChange={(value) => onChange({ departmentId: value === ALL ? undefined : value })}
        className="md:w-44"
      />
      <ChoiceSelect
        label={t('hr.people.status')}
        items={statusItems}
        value={search.status ?? 'active'}
        onChange={(value) =>
          onChange({ status: value === 'active' ? undefined : (value as EmployeeStatus) })
        }
        className="md:w-44"
      />
    </div>
  );
}

function PeopleTable({
  employees,
  files,
  pay,
}: {
  employees: EmployeeSummary[];
  files: boolean;
  pay: boolean;
}) {
  const { t } = useTranslation();
  const none = <span className="text-muted-foreground">{t('common.none')}</span>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('hr.people.columns.name')}</TableHead>
          <TableHead>{t('hr.people.columns.departments')}</TableHead>
          {files && <TableHead>{t('hr.people.columns.type')}</TableHead>}
          {files && <TableHead>{t('hr.people.columns.startDate')}</TableHead>}
          {files && <TableHead>{t('hr.people.columns.schedule')}</TableHead>}
          {files && <TableHead>{t('hr.people.columns.contractEnd')}</TableHead>}
          {pay && <TableHead>{t('hr.people.columns.salary')}</TableHead>}
          {pay && <TableHead>{t('hr.people.columns.payout')}</TableHead>}
          <TableHead>{t('hr.people.status')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {employees.map((employee) => {
          const employment = employee.employment;
          const salary = employee.pay?.currentSalary;
          const method = employee.pay?.payoutMethod;
          return (
            <TableRow key={employee.userId}>
              <TableCell>
                <Link
                  to="/hr/people/$userId"
                  params={{ userId: employee.userId }}
                  className="group flex items-center gap-3 rounded-md outline-offset-4"
                >
                  <Avatar
                    name={employee.name}
                    size="sm"
                    tone={employee.status === 'ended' ? 'muted' : 'brand'}
                  />
                  <span className="flex flex-col">
                    <span className="font-medium group-hover:underline">{employee.name}</span>
                    {employee.title && (
                      <span className="text-xs text-muted-foreground">{employee.title}</span>
                    )}
                  </span>
                </Link>
              </TableCell>
              <TableCell className="whitespace-normal">
                <DepartmentChips departments={employee.departments} />
              </TableCell>
              {files && (
                <TableCell>
                  {employment ? t(`hr.employmentTypes.${employment.employmentType}`) : none}
                </TableCell>
              )}
              {files && (
                <TableCell>
                  {employment?.startDate ? formatDate(employment.startDate) : none}
                </TableCell>
              )}
              {files && <TableCell>{employment?.schedule.name ?? none}</TableCell>}
              {files && (
                <TableCell>
                  {employment?.contractEndDate
                    ? formatDate(employment.contractEndDate)
                    : employment
                      ? t('hr.file.openEnded')
                      : none}
                </TableCell>
              )}
              {pay && (
                <TableCell>
                  {salary ? (
                    <span dir="ltr" className="tabular-nums">
                      {formatMoney(salary.amountMinor, salary.currency)}
                    </span>
                  ) : (
                    none
                  )}
                </TableCell>
              )}
              {pay && <TableCell>{method ? t(`hr.payoutMethods.${method}`) : none}</TableCell>}
              <TableCell>
                <EmployeeStatusBadge status={employee.status} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      {['a', 'b', 'c', 'd', 'e'].map((row) => (
        <div key={row} className="flex items-center gap-3">
          <Skeleton className="size-7 rounded-full" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="ms-auto h-4 w-32" />
        </div>
      ))}
    </div>
  );
}
