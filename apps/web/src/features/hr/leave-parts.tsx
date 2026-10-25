import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  businessDate,
  type HrRequest,
  type HrRequestStatus,
  type LeaveTypeBalance,
  type LedgerRow,
} from '@vertex-hub/contracts';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-hub/ui';
import { ChevronDownIcon, PaperclipIcon, PlusIcon, ScaleIcon } from 'lucide-react';
import { type ReactNode, type Ref, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import {
  formatCalendarDate,
  formatDate,
  formatNumber,
  formatPeriod,
  formatTimeOfDay,
} from '../../lib/format';
import { imageSrc } from '../../lib/images';
import { ChoiceSelect } from '../quotes/choice-select';
import { leaveBalanceQuery } from './hr.queries';
import { AdjustmentDialog } from './leave-dialogs';

const statusTone = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
} as const satisfies Record<HrRequestStatus, string>;

export function RequestStatusBadge({ status }: { status: HrRequestStatus }) {
  const { t } = useTranslation();
  return (
    <Badge tone={statusTone[status]} data-status={status}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {t(`hr.requests.statuses.${status}`)}
    </Badge>
  );
}

/** "Annual leave", "Sick leave", or the kind: "Permission to leave", "Remote work"… */
export function useRequestTitle() {
  const { t } = useTranslation();
  return (request: Pick<HrRequest, 'kind' | 'leaveType'>) =>
    request.kind === 'leave'
      ? t(`hr.leaveTypes.${request.leaveType ?? 'annual'}`)
      : t(`hr.requests.kinds.${request.kind}`);
}

/**
 * When a request is: its days (a half day named), a permission's day and window, or a
 * correction's day, direction and time (rule C19).
 */
export function useRequestWhen() {
  const { t } = useTranslation();
  return (
    request: Pick<
      HrRequest,
      'kind' | 'startsOn' | 'endsOn' | 'half' | 'fromTime' | 'toTime' | 'correctionDirection'
    >,
  ) => {
    if (request.kind === 'correction') {
      return t('hr.requests.correctionWhen', {
        date: formatCalendarDate(request.startsOn),
        direction: t(`hr.attendance.directions.${request.correctionDirection ?? 'in'}`),
        time: formatTimeOfDay(request.fromTime ?? ''),
      });
    }
    if (request.kind === 'permission') {
      return t('hr.requests.permissionWhen', {
        date: formatCalendarDate(request.startsOn),
        from: formatTimeOfDay(request.fromTime ?? ''),
        to: formatTimeOfDay(request.toTime ?? ''),
      });
    }
    if (request.startsOn === request.endsOn) {
      const day = formatCalendarDate(request.startsOn);
      return request.half ? `${day} · ${t(`hr.requests.halves.${request.half}`)}` : day;
    }
    return formatPeriod(request.startsOn, request.endsOn);
  };
}

/** "3 days", with the unpaid part when there is one (rule B12). */
export function useRequestDays() {
  const { t } = useTranslation();
  return (request: Pick<HrRequest, 'days' | 'unpaidDays' | 'leaveType'>) => {
    if (request.days === null) return null;
    const days = t('hr.requests.days', {
      count: request.days,
      days: formatNumber(request.days),
    });
    return request.unpaidDays && request.leaveType !== 'unpaid'
      ? t('hr.requests.daysWithUnpaid', { days, unpaid: formatNumber(request.unpaidDays) })
      : days;
  };
}

/**
 * Requests as rows, each opening its page: what, when, how many days, its state. `showUser` names
 * the employee (Approvals); `from` is where the request page's back link returns.
 */
export function RequestRows({
  requests,
  showUser,
  from,
}: {
  requests: HrRequest[];
  showUser?: boolean;
  from: 'mine' | 'approvals' | 'file';
}) {
  const { t } = useTranslation();
  const title = useRequestTitle();
  const when = useRequestWhen();
  const days = useRequestDays();
  return (
    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
      {requests.map((request) => (
        <li
          key={request.id}
          data-request-id={request.id}
          className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {showUser && (
              <Avatar
                name={request.user.name}
                src={imageSrc(request.user.imageId, 'sm')}
                size="sm"
              />
            )}
            <div className="flex min-w-0 flex-col gap-0.5">
              <Link
                to="/hr/requests/$requestId"
                params={{ requestId: request.id }}
                search={{ from }}
                className="w-fit max-w-full truncate font-medium hover:underline"
              >
                {showUser ? `${request.user.name} · ${title(request)}` : title(request)}
              </Link>
              <span className="text-sm text-muted-foreground">
                {[when(request), days(request)].filter(Boolean).join(' · ')}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {request.shortNotice && <Badge tone="gold">{t('hr.requests.shortNotice')}</Badge>}
            {request.certificateRequired && request.documents === 0 && (
              <Badge tone="outline">
                <PaperclipIcon aria-hidden="true" />
                {t('hr.requests.certificateMissing')}
              </Badge>
            )}
            <RequestStatusBadge status={request.status} />
            <span className="text-xs text-muted-foreground">
              {t('hr.requests.submitted', { date: formatDate(request.createdAt) })}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function RequestRowsSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      {['a', 'b', 'c'].map((row) => (
        <div key={row} className="flex items-center gap-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="ms-auto h-6 w-20" />
        </div>
      ))}
    </div>
  );
}

/**
 * The leave balances of a year (spec screen "Balances"): annual, sick and emergency with their
 * parts, and the ledger on demand. `canAdjust` (`hr.approve`) records an opening balance or an
 * adjustment (rules B6 and B7).
 */
export function LeaveBalances({
  userId,
  canAdjust,
  action,
}: {
  userId: string;
  canAdjust?: boolean;
  /** Next to the year: "New request" or "Record leave". */
  action?: ReactNode;
}) {
  const { t } = useTranslation();
  const thisYear = Number(businessDate().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [adjusting, setAdjusting] = useState(false);
  const adjustButton = useRef<HTMLButtonElement>(null);
  const balance = useQuery(leaveBalanceQuery(userId, year));
  const years = [thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((value) => ({
    value: String(value),
    label: formatNumber(value, { useGrouping: false }),
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ChoiceSelect
          label={t('hr.balances.year')}
          items={years}
          value={String(year)}
          onChange={(value) => setYear(Number(value))}
          className="w-32"
        />
        <div className="flex flex-wrap items-center gap-2">
          {canAdjust && (
            <Button ref={adjustButton} variant="outline" onClick={() => setAdjusting(true)}>
              <ScaleIcon />
              {t('hr.balances.adjust')}
            </Button>
          )}
          {action}
        </div>
      </div>
      {balance.isPending ? (
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
      ) : balance.isError ? (
        <LoadError message={t('hr.balances.loadError')} onRetry={() => balance.refetch()} />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            {balance.data.balances.map((item) => (
              <BalanceCard key={item.leaveType} balance={item} />
            ))}
          </div>
          <Ledger rows={balance.data.ledger} />
        </>
      )}
      {canAdjust && (
        <AdjustmentDialog
          userId={userId}
          year={year}
          open={adjusting}
          onClose={() => setAdjusting(false)}
          finalFocus={() => adjustButton.current ?? true}
        />
      )}
    </div>
  );
}

type BalancePart =
  | 'opening'
  | 'accrued'
  | 'granted'
  | 'carriedOver'
  | 'taken'
  | 'pending'
  | 'adjusted'
  | 'expired';

function BalanceCard({ balance }: { balance: LeaveTypeBalance }) {
  const { t } = useTranslation();
  const days = (value: number) => formatNumber(value);
  // Each type lists the parts it can have: sick and emergency are granted, never carried.
  const parts: { key: BalancePart; value: number }[] =
    balance.leaveType === 'annual'
      ? [
          { key: 'opening', value: balance.opening },
          { key: 'accrued', value: balance.accrued },
          { key: 'carriedOver', value: balance.carriedOver },
          { key: 'taken', value: balance.taken },
          { key: 'pending', value: balance.pending },
          { key: 'adjusted', value: balance.adjusted },
          { key: 'expired', value: balance.expired },
        ]
      : [
          { key: 'granted', value: balance.accrued },
          { key: 'taken', value: balance.taken },
          { key: 'pending', value: balance.pending },
          { key: 'adjusted', value: balance.adjusted },
        ];
  return (
    <Card data-leave-type={balance.leaveType}>
      <CardHeader>
        <CardTitle className="text-lg">{t(`hr.leaveTypes.${balance.leaveType}`)}</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-1">
        <span className="text-3xl font-bold tabular-nums">{days(balance.available)}</span>
        <span className="text-sm text-muted-foreground">
          {t('hr.balances.available', { count: balance.available })}
        </span>
      </div>
      <dl className="mt-4 flex flex-col gap-2 text-sm">
        {parts
          .filter((part) => part.key !== 'adjusted' || part.value !== 0)
          .map((part) => (
            <div key={part.key} className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{t(`hr.balances.parts.${part.key}`)}</dt>
              <dd className="tabular-nums">{days(part.value)}</dd>
            </div>
          ))}
      </dl>
    </Card>
  );
}

/** The year's ledger rows, newest first, folded until asked for. */
function Ledger({ rows }: { rows: LedgerRow[] }) {
  const { t } = useTranslation();
  return (
    <Collapsible className="rounded-lg border border-border bg-surface">
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 px-4 py-3 text-start font-medium">
        {t('hr.balances.ledger', { count: rows.length, rows: formatNumber(rows.length) })}
        <ChevronDownIcon
          aria-hidden="true"
          className="size-4 text-muted-foreground transition-transform group-data-panel-open:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        {rows.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground">{t('hr.balances.noLedger')}</p>
        ) : (
          <div className="border-t border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('hr.balances.columns.date')}</TableHead>
                  <TableHead>{t('hr.balances.columns.type')}</TableHead>
                  <TableHead>{t('hr.balances.columns.entry')}</TableHead>
                  <TableHead>{t('hr.balances.columns.days')}</TableHead>
                  <TableHead>{t('hr.balances.columns.note')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} data-entry={row.entry}>
                    <TableCell>{formatDate(row.createdAt)}</TableCell>
                    <TableCell>{t(`hr.leaveTypes.${row.leaveType}`)}</TableCell>
                    <TableCell>{t(`hr.balances.entries.${row.entry}`)}</TableCell>
                    <TableCell>
                      <span dir="ltr" className="tabular-nums">
                        {row.days > 0 ? `+${formatNumber(row.days)}` : formatNumber(row.days)}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-normal text-muted-foreground">
                      {[row.note, row.createdBy?.name ?? t('hr.balances.byJob')]
                        .filter(Boolean)
                        .join(' · ')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CollapsiblePanel>
    </Collapsible>
  );
}

/** The "New request" button, for the dialog it opens. */
export function NewRequestButton({
  onClick,
  buttonRef,
  label,
}: {
  onClick: () => void;
  buttonRef: Ref<HTMLButtonElement>;
  label: string;
}) {
  return (
    <Button ref={buttonRef} onClick={onClick}>
      <PlusIcon />
      {label}
    </Button>
  );
}
