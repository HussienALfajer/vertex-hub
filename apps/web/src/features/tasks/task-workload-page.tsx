import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  addDays,
  businessDate,
  DEPARTMENT_CODES,
  type DepartmentCode,
  type TaskWorkload,
  weekOf,
} from '@vertex-hub/contracts';
import {
  Avatar,
  Button,
  cn,
  EmptyState,
  Field,
  FieldLabel,
  IconButton,
  Meter,
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
import { ChevronLeftIcon, ChevronRightIcon, InboxIcon, UsersIcon } from 'lucide-react';
import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { formatCalendarDate, formatNumber } from '../../lib/format';
import { dayParam, listParam } from '../../lib/search-params';
import { departmentListQuery } from '../departments/departments.queries';
import { useDepartmentNames } from '../projects/project-badges';
import type { TaskListSearch } from './task-list-page';
import { taskWorkloadQuery } from './tasks.queries';

export interface TaskWorkloadSearch {
  /** Unset means the API's default: the departments the user manages, else their own. */
  department?: DepartmentCode[];
  /** The Saturday the week starts on; unset means this week. */
  week?: string;
}

/** Reads the workload filters from the URL, dropping anything malformed. */
export function parseTaskWorkloadSearch(search: Record<string, unknown>): TaskWorkloadSearch {
  const day = dayParam(search.week);
  const week = day ? weekOf(day).from : undefined;
  return {
    department: listParam(DEPARTMENT_CODES, search.department),
    week: week === weekOf(businessDate()).from ? undefined : week,
  };
}

/**
 * Who carries what this week (spec screen 4): per person of the chosen departments, overdue,
 * due in the week and open tasks, each a link to those tasks in the list; and the requests
 * nobody holds yet, per department.
 */
export function TaskWorkloadPage({ search }: { search: TaskWorkloadSearch }) {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: '/tasks/workload' });
  const thisWeek = weekOf(businessDate()).from;
  const week = search.week ?? thisWeek;
  const workload = useQuery(taskWorkloadQuery({ department: search.department, week }));
  const setFilter = (next: Partial<TaskWorkloadSearch>) =>
    navigate({ search: (previous) => ({ ...previous, ...next }), replace: true });
  const goTo = (from: string) => setFilter({ week: from === thisWeek ? undefined : from });

  return (
    <>
      <PageHeader title={t('tasks.workload.title')} description={t('tasks.workload.subtitle')} />
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 md:flex-row md:items-center">
        <WeekPicker
          from={week}
          current={week === thisWeek}
          onPrevious={() => goTo(addDays(week, -7))}
          onNext={() => goTo(addDays(week, 7))}
          onThisWeek={() => goTo(thisWeek)}
        />
        <DepartmentFilter
          value={search.department ?? workload.data?.departments ?? []}
          onChange={(department) => setFilter({ department })}
        />
      </div>
      {workload.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : workload.isError ? (
        <LoadError message={t('tasks.workload.loadError')} onRetry={() => workload.refetch()} />
      ) : (
        <>
          <UnassignedTiles workload={workload.data} />
          {workload.data.people.length === 0 ? (
            <EmptyState
              icon={<UsersIcon />}
              title={t('tasks.workload.emptyTitle')}
              description={t('tasks.workload.emptyHint')}
            />
          ) : (
            <PeopleTable workload={workload.data} />
          )}
        </>
      )}
    </>
  );
}

function WeekPicker({
  from,
  current,
  onPrevious,
  onNext,
  onThisWeek,
}: {
  from: string;
  current: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onThisWeek: () => void;
}) {
  const { t } = useTranslation();
  const previous = useRef<HTMLButtonElement>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <IconButton
        ref={previous}
        variant="outline"
        size="icon"
        label={t('tasks.workload.previousWeek')}
        onClick={onPrevious}
      >
        <ChevronRightIcon className="ltr:-scale-x-100" />
      </IconButton>
      <p className="min-w-52 text-center text-sm font-medium tabular-nums" aria-live="polite">
        {t('tasks.workload.week', {
          from: formatCalendarDate(from),
          to: formatCalendarDate(addDays(from, 6)),
        })}
      </p>
      <IconButton variant="outline" size="icon" label={t('tasks.workload.nextWeek')} onClick={onNext}>
        <ChevronLeftIcon className="ltr:-scale-x-100" />
      </IconButton>
      {!current && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onThisWeek();
            // The button leaves with the change: the focus stays in the week picker.
            previous.current?.focus();
          }}
        >
          {t('tasks.workload.thisWeek')}
        </Button>
      )}
    </div>
  );
}

function DepartmentFilter({
  value,
  onChange,
}: {
  value: DepartmentCode[];
  onChange: (department: DepartmentCode[] | undefined) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const departments = useQuery(departmentListQuery);
  const options = (departments.data?.items ?? []).map(({ code, name }) => ({ code, name }));
  return (
    <Field className="flex-1">
      <FieldLabel htmlFor={id} className="sr-only">
        {t('tasks.filters.department')}
      </FieldLabel>
      <MultiCombobox
        id={id}
        items={options}
        value={value.flatMap((code) => options.find((option) => option.code === code) ?? [])}
        onValueChange={(next) =>
          onChange(next.length > 0 ? next.map(({ code }) => code) : undefined)
        }
        itemToLabel={(item) => item.name}
        itemToKey={(item) => item.code}
        placeholder={t('tasks.board.defaultDepartments')}
        emptyLabel={t('common.noMatches')}
        removeLabel={(label) => t('common.remove', { label })}
      />
    </Field>
  );
}

/** Open requests nobody holds yet, per department: the managers' queue. */
function UnassignedTiles({ workload }: { workload: TaskWorkload }) {
  const { t } = useTranslation();
  const departmentName = useDepartmentNames();
  const headingId = useId();
  if (workload.unassigned.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-sm font-medium text-muted-foreground">
        {t('tasks.workload.unassigned')}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {workload.unassigned.map(({ department, count }) => {
          const content = (
            <>
              <InboxIcon aria-hidden="true" className="size-4 text-muted-foreground" />
              {departmentName(department)}
              <span className="font-bold tabular-nums">{formatNumber(count)}</span>
            </>
          );
          const chip =
            'flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm';
          return (
            <li key={department}>
              {count > 0 ? (
                <Link
                  to="/tasks/list"
                  search={{ assignee: 'unassigned', department: [department] }}
                  className={cn(chip, 'transition-colors duration-150 ease-out hover:bg-muted/50')}
                >
                  {content}
                </Link>
              ) : (
                <span className={cn(chip, 'text-muted-foreground')}>{content}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PeopleTable({ workload }: { workload: TaskWorkload }) {
  const { t } = useTranslation();
  const departmentName = useDepartmentNames();
  const most = Math.max(1, ...workload.people.map((person) => person.open));
  const { from, to } = workload.week;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('tasks.workload.person')}</TableHead>
            <TableHead className="text-end">{t('tasks.workload.overdue')}</TableHead>
            <TableHead className="text-end">{t('tasks.workload.dueThisWeek')}</TableHead>
            <TableHead className="text-end">{t('tasks.workload.open')}</TableHead>
            <TableHead className="w-1/4">
              <span className="sr-only">{t('tasks.workload.load')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {workload.people.map(({ user, departments, overdue, dueThisWeek, open }) => (
            <TableRow key={user.id}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <Avatar name={user.name} size="sm" />
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium">{user.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {departments.map(departmentName).join(' · ')}
                    </span>
                  </div>
                </div>
              </TableCell>
              <CountCell
                count={overdue}
                alert
                search={{ assignee: user.id, overdue: true }}
                label={t('tasks.workload.overdueOf', { name: user.name })}
              />
              <CountCell
                count={dueThisWeek}
                search={{ assignee: user.id, dueFrom: from, dueTo: to }}
                label={t('tasks.workload.dueThisWeekOf', { name: user.name })}
              />
              <CountCell
                count={open}
                search={{ assignee: user.id }}
                label={t('tasks.workload.openOf', { name: user.name })}
              />
              <TableCell>
                <Meter
                  value={open}
                  max={most}
                  tone={overdue > 0 ? 'danger' : 'brand'}
                  aria-label={t('tasks.workload.openOf', { name: user.name })}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** A count that opens its tasks in the list; zero is plain text. */
function CountCell({
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
