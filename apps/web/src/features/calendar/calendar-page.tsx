import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  businessDate,
  CALENDAR_KINDS,
  type Calendar,
  type CalendarDate,
  type CalendarKind,
  calendarDay,
  SHOOT_TYPES,
  type ShootType,
} from '@vertex-hub/contracts';
import {
  Button,
  CalendarDay,
  CalendarGrid,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldLabel,
  MultiCombobox,
  PageHeader,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
} from '@vertex-hub/ui';
import {
  CalendarDaysIcon,
  CameraIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FilterXIcon,
  UserRoundIcon,
  UsersRoundIcon,
} from 'lucide-react';
import { useCallback, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { can, useMe } from '../../lib/auth';
import {
  formatCalendarDate,
  formatMonth,
  formatNumber,
  formatWeekday,
  formatWeekdayDate,
} from '../../lib/format';
import { ALL, dayParam, idParam, listParam, oneOfParam } from '../../lib/search-params';
import { clientListQuery } from '../clients/clients.queries';
import {
  type CalendarView,
  calendarRange,
  daysBetween,
  sameMonth,
  shiftCalendar,
} from '../content/content-dates';
import { FilterSelect } from '../tasks/task-list-page';
import { userListQuery } from '../users/users.queries';
import { calendarQuery } from './calendar.queries';
import { type CalendarEntry, EntryCard, EntryRows, entryKey } from './calendar-parts';
import { MeetingDialog } from './meeting-dialog';

/** What the company calendar shows, kept in the URL (spec F11, screen 1). */
export interface CalendarSearch {
  /** Unset means the month. */
  view?: 'week';
  /** A day of the month or week shown; unset means today. */
  date?: CalendarDate;
  /** Unset means every kind. */
  kinds?: CalendarKind[];
  clientId?: string;
  /** `me` or a user: their shoots, meetings and key dates. */
  userId?: string;
  shootType?: ShootType;
}

const ME = 'me';

/** Reads the calendar's state from URL search params, dropping anything malformed. */
export function parseCalendarSearch(search: Record<string, unknown>): CalendarSearch {
  return {
    view: search.view === 'week' ? 'week' : undefined,
    date: dayParam(search.date),
    kinds: listParam(CALENDAR_KINDS, search.kinds),
    clientId: idParam(search.clientId),
    userId: search.userId === ME ? ME : idParam(search.userId),
    shootType: oneOfParam(SHOOT_TYPES, search.shootType),
  };
}

/** Entries a day of the month grid shows before "+n" (screen 1). */
const DAY_LIMIT = 4;

/** Rule 15: each day's key dates first, then its shoots and meetings by start time. */
function entriesByDay(calendar: Calendar): Map<CalendarDate, CalendarEntry[]> {
  const timed = [
    ...calendar.shoots.map((shoot) => ({
      at: shoot.startsAt,
      entry: { kind: 'shoot' as const, shoot },
    })),
    ...calendar.meetings.map((meeting) => ({
      at: meeting.startsAt,
      entry: { kind: 'meeting' as const, meeting },
    })),
  ];
  timed.sort((a, b) => a.at.localeCompare(b.at));
  const days = new Map<CalendarDate, CalendarEntry[]>();
  const add = (day: CalendarDate, entry: CalendarEntry) =>
    days.set(day, [...(days.get(day) ?? []), entry]);
  for (const keyDate of calendar.keyDates) add(keyDate.date, { kind: 'keyDate', keyDate });
  // A booking belongs to the day it starts, also when it crosses midnight (edge case 3).
  for (const { at, entry } of timed) add(calendarDay(at), entry);
  return days;
}

/**
 * The company calendar: a month of weeks from Saturday, or one week, of shoots, meetings and key
 * dates, with its filters in the URL. Below 768 px the days become an agenda list.
 */
export function CalendarPage({ search }: { search: CalendarSearch }) {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate({ from: '/calendar/' });
  const onChange = useCallback(
    (next: Partial<CalendarSearch>) =>
      navigate({ search: (previous) => ({ ...previous, ...next }), replace: true }),
    [navigate],
  );
  const today = businessDate();
  const view: CalendarView = search.view ?? 'month';
  const date = search.date ?? today;
  const range = calendarRange(view, date);
  const calendar = useQuery(
    calendarQuery({
      ...range,
      kinds: search.kinds,
      clientId: search.clientId,
      userId: search.userId,
      shootType: search.shootType,
    }),
  );
  const [openDay, setOpenDay] = useState<CalendarDate | null>(null);
  const [creatingMeeting, setCreatingMeeting] = useState(false);
  const days = daysBetween(range.from, range.to);
  const byDay = calendar.data ? entriesByDay(calendar.data) : new Map<never, never>();
  const entriesOf = (day: CalendarDate): CalendarEntry[] => byDay.get(day) ?? [];
  // A booking that started before the range has no day here: only what the days show counts.
  const empty = days.every((day) => entriesOf(day).length === 0);

  return (
    <>
      <PageHeader
        title={t('calendar.title')}
        description={t('calendar.subtitle')}
        actions={
          <>
            {can(me, 'meetings.manage') && (
              <Button variant="outline" onClick={() => setCreatingMeeting(true)}>
                <UsersRoundIcon />
                {t('calendar.actions.newMeeting')}
              </Button>
            )}
            {can(me, 'shoots.manage') && (
              <Button render={<Link to="/shoots/new" />}>
                <CameraIcon />
                {t('calendar.actions.bookShoot')}
              </Button>
            )}
          </>
        }
      />
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              aria-label={t(`calendar.previous.${view}`)}
              onClick={() => onChange({ date: shiftCalendar(view, date, -1) })}
            >
              <ChevronRightIcon className="ltr:-scale-x-100" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label={t(`calendar.next.${view}`)}
              onClick={() => onChange({ date: shiftCalendar(view, date, 1) })}
            >
              <ChevronLeftIcon className="ltr:-scale-x-100" />
            </Button>
            <Button variant="outline" onClick={() => onChange({ date: undefined })}>
              {t('calendar.today')}
            </Button>
          </div>
          <h2 className="text-lg font-bold tabular-nums" aria-live="polite">
            {view === 'month'
              ? formatMonth(date)
              : t('calendar.weekRange', {
                  from: formatCalendarDate(range.from),
                  to: formatCalendarDate(range.to),
                })}
          </h2>
          <ToggleGroup
            aria-label={t('calendar.view')}
            className="ms-auto"
            value={[view]}
            onValueChange={(next: CalendarView[]) => {
              if (next[0]) onChange({ view: next[0] === 'week' ? 'week' : undefined });
            }}
          >
            <ToggleGroupItem value="month">{t('calendar.views.month')}</ToggleGroupItem>
            <ToggleGroupItem value="week">{t('calendar.views.week')}</ToggleGroupItem>
          </ToggleGroup>
        </div>

        <Filters search={search} onChange={onChange} />

        {calendar.isPending ? (
          <Skeleton className="h-96" />
        ) : calendar.isError ? (
          <LoadError message={t('calendar.loadError')} onRetry={() => calendar.refetch()} />
        ) : empty ? (
          <EmptyState icon={<CalendarDaysIcon />} title={t('calendar.emptyTitle')} />
        ) : (
          <>
            <CalendarGrid
              className="hidden md:block"
              weekdays={days.slice(0, 7).map((day) => formatWeekday(day))}
            >
              {days.map((day) => {
                const all = entriesOf(day);
                // The week lists everything; a month day shows the first ones, then "+n".
                const shown = view === 'week' ? all : all.slice(0, DAY_LIMIT);
                const more = all.length - shown.length;
                return (
                  <CalendarDay
                    key={day}
                    day={formatNumber(Number(day.slice(8)))}
                    label={formatWeekdayDate(day)}
                    today={day === today}
                    outside={view === 'month' && !sameMonth(day, date)}
                    className={view === 'week' ? 'min-h-96' : undefined}
                  >
                    {shown.map((entry) => (
                      <EntryCard key={entryKey(entry)} entry={entry} me={me} />
                    ))}
                    {more > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 justify-start px-1.5 text-xs"
                        aria-label={t('calendar.moreOn', {
                          n: formatNumber(more),
                          date: formatWeekdayDate(day),
                        })}
                        onClick={() => setOpenDay(day)}
                      >
                        <span dir="ltr">{t('calendar.more', { n: formatNumber(more) })}</span>
                      </Button>
                    )}
                  </CalendarDay>
                );
              })}
            </CalendarGrid>
            <ol className="flex flex-col gap-3 md:hidden">
              {days
                .filter((day) => entriesOf(day).length > 0)
                .map((day) => (
                  <li
                    key={day}
                    className="overflow-hidden rounded-lg border border-border bg-surface"
                  >
                    <h3 className="flex items-center gap-2 border-b border-border bg-muted px-4 py-2 text-sm font-medium">
                      {formatWeekdayDate(day)}
                      {day === today && (
                        <span className="rounded-sm bg-primary px-1.5 text-xs text-primary-foreground">
                          {t('calendar.today')}
                        </span>
                      )}
                    </h3>
                    <EntryRows entries={entriesOf(day)} me={me} />
                  </li>
                ))}
            </ol>
          </>
        )}
      </div>

      {creatingMeeting && <MeetingDialog onClose={() => setCreatingMeeting(false)} />}
      {openDay && (
        <Dialog open onOpenChange={(open) => !open && setOpenDay(null)}>
          <DialogContent closeLabel={t('common.close')} className="max-w-2xl p-0">
            <DialogHeader className="px-6 pt-6">
              <DialogTitle>{formatWeekdayDate(openDay)}</DialogTitle>
            </DialogHeader>
            <EntryRows entries={entriesOf(openDay)} me={me} />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function Filters({
  search,
  onChange,
}: {
  search: CalendarSearch;
  onChange: (next: Partial<CalendarSearch>) => void;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const kindsId = useId();
  const clients = useQuery(
    clientListQuery({ status: ['active', 'paused', 'ended'], pageSize: 100 }),
  );
  const users = useQuery(userListQuery({ pageSize: 100 }));
  const clientItems = [
    { value: ALL, label: t('calendar.filters.allClients') },
    ...(clients.data?.items ?? []).map((client) => ({
      value: client.id,
      label: client.tradeName,
    })),
  ];
  const userItems = [
    { value: ALL, label: t('calendar.filters.everyone') },
    ...(users.data?.items ?? []).map((user) => ({ value: user.id, label: user.name })),
  ];
  const typeItems = [
    { value: ALL, label: t('calendar.filters.allShootTypes') },
    ...SHOOT_TYPES.map((type) => ({ value: type, label: t(`calendar.shootTypes.${type}`) })),
  ];
  const kindOptions = CALENDAR_KINDS.map((kind) => ({
    kind,
    name: t(`calendar.kinds.${kind}`),
  }));
  const mine = search.userId === ME;
  const filtered = !!search.kinds || !!search.clientId || !!search.userId || !!search.shootType;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field>
          <FieldLabel htmlFor={kindsId} className="sr-only">
            {t('calendar.filters.kinds')}
          </FieldLabel>
          <MultiCombobox
            id={kindsId}
            items={kindOptions}
            value={(search.kinds ?? []).flatMap(
              (kind) => kindOptions.find((option) => option.kind === kind) ?? [],
            )}
            onValueChange={(next) =>
              onChange({ kinds: next.length > 0 ? next.map(({ kind }) => kind) : undefined })
            }
            itemToLabel={(item) => item.name}
            itemToKey={(item) => item.kind}
            placeholder={t('calendar.filters.allKinds')}
            emptyLabel={t('common.noMatches')}
            removeLabel={(label) => t('common.remove', { label })}
          />
        </Field>
        <FilterSelect
          label={t('calendar.filters.client')}
          items={clientItems}
          value={search.clientId ?? ALL}
          onChange={(value) => onChange({ clientId: value === ALL ? undefined : value })}
        />
        <FilterSelect
          label={t('calendar.filters.person')}
          items={userItems}
          value={mine ? me.user.id : (search.userId ?? ALL)}
          onChange={(value) =>
            onChange({ userId: value === ALL ? undefined : value === me.user.id ? ME : value })
          }
        />
        <FilterSelect
          label={t('calendar.filters.shootType')}
          items={typeItems}
          value={search.shootType ?? ALL}
          onChange={(value) => onChange({ shootType: oneOfParam(SHOOT_TYPES, value) })}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={mine ? 'secondary' : 'outline'}
          size="sm"
          aria-pressed={mine}
          onClick={() => onChange({ userId: mine ? undefined : ME })}
        >
          <UserRoundIcon />
          {t('calendar.filters.mine')}
        </Button>
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onChange({
                kinds: undefined,
                clientId: undefined,
                userId: undefined,
                shootType: undefined,
              })
            }
          >
            <FilterXIcon />
            {t('calendar.filters.clear')}
          </Button>
        )}
      </div>
    </div>
  );
}
