import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  DEPARTMENT_CODES,
  type DepartmentCode,
  type ProductivityMeasures,
  type ProductivityReport,
} from '@vertex-hub/contracts';
import {
  Badge,
  EmptyState,
  Field,
  FieldLabel,
  MultiCombobox,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-hub/ui';
import { UsersIcon } from 'lucide-react';
import { Fragment, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { scopesOf, useMe } from '../../lib/auth';
import { formatCalendarDate, formatNumber } from '../../lib/format';
import { listParam } from '../../lib/search-params';
import { departmentListQuery } from '../departments/departments.queries';
import { managedDepartments } from '../tasks/task-access';
import {
  BackToReports,
  ExportButton,
  PeriodPicker,
  type PeriodSearch,
  parsePeriodSearch,
  usePeriod,
} from './report-parts';
import { productivityReportQuery, reportExportUrls } from './reports.queries';

export interface ProductivitySearch extends PeriodSearch {
  /** Unset means every department in scope. */
  department?: DepartmentCode[];
}

export function parseProductivitySearch(search: Record<string, unknown>): ProductivitySearch {
  return {
    ...parsePeriodSearch(search),
    department: listParam(DEPARTMENT_CODES, search.department),
  };
}

/** Screen 3: rules 8–10 per department, with its people under it. */
export function ProductivityPage({ search }: { search: ProductivitySearch }) {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: '/reports/productivity' });
  const { period, query: periodQuery, valid } = usePeriod(search);
  const query = { ...periodQuery, department: search.department };
  const report = useQuery({ ...productivityReportQuery(query), enabled: valid });
  const setSearch = (next: Partial<ProductivitySearch>) =>
    navigate({ search: (previous) => ({ ...previous, ...next }), replace: true });

  return (
    <>
      <BackToReports />
      <PageHeader
        title={t('reports.productivity.title')}
        description={t('reports.productivity.subtitle', {
          from: formatCalendarDate(period.from),
          to: formatCalendarDate(period.to),
        })}
        actions={<ExportButton href={reportExportUrls.productivity(query)} disabled={!valid} />}
      />
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 md:flex-row md:items-start">
        <PeriodPicker
          search={search}
          onChange={(next) => setSearch({ from: next.from, to: next.to })}
        />
        <DepartmentFilter
          value={search.department}
          onChange={(department) => setSearch({ department })}
        />
      </div>
      {!valid ? null : report.isPending ? (
        <Skeleton className="h-96" />
      ) : report.isError ? (
        <LoadError message={t('reports.productivity.loadError')} onRetry={() => report.refetch()} />
      ) : report.data.departments.length === 0 ? (
        <EmptyState icon={<UsersIcon />} title={t('reports.productivity.empty')} />
      ) : (
        <ProductivityTable report={report.data} />
      )}
    </>
  );
}

/** The departments in the user's scope: all for `all` holders, else the ones they manage. */
function DepartmentFilter({
  value,
  onChange,
}: {
  value: DepartmentCode[] | undefined;
  onChange: (department: DepartmentCode[] | undefined) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const me = useMe();
  const departments = useQuery(departmentListQuery);
  const inScope = scopesOf(me, 'reports.read').includes('all')
    ? DEPARTMENT_CODES
    : managedDepartments(me);
  const options = (departments.data?.items ?? [])
    .filter(({ code }) => inScope.includes(code))
    .map(({ code, name }) => ({ code, name }));
  return (
    <Field className="flex-1">
      <FieldLabel htmlFor={id}>{t('reports.productivity.departments')}</FieldLabel>
      <MultiCombobox
        id={id}
        items={options}
        value={(value ?? []).flatMap(
          (code) => options.find((option) => option.code === code) ?? [],
        )}
        onValueChange={(next) =>
          onChange(next.length > 0 ? next.map(({ code }) => code) : undefined)
        }
        itemToLabel={(item) => item.name}
        itemToKey={(item) => item.code}
        placeholder={t('reports.productivity.allDepartments')}
        emptyLabel={t('common.noMatches')}
        removeLabel={(label) => t('common.remove', { label })}
      />
    </Field>
  );
}

const MEASURES = [
  'new',
  'delivered',
  'onTimeRate',
  'averageClientRevisions',
  'averageInternalRevisions',
  'averageCycleDays',
  'openNow',
  'overdueNow',
] as const;

function ProductivityTable({ report }: { report: ProductivityReport }) {
  const { t } = useTranslation();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('reports.productivity.name')}</TableHead>
          {MEASURES.map((measure) => (
            <TableHead key={measure} className="min-w-20 text-end whitespace-normal">
              {t(`reports.productivity.measures.${measure}`)}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {report.departments.map((row) => (
          <Fragment key={row.department}>
            <TableRow className="bg-muted/50">
              <TableCell>
                <span className="flex flex-col">
                  <span className="font-bold">{row.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {row.unassigned.count === 0
                      ? t('reports.productivity.noUnassigned')
                      : t('reports.productivity.unassigned', {
                          n: formatNumber(row.unassigned.count),
                          date: row.unassigned.oldestOn
                            ? formatCalendarDate(row.unassigned.oldestOn)
                            : '',
                        })}
                  </span>
                </span>
              </TableCell>
              <MeasureCells measures={row.measures} strong />
            </TableRow>
            {row.people.map(({ user, measures }) => (
              <TableRow key={`${row.department}-${user.id}`}>
                <TableCell className="ps-8">
                  <span className="flex flex-wrap items-center gap-2">
                    {user.name}
                    {user.archived && (
                      <Badge tone="neutral">{t('reports.productivity.archived')}</Badge>
                    )}
                  </span>
                </TableCell>
                <MeasureCells measures={measures} />
              </TableRow>
            ))}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  );
}

function MeasureCells({ measures, strong }: { measures: ProductivityMeasures; strong?: boolean }) {
  const { t } = useTranslation();
  const none = <span className="text-muted-foreground">{t('common.none')}</span>;
  const decimal = (value: number | null) =>
    value === null
      ? none
      : formatNumber(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const cells = {
    new: formatNumber(measures.new),
    delivered: formatNumber(measures.delivered),
    onTimeRate:
      measures.onTimeRate === null
        ? none
        : formatNumber(measures.onTimeRate / 100, { style: 'percent' }),
    averageClientRevisions: decimal(measures.averageClientRevisions),
    averageInternalRevisions: decimal(measures.averageInternalRevisions),
    averageCycleDays: decimal(measures.averageCycleDays),
    openNow: formatNumber(measures.openNow),
    overdueNow:
      measures.overdueNow > 0 ? (
        <span className="text-destructive-text">{formatNumber(measures.overdueNow)}</span>
      ) : (
        formatNumber(measures.overdueNow)
      ),
  };
  return (
    <>
      {MEASURES.map((measure) => (
        <TableCell
          key={measure}
          className={strong ? 'text-end font-bold tabular-nums' : 'text-end tabular-nums'}
        >
          {cells[measure]}
        </TableCell>
      ))}
    </>
  );
}
