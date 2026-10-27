import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  businessDate,
  type CalendarDate,
  type CalendarIssue,
  type CalendarOccasion,
  type ContentIdea,
  POST_PLATFORMS,
  POST_STATUSES,
  POST_TYPES,
  type Post,
  type PostDetail,
  type PostPlatform,
  type PostStatus,
  type PostType,
} from '@vertex-hub/contracts';
import {
  Button,
  CalendarDay,
  CalendarGrid,
  cn,
  EmptyState,
  Field,
  FieldLabel,
  IconButton,
  MultiCombobox,
  Skeleton,
  toast,
} from '@vertex-hub/ui';
import {
  CalendarDaysIcon,
  FilterXIcon,
  LightbulbIcon,
  PlusIcon,
  UserRoundIcon,
} from 'lucide-react';
import { type DragEvent, type ReactNode, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { errorMessage } from '../../lib/errors';
import { formatNumber, formatWeekday, formatWeekdayDate } from '../../lib/format';
import { ALL, dayParam, flagParam, idParam, listParam, oneOfParam } from '../../lib/search-params';
import { clientListQuery } from '../clients/clients.queries';
import { FilterSelect } from '../tasks/task-list-page';
import { gapClientsOn, occasionsOn, tooClosePostIds } from './calendar-marks';
import { GapMark, OccasionStrip } from './calendar-overlays';
import { CalendarToolbar, DayDialog, MoreOnDay } from './calendar-toolbar';
import { contentCalendarQuery, contentPillarsQuery, postQuery } from './content.queries';
import { type CalendarView, calendarRange, daysBetween, sameMonth } from './content-dates';
import { ContentGrid } from './content-grid';
import { IdeasPanel } from './ideas-panel';
import { MovePostDialog } from './post-move-dialog';
import { PostCard, PostRows } from './post-parts';

/** What the calendar shows: kept in the URL on the Content page (spec F08, screen 1). */
export interface CalendarState {
  /** Unset means the month; the grid needs a client (F08B rule C11). */
  view?: 'week' | 'grid';
  /** A day of the month or week shown; unset means today. */
  date?: CalendarDate;
  clientId?: string;
  status?: PostStatus[];
  platform?: PostPlatform;
  type?: PostType;
  /** F08B: posts of one pillar. */
  pillarId?: string;
  /** Only the posts the user is responsible for. */
  mine?: true;
  /** F08B: the ideas panel beside the calendar. */
  ideas?: true;
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
    pillarId: idParam(search.pillarId),
    mine: flagParam(search.mine),
    ideas: flagParam(search.ideas),
  };
}

/** Posts a day of the month grid shows before "+n" (screen 1). */
const DAY_LIMIT = 4;

/** Rule B6: published and cancelled posts stay on their day. */
const movable = (post: Post) => post.status !== 'published' && post.status !== 'cancelled';

/** What is being dragged over the days: a post to move or an idea to start a post from. */
type Dragged = { kind: 'post'; post: Post } | { kind: 'idea'; idea: ContentIdea };

/** The drag's data type: a post or an idea dragged from this page, not a link or a file. */
const DRAG_TYPE = 'application/x-vertex-content';

/**
 * The content calendar: a month of weeks from Saturday, or one week, with the filters of screen
 * 1. Below 768 px the days become an agenda list. With `clientId` it is fixed to one client
 * (screen 2) and offers the Instagram grid. F08B adds the planning surface: a day of today or
 * later opens the wizard on it (rule B4), posts drag to another day (B6), occasions, gaps and
 * posts too close are marked (C6–C8), and the ideas panel drags ideas onto days (B5).
 */
export function ContentCalendar({
  state,
  onChange,
  clientId,
  canCreate,
  canEditClient,
  emptyAction,
  monthBar,
}: {
  state: CalendarState;
  onChange: (next: Partial<CalendarState>) => void;
  /** Fixes the calendar to one client and hides the client filter. */
  clientId?: string;
  /** The user may start posts here: day clicks and dropped ideas open the wizard. */
  canCreate: boolean;
  /** Edit scope on a client's posts (hides the drag only; the post's detail decides). */
  canEditClient: (clientId: string) => boolean;
  /** Offered when the period has no posts: "New post" for those who may create one. */
  emptyAction?: ReactNode;
  /** Above the days on a client's calendar: the month's counts and balance. */
  monthBar?: ReactNode;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const today = businessDate();
  const grid = !!clientId && state.view === 'grid';
  const view: CalendarView = state.view === 'week' ? 'week' : 'month';
  const date = state.date ?? today;
  const range = calendarRange(view, date);
  const shownClient = clientId ?? state.clientId;
  const calendar = useQuery({
    ...contentCalendarQuery({
      ...range,
      clientId: shownClient,
      status: state.status,
      platform: state.platform,
      type: state.type,
      pillarId: state.pillarId,
      responsible: state.mine ? 'me' : undefined,
    }),
    enabled: !grid,
  });
  const [openDay, setOpenDay] = useState<CalendarDate | null>(null);
  const [dragged, setDragged] = useState<Dragged | null>(null);
  const [over, setOver] = useState<CalendarDate | null>(null);
  const [moving, setMoving] = useState<{ post: PostDetail; date: CalendarDate } | null>(null);
  const days = daysBetween(range.from, range.to);
  const posts = calendar.data?.posts ?? [];
  const occasions = calendar.data?.occasions ?? [];
  const issues = calendar.data?.issues ?? [];
  const tooClose = tooClosePostIds(issues);
  const postsOf = (day: CalendarDate) => posts.filter((post) => post.publishDate === day);
  const showClient = !clientId;
  // Gap marks name their clients on the calendar of every client (the filter's list, cached).
  const clients = useQuery({
    ...clientListQuery({ status: ['active', 'paused', 'ended'], pageSize: 100 }),
    enabled: showClient,
  });
  const clientNames = new Map(
    (clients.data?.items ?? []).map((client) => [client.id, client.tradeName]),
  );

  // Rule B4: today and later only; the wizard checks the client.
  const opens = (day: CalendarDate) => canCreate && day >= today;
  const openWizard = (day: CalendarDate, idea?: ContentIdea) =>
    navigate({
      to: '/content/new',
      search: {
        date: day,
        ...(idea && { ideaId: idea.id }),
        ...((idea?.client?.id ?? shownClient) && { clientId: idea?.client?.id ?? shownClient }),
      },
    });

  function startDrag(event: DragEvent, item: Dragged) {
    event.dataTransfer.effectAllowed = item.kind === 'post' ? 'move' : 'copy';
    event.dataTransfer.setData(DRAG_TYPE, item.kind === 'post' ? item.post.id : item.idea.id);
    setDragged(item);
  }

  function endDrag() {
    setDragged(null);
    setOver(null);
  }

  // A day takes a post other than its own, or an idea, from today on.
  const takes = (day: CalendarDate) =>
    !!dragged &&
    day >= today &&
    (dragged.kind === 'post' ? dragged.post.publishDate !== day : canCreate);

  async function drop(day: CalendarDate) {
    const current = dragged;
    endDrag();
    if (!current || !takes(day)) return;
    if (current.kind === 'idea') {
      void openWizard(day, current.idea);
      return;
    }
    try {
      // Cards carry list fields only: whether the user may move it comes with the detail.
      const detail = await queryClient.fetchQuery({
        ...postQuery(current.post.id),
        staleTime: 10_000,
      });
      if (!detail.permissions.canEdit || !movable(detail) || detail.archivedAt) {
        toast.add({ title: t('content.calendar.cannotMove'), type: 'error' });
        return;
      }
      setMoving({ post: detail, date: day });
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  }

  const dayDrop = (day: CalendarDate) => ({
    'data-drop': dragged ? (takes(day) ? 'allowed' : 'refused') : undefined,
    onDragOver: (event: DragEvent) => {
      if (!takes(day) || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = dragged?.kind === 'post' ? 'move' : 'copy';
      setOver(day);
    },
    onDragLeave: () => setOver((current) => (current === day ? null : current)),
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      void drop(day);
    },
  });

  const card = (post: Post) => {
    const drags = movable(post) && canEditClient(post.client.id);
    return (
      <PostCard
        key={post.id}
        post={post}
        showClient={showClient}
        tooClose={tooClose.has(post.id)}
        dragging={dragged?.kind === 'post' && dragged.post.id === post.id}
        onDragStart={drags ? (event) => startDrag(event, { kind: 'post', post }) : undefined}
        onDragEnd={drags ? endDrag : undefined}
      />
    );
  };

  const ideasOpen = !grid && state.ideas === true;
  const body = grid ? (
    <ContentGrid clientId={clientId} month={date.slice(0, 7)} />
  ) : calendar.isPending ? (
    <Skeleton className="h-96" />
  ) : calendar.isError ? (
    <LoadError message={t('content.calendar.loadError')} onRetry={() => calendar.refetch()} />
  ) : (
    <>
      {posts.length === 0 && (
        // The days stay below on wide screens: a day from today still opens the wizard (B4).
        <EmptyState
          className="py-6"
          icon={<CalendarDaysIcon />}
          title={t('content.calendar.emptyTitle')}
          description={emptyAction ? t('content.calendar.emptyHint') : undefined}
          action={emptyAction}
        />
      )}
      <CalendarGrid
        className="hidden md:block"
        weekdays={days.slice(0, 7).map((day) => formatWeekday(day))}
      >
        {days.map((day) => {
          const all = postsOf(day);
          // The week lists every post; a month day shows the first ones, then "+n".
          const shown = view === 'week' ? all : all.slice(0, DAY_LIMIT);
          const more = all.length - shown.length;
          const gaps = gapClientsOn(issues, day);
          const drop = dayDrop(day);
          return (
            <CalendarDay
              key={day}
              day={formatNumber(Number(day.slice(8)))}
              label={formatWeekdayDate(day)}
              today={day === today}
              outside={view === 'month' && !sameMonth(day, date)}
              data-day={day}
              {...drop}
              onClick={(event) => {
                // The empty space of a day opens the wizard; its cards and buttons keep theirs.
                // Clicks from a portal (an occasion's popover) bubble here too: only the day's own.
                const target = event.target as HTMLElement;
                if (!event.currentTarget.contains(target)) return;
                if (!opens(day) || target.closest('a, button')) return;
                void openWizard(day);
              }}
              className={cn(
                'group/day',
                view === 'week' && 'min-h-96',
                opens(day) && 'cursor-pointer',
                drop['data-drop'] === 'allowed' && 'bg-primary/5',
                over === day && 'outline-2 -outline-offset-2 outline-primary outline-dashed',
              )}
              action={
                opens(day) && (
                  <IconButton
                    size="icon-sm"
                    className="size-6 opacity-0 transition-opacity duration-150 group-hover/day:opacity-100 focus-visible:opacity-100"
                    label={t('content.calendar.newOn', { date: formatWeekdayDate(day) })}
                    onClick={() => void openWizard(day)}
                  >
                    <PlusIcon />
                  </IconButton>
                )
              }
            >
              {occasionsOn(occasions, day).map((occasion) => (
                <OccasionStrip
                  key={occasion.id}
                  occasion={occasion}
                  day={day}
                  clientId={clientId}
                  canSkip={!!clientId && canCreate}
                />
              ))}
              {shown.map(card)}
              {more > 0 && <MoreOnDay day={day} count={more} onOpen={() => setOpenDay(day)} />}
              {gaps.length > 0 && (
                <GapMark clients={showClient ? gaps.map((id) => clientNames.get(id) ?? '') : []} />
              )}
            </CalendarDay>
          );
        })}
      </CalendarGrid>
      <Agenda
        days={days.filter(
          (day) => postsOf(day).length > 0 || occasionsOn(occasions, day).length > 0,
        )}
        postsOf={postsOf}
        occasions={occasions}
        issues={issues}
        today={today}
        showClient={showClient}
        clientId={clientId}
      />
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      <CalendarToolbar<'month' | 'week' | 'grid'>
        view={grid ? 'grid' : view}
        views={clientId ? ['month', 'week', 'grid'] : ['month', 'week']}
        date={date}
        onChange={onChange}
      />

      {monthBar}

      {!grid && <Filters state={state} onChange={onChange} withClient={!clientId} />}

      <div className={cn('flex flex-col gap-4', ideasOpen && 'lg:grid lg:grid-cols-[1fr_18rem]')}>
        <div className="min-w-0">{body}</div>
        {ideasOpen && (
          <IdeasPanel
            clientId={clientId ?? state.clientId}
            canDrag={canCreate}
            draggedId={dragged?.kind === 'idea' ? dragged.idea.id : null}
            onDragStart={(event, idea) => startDrag(event, { kind: 'idea', idea })}
            onDragEnd={endDrag}
          />
        )}
      </div>

      <DayDialog day={openDay} onClose={() => setOpenDay(null)}>
        {(day) => <PostRows posts={postsOf(day)} showClient={showClient} showDate={false} />}
      </DayDialog>
      {moving && (
        <MovePostDialog
          key={`${moving.post.id}:${moving.date}`}
          post={moving.post}
          initialDate={moving.date}
          open
          onClose={() => setMoving(null)}
          finalFocus={() =>
            document.querySelector<HTMLElement>(`[data-post="${moving.post.id}"]`) ?? true
          }
        />
      )}
    </div>
  );
}

/**
 * The calendar on a phone: the days that have posts or occasions, in order, each with its
 * posts. Posts move from their page or card menu here (rule B6).
 */
function Agenda({
  days,
  postsOf,
  occasions,
  issues,
  today,
  showClient,
  clientId,
}: {
  days: CalendarDate[];
  postsOf: (day: CalendarDate) => Post[];
  occasions: CalendarOccasion[];
  issues: CalendarIssue[];
  today: CalendarDate;
  showClient: boolean;
  clientId?: string;
}) {
  const { t } = useTranslation();
  if (days.length === 0) return null;
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
          {occasionsOn(occasions, day).length > 0 && (
            <div className="flex flex-col gap-1 border-b border-border px-4 py-2">
              {occasionsOn(occasions, day).map((occasion) => (
                <OccasionStrip
                  key={occasion.id}
                  occasion={occasion}
                  day={day}
                  clientId={clientId}
                  canSkip={false}
                />
              ))}
            </div>
          )}
          {gapClientsOn(issues, day).length > 0 && (
            <div className="px-4 pt-2">
              <GapMark clients={[]} />
            </div>
          )}
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
  const pillars = useQuery(contentPillarsQuery);
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
  const pillarList = (pillars.data?.items ?? []).filter(
    (pillar) => !pillar.archived || pillar.id === state.pillarId,
  );
  const pillarItems = [
    { value: ALL, label: t('content.filters.allPillars') },
    ...pillarList.map((pillar) => ({ value: pillar.id, label: pillar.name })),
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
    !!state.pillarId ||
    !!state.mine;

  return (
    <div ref={panel} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
      <div
        className={cn(
          'grid gap-3 sm:grid-cols-2',
          withClient ? 'lg:grid-cols-5' : 'lg:grid-cols-4',
        )}
      >
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
        <FilterSelect
          label={t('content.filters.pillar')}
          items={pillarItems}
          value={state.pillarId ?? ALL}
          onChange={(value) => onChange({ pillarId: value === ALL ? undefined : value })}
        />
        <Field className={withClient ? 'sm:col-span-2 lg:col-span-1' : undefined}>
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
                pillarId: undefined,
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
        <Button
          variant={state.ideas ? 'secondary' : 'outline'}
          size="sm"
          className="ms-auto"
          aria-pressed={state.ideas === true}
          onClick={() => onChange({ ideas: state.ideas ? undefined : true })}
        >
          <LightbulbIcon />
          {t('content.ideas.toggle')}
        </Button>
      </div>
    </div>
  );
}
