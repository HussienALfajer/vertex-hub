import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ATTENDANCE_DAY_STATUSES,
  ATTENDANCE_MONTH_LIMITS,
  type AttendanceMonth,
  addDays,
  businessDate,
  type MonthSheetRow as ContractRow,
  LEAVE_TYPES,
  type LeaveType,
  type MeResponse,
  type MonthPending,
  type MonthSheetDay,
  monthEnded,
  reopenMonthSchema,
} from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Callout,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldError,
  FieldLabel,
  IconButton,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import type { TFunction } from 'i18next';
import { CalendarRangeIcon, ChevronLeftIcon, ChevronRightIcon, LockIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { LoadError } from '../../components/load-error';
import { ApiError } from '../../lib/api/client';
import { can, useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import {
  formatCalendarDate,
  formatDateTime,
  formatMonth,
  formatNumber,
  formatWeekday,
  formatWeekdayDate,
} from '../../lib/format';
import { ALL, idParam } from '../../lib/search-params';
import { departmentListQuery } from '../departments/departments.queries';
import { departmentLabel } from '../departments/pickable-departments';
import { ChoiceSelect } from '../quotes/choice-select';
import { FormDialog } from '../quotes/quote-dialogs';
import { ExportButton } from '../reports/report-parts';
import { dayTone, durationText } from './attendance-parts';
import { monthExportUrls, monthSheetQuery, useCloseMonth, useReopenMonth } from './hr.queries';

/** A sheet row as the API client types it: the leave days by type come as a plain record. */
type MonthSheetRow = Omit<ContractRow, 'totals'> & {
  totals: Omit<ContractRow['totals'], 'leaveDays'> & {
    leaveDays: Partial<Record<LeaveType, number>>;
  };
};

/** Rule D1: the sheet is for `hr.read` holders in scope and for Finance (`salaries.read`). */
export const readsMonths = (me: MeResponse) => can(me, 'hr.read') || can(me, 'salaries.read');

export interface HrMonthSearch {
  departmentId?: string;
}

export function parseHrMonthSearch(search: Record<string, unknown>): HrMonthSearch {
  return { departmentId: idParam(search.departmentId) };
}

/** `YYYY-MM` of the month before or after. */
const shiftMonth = (month: string, by: -1 | 1) =>
  addDays(`${month}-01`, by === -1 ? -1 : 40).slice(0, 7);

/**
 * Month `/hr/months/:month` (spec F17 part D): every employee's days and totals, the pending
 * requests and items that hold the month, Close (rule D2, `hr.approve`) once it has ended and
 * nothing is pending, Reopen with a reason (rule D4), and the Excel file (rule D5). A closed
 * month shows its frozen summaries.
 */
export function HrMonthPage({ month, search }: { month: string; search: HrMonthSearch }) {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate({ from: '/hr/months/$month' });
  const departments = useQuery(departmentListQuery);
  const filters = { departmentId: search.departmentId };
  const sheet = useQuery(monthSheetQuery(month, filters));
  const approves = can(me, 'hr.approve');
  const first = `${month}-01`;

  const goTo = (next: string) =>
    navigate({ to: '/hr/months/$month', params: { month: next }, search });
  const departmentItems = [
    { value: ALL, label: t('users.allDepartments') },
    ...(departments.data?.items ?? [])
      .filter((d) => !d.archivedAt || d.id === search.departmentId)
      .map((d) => ({ value: d.id, label: departmentLabel(t, d) })),
  ];

  return (
    <>
      <PageHeader
        title={t('hr.months.title', { month: formatMonth(first) })}
        description={sheet.data ? <MonthState month={sheet.data.month} /> : t('hr.months.subtitle')}
        actions={
          <>
            <ExportButton href={monthExportUrls.sheet(month, filters)} disabled={!sheet.data} />
            {approves && sheet.data && <MonthAction month={sheet.data.month} />}
          </>
        }
      />
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 md:flex-row md:items-center">
        <div className="flex items-center gap-2">
          <IconButton
            variant="outline"
            size="icon"
            label={t('hr.attendance.month.previous')}
            onClick={() => goTo(shiftMonth(month, -1))}
          >
            <ChevronRightIcon className="ltr:-scale-x-100" />
          </IconButton>
          <IconButton
            variant="outline"
            size="icon"
            label={t('hr.attendance.month.next')}
            onClick={() => goTo(shiftMonth(month, 1))}
          >
            <ChevronLeftIcon className="ltr:-scale-x-100" />
          </IconButton>
          <Button variant="outline" onClick={() => goTo(businessDate().slice(0, 7))}>
            {t('hr.attendance.month.current')}
          </Button>
        </div>
        <ChoiceSelect
          label={t('users.department')}
          items={departmentItems}
          value={search.departmentId ?? ALL}
          onChange={(value) =>
            navigate({
              search: { departmentId: value === ALL ? undefined : value },
              replace: true,
            })
          }
          className="md:ms-auto md:w-48"
        />
      </div>

      {sheet.isPending ? (
        <Skeleton className="h-96" />
      ) : sheet.isError ? (
        <LoadError message={t('hr.months.loadError')} onRetry={() => sheet.refetch()} />
      ) : sheet.data.rows.length === 0 ? (
        <EmptyState
          icon={<CalendarRangeIcon />}
          title={t('hr.months.emptyTitle')}
          description={t('hr.months.emptyHint')}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <PendingCallout rows={sheet.data.rows} status={sheet.data.month.status} />
          <TotalsTable
            rows={sheet.data.rows}
            month={month}
            closed={sheet.data.month.status === 'closed'}
          />
          <DaysTable
            rows={sheet.data.rows}
            from={sheet.data.from}
            to={sheet.data.to}
            month={month}
          />
        </div>
      )}
    </>
  );
}

/** Open, or closed by whom and when; the last reopening and its reason (rule D4). */
function MonthState({ month }: { month: AttendanceMonth }) {
  const { t } = useTranslation();
  return (
    <span className="flex flex-wrap items-center gap-2" data-month-status={month.status}>
      <Badge tone={month.status === 'closed' ? 'neutral' : 'success'}>
        {t(`hr.months.statuses.${month.status}`)}
      </Badge>
      {month.status === 'closed' && month.closedBy && month.closedAt && (
        <span>
          {t('hr.months.closedBy', {
            name: month.closedBy.name,
            date: formatDateTime(month.closedAt),
          })}
        </span>
      )}
      {month.reopenedBy && month.reopenedAt && (
        <span>
          {t('hr.months.reopenedBy', {
            name: month.reopenedBy.name,
            date: formatDateTime(month.reopenedAt),
            reason: month.reopenReason ?? '',
          })}
        </span>
      )}
    </span>
  );
}

/** Close an ended open month, or reopen a closed one. */
function MonthAction({ month }: { month: AttendanceMonth }) {
  const { t } = useTranslation();
  const close = useCloseMonth();
  const reopen = useReopenMonth();
  const [closing, setClosing] = useState(false);
  const [pending, setPending] = useState<MonthPending[] | null>(null);
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const reasonField = useRef<HTMLTextAreaElement>(null);
  const label = formatMonth(`${month.month}-01`);

  if (month.status === 'open') {
    const ended = monthEnded(month.month, businessDate());
    return (
      <>
        <Button ref={opener} disabled={!ended} onClick={() => setClosing(true)}>
          <LockIcon />
          {t('hr.months.close')}
        </Button>
        {!ended && <span className="text-sm text-muted-foreground">{t('hr.months.notEnded')}</span>}
        <ConfirmDialog
          open={closing}
          onClose={() => setClosing(false)}
          title={t('hr.months.closeTitle', { month: label })}
          body={t('hr.months.closeBody')}
          action={t('hr.months.close')}
          pending={close.isPending}
          onConfirm={async () => {
            try {
              await close.mutateAsync(month.month);
              toast.add({ title: t('hr.months.closed', { month: label }), type: 'success' });
            } catch (error) {
              // Rule D2: what holds the month opens as a list, each to decide.
              if (error instanceof ApiError && error.knownCode === 'MONTH_HAS_PENDING') {
                const details = error.details as { pending?: MonthPending[] } | undefined;
                setPending(details?.pending ?? []);
                return;
              }
              throw error;
            }
          }}
          describeFailure={(error) => errorMessage(t, error)}
          finalFocus={() => opener.current ?? true}
        />
        <PendingDialog
          pending={pending}
          onClose={() => setPending(null)}
          finalFocus={() => opener.current ?? true}
        />
      </>
    );
  }

  return (
    <>
      <Button ref={opener} variant="outline" onClick={() => setReopening(true)}>
        {t('hr.months.reopen')}
      </Button>
      <FormDialog
        open={reopening}
        onClose={() => setReopening(false)}
        onClosed={() => {
          setReason('');
          setMissing(false);
          setFailure(null);
        }}
        finalFocus={() => opener.current ?? true}
        submitting={reopen.isPending}
        title={t('hr.months.reopenTitle', { month: label })}
        description={t('hr.months.reopenHint')}
        action={t('hr.months.reopen')}
        failure={failure}
        onSubmit={async (event) => {
          event?.preventDefault();
          setFailure(null);
          const parsed = reopenMonthSchema.safeParse({ reason });
          if (!parsed.success) {
            setMissing(true);
            reasonField.current?.focus();
            return;
          }
          try {
            await reopen.mutateAsync({ month: month.month, ...parsed.data });
            toast.add({ title: t('hr.months.reopened', { month: label }), type: 'success' });
            setReopening(false);
          } catch (error) {
            setFailure(errorMessage(t, error));
          }
        }}
      >
        <Field invalid={missing}>
          <FieldLabel>{t('hr.months.reopenReason')}</FieldLabel>
          <Textarea
            ref={reasonField}
            rows={3}
            maxLength={ATTENDANCE_MONTH_LIMITS.reopenReason}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setMissing(false);
            }}
          />
          <FieldError match={missing}>{t('hr.months.reopenReasonRequired')}</FieldError>
        </Field>
      </FormDialog>
    </>
  );
}

/** Rule D2: the requests and items still to decide, each linking to its page. */
function PendingDialog({
  pending,
  onClose,
  finalFocus,
}: {
  pending: MonthPending[] | null;
  onClose: () => void;
  finalFocus: () => HTMLElement | boolean;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={pending !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')} className="p-0" finalFocus={finalFocus}>
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>{t('hr.months.pendingTitle')}</DialogTitle>
          <DialogDescription>{t('errors.MONTH_HAS_PENDING')}</DialogDescription>
        </DialogHeader>
        <ul
          className="flex max-h-96 flex-col gap-2 overflow-y-auto px-6 pb-6"
          data-testid="month-pending"
        >
          {(pending ?? []).map((entry) => (
            <li
              key={`${entry.kind}-${entry.id}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border p-2"
            >
              <span className="font-medium">{entry.user.name}</span>
              <span className="text-sm text-muted-foreground">
                {t(`hr.months.pendingKinds.${entry.kind}`)} · {formatCalendarDate(entry.date)}
              </span>
              {entry.kind === 'request' ? (
                <Link
                  to="/hr/requests/$requestId"
                  params={{ requestId: entry.id }}
                  className="ms-auto text-sm font-medium hover:underline"
                >
                  {t('hr.months.openPending')}
                </Link>
              ) : (
                <Link
                  to="/hr/items/$itemId"
                  params={{ itemId: entry.id }}
                  className="ms-auto text-sm font-medium hover:underline"
                >
                  {t('hr.months.openPending')}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

/** The month's pending counts, with the way to Approvals while it is open. */
function PendingCallout({
  rows,
  status,
}: {
  rows: readonly MonthSheetRow[];
  status: AttendanceMonth['status'];
}) {
  const { t } = useTranslation();
  const requests = rows.reduce((sum, row) => sum + row.pendingRequests, 0);
  const items = rows.reduce((sum, row) => sum + row.pendingItems, 0);
  if (status === 'closed' || requests + items === 0) return null;
  return (
    <Callout
      tone="warning"
      title={t('hr.months.pendingCounts', {
        requests: formatNumber(requests),
        items: formatNumber(items),
      })}
      description={t('hr.months.pendingHint')}
      action={
        <Button variant="outline" size="sm" render={<Link to="/hr/approvals" />}>
          {t('hr.months.toApprovals')}
        </Button>
      }
      data-testid="month-pending-counts"
    />
  );
}

/** Leave days by type, the non-zero ones ("سنوية 2 · مرضية 1"). */
function leaveText(t: TFunction, leaveDays: MonthSheetRow['totals']['leaveDays']): string {
  const parts = LEAVE_TYPES.filter((type) => (leaveDays[type] ?? 0) > 0).map((type) =>
    t('hr.months.leaveOf', {
      type: t(`hr.leaveTypes.${type}`),
      days: formatNumber(leaveDays[type] ?? 0),
    }),
  );
  return parts.length > 0 ? parts.join(' · ') : formatNumber(0);
}

/** A duration, or a plain 0 where there is none. */
const minutesText = (t: TFunction, minutes: number) =>
  minutes > 0 ? durationText(t, minutes) : formatNumber(0);

const TOTAL_COLUMNS = [
  'workDays',
  'presentDays',
  'remoteDays',
  'fieldDays',
  'absentDays',
  'leave',
  'unpaidLeaveDays',
  'holidayDays',
  'lateCount',
  'deductedDays',
  'overtimePaid',
  'overtimeTimeOff',
  'worked',
  'pending',
] as const;

/** Rule D3: one row per employee, as F19 reads it (frozen once the month is closed). */
function TotalsTable({
  rows,
  month,
  closed,
}: {
  rows: readonly MonthSheetRow[];
  month: string;
  closed: boolean;
}) {
  const { t } = useTranslation();
  const cell = (row: MonthSheetRow, column: (typeof TOTAL_COLUMNS)[number]) => {
    const totals = row.totals;
    switch (column) {
      case 'leave':
        return leaveText(t, totals.leaveDays);
      case 'overtimePaid':
        return minutesText(t, totals.overtimePaidMinutes);
      case 'overtimeTimeOff':
        return minutesText(t, totals.overtimeTimeOffMinutes);
      case 'worked':
        return minutesText(t, totals.workedMinutes);
      case 'pending':
        return t('hr.months.pendingCell', {
          requests: formatNumber(row.pendingRequests),
          items: formatNumber(row.pendingItems),
        });
      default:
        return formatNumber(totals[column]);
    }
  };
  return (
    <section className="flex flex-col gap-3" aria-labelledby="month-totals">
      <h2 id="month-totals" className="text-lg font-bold">
        {closed ? t('hr.months.totalsFrozen') : t('hr.months.totalsLive')}
      </h2>
      <Table data-testid="month-totals">
        <TableHeader>
          <TableRow>
            <TableHead className="sticky start-0 bg-muted">{t('hr.months.employee')}</TableHead>
            {TOTAL_COLUMNS.map((column) => (
              <TableHead key={column}>{t(`hr.months.columns.${column}`)}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.user.id} data-user={row.user.id}>
              <TableCell className="sticky start-0 bg-surface font-medium">
                <EmployeeLink row={row} month={month} />
              </TableCell>
              {TOTAL_COLUMNS.map((column) => (
                <TableCell key={column} className="whitespace-nowrap">
                  {cell(row, column)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

function EmployeeLink({ row, month }: { row: MonthSheetRow; month: string }) {
  return (
    <Link
      to="/hr/people/$userId"
      params={{ userId: row.user.id }}
      search={{ tab: 'attendance', month }}
      className="whitespace-nowrap hover:underline"
    >
      {row.user.name}
    </Link>
  );
}

/** The sheet's grid: employees × days, each cell the day's status in a letter (with a legend). */
function DaysTable({
  rows,
  from,
  to,
  month,
}: {
  rows: readonly MonthSheetRow[];
  from: string;
  to: string;
  month: string;
}) {
  const { t } = useTranslation();
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return (
    <section className="flex flex-col gap-3" aria-labelledby="month-days">
      <h2 id="month-days" className="text-lg font-bold">
        {t('hr.months.days')}
      </h2>
      <Table data-testid="month-days">
        <TableHeader>
          <TableRow>
            <TableHead className="sticky start-0 bg-muted">{t('hr.months.employee')}</TableHead>
            {dates.map((date) => (
              <TableHead key={date} className="px-1 text-center">
                <span className="flex flex-col items-center leading-tight">
                  <span className="text-xs font-normal text-muted-foreground">
                    {formatWeekday(date, 'short')}
                  </span>
                  {formatNumber(Number(date.slice(8)))}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const byDate = new Map(row.days.map((day) => [day.date, day]));
            return (
              <TableRow key={row.user.id}>
                <TableCell className="sticky start-0 bg-surface font-medium">
                  <EmployeeLink row={row} month={month} />
                </TableCell>
                {dates.map((date) => (
                  <TableCell key={date} className="px-1 text-center">
                    <DayCell day={byDate.get(date)} date={date} />
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label={t('hr.months.legend')}>
        {ATTENDANCE_DAY_STATUSES.map((status) => (
          <li key={status} className="flex items-center gap-1">
            <Badge tone={dayTone[status]} aria-hidden="true">
              {t(`hr.months.codes.${status}`)}
            </Badge>
            {t(`hr.attendance.dayStatuses.${status}`)}
          </li>
        ))}
        <li className="flex items-center gap-1">
          <span aria-hidden="true" className="size-2 rounded-full bg-status-warning-foreground" />
          {t('hr.months.pendingMark')}
        </li>
      </ul>
    </section>
  );
}

function DayCell({ day, date }: { day: MonthSheetDay | undefined; date: string }) {
  const { t } = useTranslation();
  if (!day) return <span className="text-muted-foreground">·</span>;
  const details = [
    t(`hr.attendance.dayStatuses.${day.status}`),
    day.place === 'remote' && t('hr.attendance.remoteDay'),
    day.field && t('hr.months.fieldDay'),
    day.lateMinutes > 0 &&
      t('hr.attendance.figures.late', { duration: durationText(t, day.lateMinutes) }),
    day.workedMinutes > 0 &&
      t('hr.attendance.figures.worked', { duration: durationText(t, day.workedMinutes) }),
    day.pendingItems > 0 && t('hr.months.pendingMark'),
  ].filter(Boolean);
  return (
    <span className="relative inline-flex" data-day={date} data-status={day.status}>
      <Badge tone={dayTone[day.status]} className="min-w-6 justify-center px-1">
        <span aria-hidden="true">{t(`hr.months.codes.${day.status}`)}</span>
        <span className="sr-only">
          {formatWeekdayDate(date)}: {details.join('، ')}
        </span>
      </Badge>
      {day.pendingItems > 0 && (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -end-0.5 size-2 rounded-full bg-status-warning-foreground"
        />
      )}
    </span>
  );
}
