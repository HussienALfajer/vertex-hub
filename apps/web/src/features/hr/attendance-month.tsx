import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  ATTENDANCE_ITEM_LIMITS,
  type AttendanceDay,
  type AttendanceItem,
  addDays,
  businessDate,
  type CalendarDate,
  firstOfMonth,
  justifyItemSchema,
} from '@vertex-hub/contracts';
import {
  Button,
  CalendarDay,
  CalendarGrid,
  EmptyState,
  Field,
  FieldError,
  FieldLabel,
  IconButton,
  Skeleton,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import type { TFunction } from 'i18next';
import { CalendarClockIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { errorMessage } from '../../lib/errors';
import {
  formatCalendarDate,
  formatMonth,
  formatNumber,
  formatTime,
  formatWeekday,
  formatWeekdayDate,
} from '../../lib/format';
import { DayDialog } from '../content/calendar-toolbar';
import { calendarRange, daysBetween, sameMonth } from '../content/content-dates';
import { FormDialog } from '../quotes/quote-dialogs';
import { DayStatusBadge, durationText, ItemStatusBadge, PunchTimeline } from './attendance-parts';
import { attendanceDaysQuery, attendanceItemListQuery, useJustifyItem } from './hr.queries';

/** `YYYY-MM` of a date. */
export const monthOf = (date: CalendarDate) => date.slice(0, 7);

/** The fraction proposed or decided, as a share of a day ("¼ يوم"). */
export function fractionText(t: TFunction, fraction: number): string {
  const key = FRACTION_KEYS[fraction as keyof typeof FRACTION_KEYS];
  return key ? t(`hr.settings.fractions.${key}`) : formatNumber(fraction);
}

/** The fractions' translation keys: a key cannot hold the decimal point. */
const FRACTION_KEYS = {
  0.25: 'quarter',
  0.5: 'half',
  0.75: 'threeQuarters',
  1: 'full',
} as const;

/** What an item is about: its kind, and its minutes when it has some. */
export function itemSummary(t: TFunction, item: AttendanceItem): string {
  const kind = t(`hr.items.kinds.${item.kind}`);
  return item.minutes > 0
    ? t('hr.items.summary', { kind, duration: durationText(t, item.minutes) })
    : kind;
}

/**
 * A month of attendance (spec screen "My attendance", This month; the file's Attendance tab):
 * the days in a calendar coloured by status, each opening its punches, then the month's items.
 * `self`: the employee's own, who may justify a pending item (rule C17). `punchAction` adds a
 * button per punch (the GM's "Reject" on a field punch, rule C12).
 */
export function AttendanceMonth({
  userId,
  month,
  onMonthChange,
  self,
  punchAction,
}: {
  userId: string | 'me';
  month: string;
  onMonthChange: (month: string | undefined) => void;
  self: boolean;
  punchAction?: (punch: AttendanceDay['punches'][number], day: AttendanceDay) => ReactNode;
}) {
  const { t } = useTranslation();
  const today = businessDate();
  const first = `${month}-01`;
  const days = useQuery(attendanceDaysQuery(userId, month));
  const items = useQuery(attendanceItemListQuery({ userId, month, pageSize: 100, order: 'asc' }));
  const [openDay, setOpenDay] = useState<CalendarDate | null>(null);
  const range = calendarRange('month', first);
  const grid = daysBetween(range.from, range.to);
  const byDate = new Map((days.data?.items ?? []).map((day) => [day.date, day]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <IconButton
          variant="outline"
          size="icon"
          label={t('hr.attendance.month.previous')}
          onClick={() => onMonthChange(monthOf(addDays(first, -1)))}
        >
          <ChevronRightIcon className="ltr:-scale-x-100" />
        </IconButton>
        <IconButton
          variant="outline"
          size="icon"
          label={t('hr.attendance.month.next')}
          onClick={() => onMonthChange(monthOf(addDays(first, 40)))}
        >
          <ChevronLeftIcon className="ltr:-scale-x-100" />
        </IconButton>
        <Button variant="outline" onClick={() => onMonthChange(undefined)}>
          {t('hr.attendance.month.current')}
        </Button>
        <h2 className="text-lg font-bold" aria-live="polite">
          {formatMonth(first)}
        </h2>
      </div>

      {days.isPending ? (
        <Skeleton className="h-96" />
      ) : days.isError ? (
        <LoadError message={t('hr.attendance.month.loadError')} onRetry={() => days.refetch()} />
      ) : days.data.items.length === 0 ? (
        <EmptyState
          icon={<CalendarClockIcon />}
          title={t('hr.attendance.month.emptyTitle')}
          description={t('hr.attendance.month.emptyHint')}
        />
      ) : (
        <>
          <CalendarGrid
            className="hidden md:block"
            weekdays={grid.slice(0, 7).map((day) => formatWeekday(day))}
          >
            {grid.map((date) => {
              const day = byDate.get(date);
              return (
                <CalendarDay
                  key={date}
                  day={formatNumber(Number(date.slice(8)))}
                  label={formatWeekdayDate(date)}
                  today={date === today}
                  outside={!sameMonth(date, first)}
                  className="min-h-24"
                  data-day={date}
                >
                  {day && (
                    <button
                      type="button"
                      className="flex flex-col items-start gap-1 rounded-sm text-start outline-offset-2"
                      onClick={() => setOpenDay(date)}
                      aria-label={t('hr.attendance.month.openDay', {
                        date: formatWeekdayDate(date),
                      })}
                    >
                      <DayStatusBadge status={day.status} />
                      {day.workedMinutes > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {durationText(t, day.workedMinutes)}
                        </span>
                      )}
                    </button>
                  )}
                </CalendarDay>
              );
            })}
          </CalendarGrid>
          <ul className="flex flex-col gap-2 md:hidden" aria-label={formatMonth(first)}>
            {days.data.items
              .filter((day) => day.date <= today)
              .reverse()
              .map((day) => (
                <li key={day.date}>
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-surface p-3 text-start"
                    onClick={() => setOpenDay(day.date)}
                  >
                    <span className="font-medium">{formatWeekdayDate(day.date)}</span>
                    <DayStatusBadge status={day.status} />
                    {day.firstInAt && (
                      <span className="text-sm text-muted-foreground tabular-nums">
                        {formatTime(day.firstInAt)}
                        {day.lastOutAt && ` – ${formatTime(day.lastOutAt)}`}
                      </span>
                    )}
                  </button>
                </li>
              ))}
          </ul>
        </>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="attendance-items">
        <h2 id="attendance-items" className="text-lg font-bold">
          {t('hr.items.title')}
        </h2>
        {items.isPending ? (
          <Skeleton className="h-24" />
        ) : items.isError ? (
          <LoadError message={t('hr.items.listError')} onRetry={() => items.refetch()} />
        ) : items.data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('hr.items.noneThisMonth')}</p>
        ) : (
          <ItemRows items={items.data.items} self={self} />
        )}
      </section>

      <DayDialog day={openDay} onClose={() => setOpenDay(null)}>
        {(date) => {
          const day = byDate.get(date);
          return day ? (
            <DayDetail day={day} punchAction={punchAction} />
          ) : (
            <p className="px-6 pb-6 text-muted-foreground">{t('hr.attendance.noPunches')}</p>
          );
        }}
      </DayDialog>
    </div>
  );
}

/** A day's expectations, figures and punches (the day's timeline). */
export function DayDetail({
  day,
  punchAction,
}: {
  day: AttendanceDay;
  punchAction?: (punch: AttendanceDay['punches'][number], day: AttendanceDay) => ReactNode;
}) {
  const { t } = useTranslation();
  const figures = [
    day.lateMinutes > 0 &&
      t('hr.attendance.figures.late', { duration: durationText(t, day.lateMinutes) }),
    day.earlyMinutes > 0 &&
      t('hr.attendance.figures.early', { duration: durationText(t, day.earlyMinutes) }),
    day.overtimeMinutes > 0 &&
      t('hr.attendance.figures.overtime', { duration: durationText(t, day.overtimeMinutes) }),
    day.workedMinutes > 0 &&
      t('hr.attendance.figures.worked', { duration: durationText(t, day.workedMinutes) }),
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-4 px-6 pb-6">
      <div className="flex flex-wrap items-center gap-2">
        <DayStatusBadge status={day.status} />
        <Expectations day={day} />
      </div>
      {figures.length > 0 && <p className="text-sm">{figures.join(' · ')}</p>}
      <PunchTimeline
        punches={day.punches}
        action={punchAction ? (punch) => punchAction(punch, day) : undefined}
      />
    </div>
  );
}

/** What the day expects: a fixed time, a flexible window, or nothing on an off day. */
export function Expectations({ day }: { day: AttendanceDay }) {
  const { t } = useTranslation();
  if (day.kind !== 'work' || !day.expectedStart || !day.expectedEnd) {
    return (
      <span className="text-sm text-muted-foreground">
        {t(`hr.attendance.dayKinds.${day.kind}`)}
      </span>
    );
  }
  return (
    <span className="text-sm text-muted-foreground">
      {day.latestStart
        ? t('hr.attendance.expect.flexible', {
            from: formatTime(day.expectedStart),
            to: formatTime(day.latestStart),
            duration: durationText(t, day.requiredMinutes ?? 0),
          })
        : t('hr.attendance.expect.fixed', {
            from: formatTime(day.expectedStart),
            to: formatTime(day.expectedEnd),
          })}
      {day.place === 'remote' && ` · ${t('hr.attendance.remoteDay')}`}
    </span>
  );
}

/** The month's items, oldest first; the employee justifies a pending one. */
function ItemRows({ items, self }: { items: readonly AttendanceItem[]; self: boolean }) {
  const { t } = useTranslation();
  const [justifying, setJustifying] = useState<AttendanceItem | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li
            key={item.id}
            data-item={item.id}
            className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium">{itemSummary(t, item)}</span>
              <span className="text-sm text-muted-foreground">{formatCalendarDate(item.date)}</span>
              <ItemStatusBadge status={item.status} />
              {self ? null : (
                <Link
                  to="/hr/items/$itemId"
                  params={{ itemId: item.id }}
                  className="ms-auto text-sm font-medium hover:underline"
                >
                  {t('hr.items.open')}
                </Link>
              )}
            </div>
            {item.justification && (
              <p className="text-sm">
                <span className="text-muted-foreground">{t('hr.items.justification')}: </span>
                {item.justification}
              </p>
            )}
            {self && item.status === 'pending' && (
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(event) => {
                    opener.current = event.currentTarget;
                    setJustifying(item);
                  }}
                >
                  {item.justification ? t('hr.items.editJustification') : t('hr.items.justify')}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <JustifyDialog
        item={justifying}
        onClose={() => setJustifying(null)}
        finalFocus={() => opener.current ?? true}
      />
    </>
  );
}

/** Rule C17: the employee's reason, until the item is decided. */
function JustifyDialog({
  item,
  onClose,
  finalFocus,
}: {
  item: AttendanceItem | null;
  onClose: () => void;
  finalFocus: () => HTMLElement | boolean;
}) {
  const { t } = useTranslation();
  const justify = useJustifyItem(item?.id ?? '');
  const [text, setText] = useState('');
  const [missing, setMissing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  // An item opens with its reason so far, to change it.
  useEffect(() => {
    if (item) setText(item.justification ?? '');
  }, [item]);

  return (
    <FormDialog
      open={item !== null}
      onClose={onClose}
      onClosed={() => {
        setText('');
        setMissing(false);
        setFailure(null);
      }}
      finalFocus={finalFocus}
      submitting={justify.isPending}
      title={t('hr.items.justifyTitle')}
      description={item ? `${itemSummary(t, item)} · ${formatCalendarDate(item.date)}` : ''}
      action={t('hr.items.sendJustification')}
      failure={failure}
      onSubmit={async (event) => {
        event?.preventDefault();
        setFailure(null);
        const parsed = justifyItemSchema.safeParse({ text });
        if (!parsed.success) {
          setMissing(true);
          field.current?.focus();
          return;
        }
        try {
          await justify.mutateAsync(parsed.data);
          toast.add({ title: t('hr.items.justificationSent'), type: 'success' });
          onClose();
        } catch (error) {
          setFailure(errorMessage(t, error));
        }
      }}
    >
      <Field invalid={missing}>
        <FieldLabel>{t('hr.items.justification')}</FieldLabel>
        <Textarea
          ref={field}
          rows={3}
          maxLength={ATTENDANCE_ITEM_LIMITS.justification}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setMissing(false);
          }}
        />
        <FieldError match={missing}>{t('hr.items.justificationRequired')}</FieldError>
      </Field>
    </FormDialog>
  );
}

/** The month a page opens on: the given one, or this month. */
export const monthOrCurrent = (month: string | undefined) =>
  month ?? monthOf(firstOfMonth(businessDate()));
