import { useQuery } from '@tanstack/react-query';
import {
  businessDate,
  type CalendarDate,
  POST_PLATFORMS,
  POST_STATUSES,
  POST_TYPES,
  type Post,
  type PostPlatform,
  type PostStatus,
  type PostType,
} from '@vertex-hub/contracts';
import {
  Button,
  CalendarDay,
  CalendarGrid,
  EmptyState,
  Field,
  FieldLabel,
  MultiCombobox,
  Skeleton,
} from '@vertex-hub/ui';
import { CalendarDaysIcon, FilterXIcon, UserRoundIcon } from 'lucide-react';
import { type ReactNode, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { formatNumber, formatWeekday, formatWeekdayDate } from '../../lib/format';
import { ALL, dayParam, flagParam, idParam, listParam, oneOfParam } from '../../lib/search-params';
import { clientListQuery } from '../clients/clients.queries';
import { FilterSelect } from '../tasks/task-list-page';
import { CalendarToolbar, DayDialog, MoreOnDay } from './calendar-toolbar';
import { contentCalendarQuery } from './content.queries';
import { type CalendarView, calendarRange, daysBetween, sameMonth } from './content-dates';
import { PostCard, PostRows } from './post-parts';

/** What the calendar shows: kept in the URL on the Content page (spec F08, screen 1). */
export interface CalendarState {
  /** Unset means the month. */
  view?: 'week';
  /** A day of the month or week shown; unset means today. */
  date?: CalendarDate;
  clientId?: string;
  status?: PostStatus[];
  platform?: PostPlatform;
  type?: PostType;
  /** Only the posts the user is responsible for. */
  mine?: true;
}

/** Reads the calendar's state from URL search params, dropping anything malformed. */
export function parseCalendarState(search: Record<string, unknown>): CalendarState {
  return {
    view: search.view === 'week' ? 'week' : undefined,
    date: dayParam(search.date),
    clientId: idParam(search.clientId),
    status: listParam(POST_STATUSES, search.status),
    platform: oneOfParam(POST_PLATFORMS, search.platform),
    type: oneOfParam(POST_TYPES, search.type),
    mine: flagParam(search.mine),
  };
}

/** Posts a day of the month grid shows before "+n" (screen 1). */
const DAY_LIMIT = 4;

/**
 * The content calendar: a month of weeks from Saturday, or one week, with the filters of screen
 * 1. Below 768 px the days become an agenda list. With `clientId` it is fixed to one client
 * (screen 2).
 */
export function ContentCalendar({
  state,
  onChange,
  clientId,
  emptyAction,
}: {
  state: CalendarState;
  onChange: (next: Partial<CalendarState>) => void;
  /** Fixes the calendar to one client and hides the client filter. */
  clientId?: string;
  /** Offered when the period has no posts: "New post" for those who may create one. */
  emptyAction?: ReactNode;
}) {
  const { t } = useTranslation();
  const today = businessDate();
  const view: CalendarView = state.view ?? 'month';
  const date = state.date ?? today;
  const range = calendarRange(view, date);
  const calendar = useQuery(
    contentCalendarQuery({
      ...range,
      clientId: clientId ?? state.clientId,
      status: state.status,
      platform: state.platform,
      type: state.type,
      responsible: state.mine ? 'me' : undefined,
    }),
  );
  const [openDay, setOpenDay] = useState<CalendarDate | null>(null);
  const days = daysBetween(range.from, range.to);
  const posts = calendar.data?.posts ?? [];
  const postsOf = (day: CalendarDate) => posts.filter((post) => post.publishDate === day);
  const showClient = !clientId;

  return (
    <div className="flex flex-col gap-4">
      <CalendarToolbar view={view} date={date} onChange={onChange} />

      <Filters state={state} onChange={onChange} withClient={!clientId} />

      {calendar.isPending ? (
        <Skeleton className="h-96" />
      ) : calendar.isError ? (
        <LoadError message={t('content.calendar.loadError')} onRetry={() => calendar.refetch()} />
      ) : posts.length === 0 ? (
        <EmptyState
          icon={<CalendarDaysIcon />}
          title={t('content.calendar.emptyTitle')}
          description={emptyAction ? t('content.calendar.emptyHint') : undefined}
          action={emptyAction}
        />
      ) : (
        <>
          <CalendarGrid
            className="hidden md:block"
            weekdays={days.slice(0, 7).map((day) => formatWeekday(day))}
          >
            {days.map((day) => {
              const all = postsOf(day);
              // The week lists every post; a month day shows the first ones, then "+n".
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
                  {shown.map((post) => (
                    <PostCard key={post.id} post={post} showClient={showClient} />
                  ))}
                  {more > 0 && <MoreOnDay day={day} count={more} onOpen={() => setOpenDay(day)} />}
                </CalendarDay>
              );
            })}
          </CalendarGrid>
          <Agenda
            days={days.filter((day) => postsOf(day).length > 0)}
            postsOf={postsOf}
            today={today}
            showClient={showClient}
          />
        </>
      )}

      <DayDialog day={openDay} onClose={() => setOpenDay(null)}>
        {(day) => <PostRows posts={postsOf(day)} showClient={showClient} showDate={false} />}
      </DayDialog>
    </div>
  );
}

/** The calendar on a phone: the days that have posts, in order, each with its posts. */
function Agenda({
  days,
  postsOf,
  today,
  showClient,
}: {
  days: CalendarDate[];
  postsOf: (day: CalendarDate) => Post[];
  today: CalendarDate;
  showClient: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ol className="flex flex-col gap-3 md:hidden">
      {days.map((day) => (
        <li key={day} className="overflow-hidden rounded-lg border border-border bg-surface">
          <h3 className="flex items-center gap-2 border-b border-border bg-muted px-4 py-2 text-sm font-medium">
            {formatWeekdayDate(day)}
            {day === today && (
              <span className="rounded-sm bg-primary px-1.5 text-xs text-primary-foreground">
                {t('calendar.today')}
              </span>
            )}
          </h3>
          <PostRows posts={postsOf(day)} showClient={showClient} showDate={false} />
        </li>
      ))}
    </ol>
  );
}

function Filters({
  state,
  onChange,
  withClient,
}: {
  state: CalendarState;
  onChange: (next: Partial<CalendarState>) => void;
  withClient: boolean;
}) {
  const { t } = useTranslation();
  const statusId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const clients = useQuery({
    ...clientListQuery({ status: ['active', 'paused', 'ended'], pageSize: 100 }),
    enabled: withClient,
  });
  const clientItems = [
    { value: ALL, label: t('content.filters.allClients') },
    ...(clients.data?.items ?? []).map((client) => ({
      value: client.id,
      label: client.tradeName,
    })),
  ];
  const typeItems = [
    { value: ALL, label: t('content.filters.allTypes') },
    ...POST_TYPES.map((type) => ({ value: type, label: t(`content.types.${type}`) })),
  ];
  const platformItems = [
    { value: ALL, label: t('content.filters.allPlatforms') },
    ...POST_PLATFORMS.map((platform) => ({
      value: platform,
      label: t(`clients.platforms.names.${platform}`),
    })),
  ];
  const statusOptions = POST_STATUSES.map((status) => ({
    status,
    name: t(`content.statuses.${status}`),
  }));
  const filtered =
    (withClient && !!state.clientId) ||
    !!state.status ||
    !!state.platform ||
    !!state.type ||
    !!state.mine;

  return (
    <div ref={panel} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {withClient && (
          <FilterSelect
            label={t('content.filters.client')}
            items={clientItems}
            value={state.clientId ?? ALL}
            onChange={(value) => onChange({ clientId: value === ALL ? undefined : value })}
          />
        )}
        <FilterSelect
          label={t('content.filters.type')}
          items={typeItems}
          value={state.type ?? ALL}
          onChange={(value) => onChange({ type: oneOfParam(POST_TYPES, value) })}
        />
        <FilterSelect
          label={t('content.filters.platform')}
          items={platformItems}
          value={state.platform ?? ALL}
          onChange={(value) => onChange({ platform: oneOfParam(POST_PLATFORMS, value) })}
        />
        <Field className={withClient ? undefined : 'sm:col-span-2'}>
          <FieldLabel htmlFor={statusId} className="sr-only">
            {t('content.filters.status')}
          </FieldLabel>
          <MultiCombobox
            id={statusId}
            items={statusOptions}
            value={(state.status ?? []).flatMap(
              (status) => statusOptions.find((option) => option.status === status) ?? [],
            )}
            onValueChange={(next) =>
              onChange({ status: next.length > 0 ? next.map(({ status }) => status) : undefined })
            }
            itemToLabel={(item) => item.name}
            itemToKey={(item) => item.status}
            placeholder={t('content.filters.allStatuses')}
            emptyLabel={t('common.noMatches')}
            removeLabel={(label) => t('common.remove', { label })}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={state.mine ? 'secondary' : 'outline'}
          size="sm"
          aria-pressed={state.mine === true}
          onClick={() => onChange({ mine: state.mine ? undefined : true })}
        >
          <UserRoundIcon />
          {t('content.filters.mine')}
        </Button>
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange({
                clientId: undefined,
                status: undefined,
                platform: undefined,
                type: undefined,
                mine: undefined,
              });
              // The button leaves with the filters: the focus goes to the first one.
              panel.current?.querySelector<HTMLElement>('button, input')?.focus();
            }}
          >
            <FilterXIcon />
            {t('content.filters.clear')}
          </Button>
        )}
      </div>
    </div>
  );
}
