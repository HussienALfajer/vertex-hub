import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ATTENDANCE_ITEM_LIMITS,
  type AttendanceDay,
  type AttendancePunch,
  businessDate,
  type TodayBoardRow,
} from '@vertex-hub/contracts';
import {
  Button,
  EmptyState,
  Field,
  FieldError,
  FieldLabel,
  PageHeader,
  Skeleton,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import { ShieldAlertIcon, UsersIcon } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { can, useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { formatNumber, formatTime, formatWeekdayDate } from '../../lib/format';
import { ALL, idParam } from '../../lib/search-params';
import { departmentListQuery } from '../departments/departments.queries';
import { ChoiceSelect } from '../quotes/choice-select';
import { FormDialog } from '../quotes/quote-dialogs';
import { PunchTimeline } from './attendance-parts';
import { todayBoardQuery, useRejectPunch } from './hr.queries';

export interface HrTodaySearch {
  departmentId?: string;
}

export function parseHrTodaySearch(search: Record<string, unknown>): HrTodaySearch {
  return { departmentId: idParam(search.departmentId) };
}

/** The board's groups (spec screen "Today"); a person may be in several (in and late). */
const GROUPS = [
  ['in', (row: TodayBoardRow) => row.state === 'in'],
  ['late', (row: TodayBoardRow) => row.late],
  ['not_in', (row: TodayBoardRow) => row.state === 'not_in'],
  ['out', (row: TodayBoardRow) => row.state === 'out'],
  ['on_leave', (row: TodayBoardRow) => row.state === 'on_leave'],
  ['remote', (row: TodayBoardRow) => row.method === 'remote'],
  ['field', (row: TodayBoardRow) => row.method === 'field'],
  ['shoot', (row: TodayBoardRow) => row.method === 'shoot'],
  ['exempt', (row: TodayBoardRow) => row.state === 'exempt'],
  ['no_passkey', (row: TodayBoardRow) => row.noPasskey && row.state !== 'exempt'],
] as const;

/** A punch the GM may reject: a live field or shoot punch (rule C12). */
const rejectable = (punch: AttendancePunch) =>
  !punch.archivedAt && (punch.method === 'field' || punch.method === 'shoot');

/**
 * Today `/hr/today` (spec F17, `hr.read`): counts and lists of who is in, late, not yet in, on
 * leave, remote, in the field or on a shoot, exempt or without a passkey, each person's punches
 * with their points as maps links, and the office punches refused today (rule C6). `hr.approve`
 * rejects a field or shoot punch (rule C12).
 */
export function HrTodayPage({ search }: { search: HrTodaySearch }) {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate({ from: '/hr/today' });
  const departments = useQuery(departmentListQuery);
  const board = useQuery(todayBoardQuery({ departmentId: search.departmentId }));
  const [rejecting, setRejecting] = useState<AttendancePunch | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const approves = can(me, 'hr.approve');

  const departmentItems = [
    { value: ALL, label: t('users.allDepartments') },
    ...(departments.data?.items ?? []).map((d) => ({ value: d.id, label: d.name })),
  ];
  const rows = board.data?.rows ?? [];
  const groups = GROUPS.map(([key, match]) => ({ key, rows: rows.filter(match) }));

  return (
    <>
      <PageHeader
        title={t('hr.today.title')}
        description={board.data ? formatWeekdayDate(board.data.date) : t('hr.today.subtitle')}
        actions={
          <Button
            variant="outline"
            render={
              <Link
                to="/hr/months/$month"
                params={{ month: (board.data?.date ?? businessDate()).slice(0, 7) }}
                search={{ departmentId: search.departmentId }}
              />
            }
          >
            {t('hr.months.sheet')}
          </Button>
        }
      />
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 md:flex-row md:items-center">
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
          className="md:w-48"
        />
      </div>
      {board.isPending ? (
        <Skeleton className="h-96" />
      ) : board.isError ? (
        <LoadError message={t('hr.today.loadError')} onRetry={() => board.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<UsersIcon />}
          title={t('hr.today.emptyTitle')}
          description={t('hr.today.emptyHint')}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {groups.map(({ key, rows: members }) => (
              <li
                key={key}
                className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3"
                data-count={key}
              >
                <span className="text-sm text-muted-foreground">{t(`hr.today.groups.${key}`)}</span>
                <span className="text-2xl font-bold tabular-nums">
                  {formatNumber(members.length)}
                </span>
              </li>
            ))}
          </ul>
          {groups
            .filter(({ rows: members }) => members.length > 0)
            .map(({ key, rows: members }) => (
              <section key={key} className="flex flex-col gap-3" aria-labelledby={`today-${key}`}>
                <h2 id={`today-${key}`} className="text-lg font-bold">
                  {t(`hr.today.groups.${key}`)}
                </h2>
                <ul className="flex flex-col gap-2">
                  {members.map((row) => (
                    <BoardRow
                      key={row.user.id}
                      row={row}
                      action={
                        approves
                          ? (punch) =>
                              rejectable(punch) && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(event) => {
                                    opener.current = event.currentTarget;
                                    setRejecting(punch);
                                  }}
                                >
                                  {t('hr.today.reject')}
                                </Button>
                              )
                          : undefined
                      }
                    />
                  ))}
                </ul>
              </section>
            ))}
          <section className="flex flex-col gap-3" aria-labelledby="today-refusals">
            <h2 id="today-refusals" className="text-lg font-bold">
              {t('hr.today.refusals')}
            </h2>
            {board.data.refusals.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('hr.today.noRefusals')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {board.data.refusals.map((refusal) => (
                  <li
                    key={`${refusal.user.id}-${refusal.at}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-surface p-3"
                  >
                    <ShieldAlertIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                    <span className="font-medium">{refusal.user.name}</span>
                    <span className="tabular-nums">{formatTime(refusal.at)}</span>
                    <span className="text-sm text-muted-foreground">
                      {t(`errors.${refusal.reason}`)}
                    </span>
                    {refusal.ipAddress && (
                      <span
                        dir="ltr"
                        className="ms-auto text-sm text-muted-foreground tabular-nums"
                      >
                        {refusal.ipAddress}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      <RejectPunchDialog
        punch={rejecting}
        onClose={() => setRejecting(null)}
        finalFocus={() => opener.current ?? true}
      />
    </>
  );
}

function BoardRow({
  row,
  action,
}: {
  row: TodayBoardRow;
  action?: (punch: AttendancePunch, day: AttendanceDay) => ReactNode;
}) {
  const { t } = useTranslation();
  const day = row.day;
  return (
    <li
      className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3"
      data-person={row.user.name}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{row.user.name}</span>
        {day?.firstInAt && (
          <span className="text-sm text-muted-foreground tabular-nums">
            {formatTime(day.firstInAt)}
            {day.lastOutAt && ` – ${formatTime(day.lastOutAt)}`}
          </span>
        )}
        {row.noPasskey && row.state !== 'exempt' && (
          <span className="text-sm text-muted-foreground">{t('hr.today.groups.no_passkey')}</span>
        )}
      </div>
      {day && day.punches.length > 0 && (
        <PunchTimeline punches={day.punches} action={action && ((punch) => action(punch, day))} />
      )}
    </li>
  );
}

/** Rule C12: a rejected field or shoot punch is archived, with a note to the employee. */
export function RejectPunchDialog({
  punch,
  onClose,
  finalFocus,
}: {
  punch: AttendancePunch | null;
  onClose: () => void;
  finalFocus: () => HTMLElement | boolean;
}) {
  const { t } = useTranslation();
  const reject = useRejectPunch();
  const [note, setNote] = useState('');
  const [missing, setMissing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  return (
    <FormDialog
      open={punch !== null}
      onClose={onClose}
      onClosed={() => {
        setNote('');
        setMissing(false);
        setFailure(null);
      }}
      finalFocus={finalFocus}
      submitting={reject.isPending}
      title={t('hr.today.rejectTitle')}
      description={t('hr.today.rejectHint')}
      action={t('hr.today.reject')}
      failure={failure}
      onSubmit={async (event) => {
        event?.preventDefault();
        if (!punch) return;
        setFailure(null);
        if (!note.trim()) {
          setMissing(true);
          field.current?.focus();
          return;
        }
        try {
          await reject.mutateAsync({ id: punch.id, note: note.trim() });
          toast.add({ title: t('hr.today.rejected'), type: 'success' });
          onClose();
        } catch (error) {
          setFailure(errorMessage(t, error));
        }
      }}
    >
      <Field invalid={missing}>
        <FieldLabel>{t('hr.today.rejectNote')}</FieldLabel>
        <Textarea
          ref={field}
          rows={3}
          maxLength={ATTENDANCE_ITEM_LIMITS.note}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            setMissing(false);
          }}
        />
        <FieldError match={missing}>{t('hr.today.rejectNoteRequired')}</FieldError>
      </Field>
    </FormDialog>
  );
}
