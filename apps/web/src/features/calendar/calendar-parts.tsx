import { Link } from '@tanstack/react-router';
import {
  calendarDay,
  type KeyDate,
  type KeyDateKind,
  type Meeting,
  type MeResponse,
  type ScheduleConflict,
  type Shoot,
  type ShootStatus,
  type ShootType,
} from '@vertex-hub/contracts';
import { Avatar, Badge, cn } from '@vertex-hub/ui';
import {
  ArchiveIcon,
  BanIcon,
  CameraIcon,
  FlagIcon,
  FolderKanbanIcon,
  type LucideIcon,
  PackageIcon,
  PartyPopperIcon,
  RepeatIcon,
  TriangleAlertIcon,
  UsersIcon,
  UsersRoundIcon,
  VideoIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { can, scopesOf } from '../../lib/auth';
import { formatDateTime, formatTime, formatWeekdayDate } from '../../lib/format';

/*
 * How shoots, meetings and key dates look wherever the calendar lists them (spec F11, screen 1):
 * the card of a day, the row of the agenda and of a day's list, and the badges they share with
 * the shoot page.
 */

/**
 * Shoot scope before a shoot exists: `shoots.manage` under `all`, or `own_clients` for the
 * client's account manager; an internal shoot (no client) needs `all`. Existing shoots carry the
 * server's answer in `permissions`. Hides UI only.
 */
export function canBookShootsOf(me: MeResponse, clientAccountManagerId: string | null): boolean {
  const scopes = scopesOf(me, 'shoots.manage');
  return (
    scopes.includes('all') ||
    (scopes.includes('own_clients') && clientAccountManagerId === me.user.id)
  );
}

export function ShootStatusBadge({ status }: { status: ShootStatus }) {
  const { t } = useTranslation();
  if (status === 'cancelled') {
    return (
      <Badge tone="outline" data-status={status} className="text-muted-foreground">
        <BanIcon aria-hidden="true" />
        {t('calendar.shootStatuses.cancelled')}
      </Badge>
    );
  }
  return (
    <Badge tone={status === 'completed' ? 'brand' : 'info'} data-status={status}>
      {t(`calendar.shootStatuses.${status}`)}
    </Badge>
  );
}

export function ShootArchivedBadge() {
  const { t } = useTranslation();
  return (
    <Badge tone="neutral">
      <ArchiveIcon aria-hidden="true" />
      {t('calendar.archived')}
    </Badge>
  );
}

/** Someone of the booking is booked elsewhere at an overlapping time (rule 5). */
export function ConflictBadge({ compact }: { compact?: boolean }) {
  const { t } = useTranslation();
  if (compact) {
    return (
      <TriangleAlertIcon
        role="img"
        aria-label={t('calendar.conflict')}
        data-conflict
        className="size-3.5 shrink-0 text-status-warning-foreground"
      />
    );
  }
  return (
    <Badge tone="warning" data-conflict>
      <TriangleAlertIcon aria-hidden="true" />
      {t('calendar.conflict')}
    </Badge>
  );
}

export const SHOOT_TYPE_ICONS: Record<ShootType, LucideIcon> = {
  product: PackageIcon,
  video: VideoIcon,
  event: PartyPopperIcon,
  people: UsersIcon,
  other: CameraIcon,
};

/** The shoot type as an icon, named for assistive technology. */
export function ShootTypeIcon({ type, className }: { type: ShootType; className?: string }) {
  const { t } = useTranslation();
  const Icon = SHOOT_TYPE_ICONS[type];
  return (
    <Icon
      role="img"
      aria-label={t(`calendar.shootTypes.${type}`)}
      className={cn('size-4 shrink-0 text-muted-foreground', className)}
    />
  );
}

/**
 * From its start to its end. A booking that ends on a later day (edge case 3) names that day
 * when `full`; the calendar, where it sits under its start day, shows the end time alone.
 */
export function formatTimeRange(item: { startsAt: string; endsAt: string }, full = false): string {
  const sameDay = calendarDay(item.startsAt) === calendarDay(item.endsAt);
  const end = full && !sameDay ? formatDateTime(item.endsAt) : formatTime(item.endsAt);
  return `${formatTime(item.startsAt)} – ${end}`;
}

/** A client's name, marked once the client is archived (edge case 9); "no client" otherwise. */
export function useClientLabel() {
  const { t } = useTranslation();
  return (client: { name: string; archived: boolean } | null): string =>
    !client
      ? t('calendar.internal')
      : client.archived
        ? t('calendar.archivedClient', { name: client.name })
        : client.name;
}

/** One thing on a day of the calendar. */
export type CalendarEntry =
  | { kind: 'shoot'; shoot: Shoot }
  | { kind: 'meeting'; meeting: Meeting }
  | { kind: 'keyDate'; keyDate: KeyDate };

export const entryKey = (entry: CalendarEntry): string =>
  entry.kind === 'shoot'
    ? entry.shoot.id
    : entry.kind === 'meeting'
      ? entry.meeting.id
      : `${entry.keyDate.kind}-${entry.keyDate.targetId}-${entry.keyDate.title}`;

const KEY_DATE_ICONS: Record<KeyDateKind, LucideIcon> = {
  project_due: FolderKanbanIcon,
  milestone_due: FlagIcon,
  renewal: RepeatIcon,
};

const cardClass =
  'flex min-w-0 flex-col gap-0.5 rounded-md border border-border bg-surface p-1.5 text-xs';

const cardLinkClass =
  'transition-colors duration-150 ease-out hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/** A key date opens its project or retainer for those who may read them. */
function KeyDateLink({
  keyDate,
  className,
  children,
}: {
  keyDate: KeyDate;
  className?: string;
  children: ReactNode;
}) {
  if (keyDate.kind === 'renewal') {
    return (
      <Link
        to="/retainers/$retainerId"
        params={{ retainerId: keyDate.targetId }}
        className={className}
      >
        {children}
      </Link>
    );
  }
  return (
    <Link to="/projects/$projectId" params={{ projectId: keyDate.targetId }} className={className}>
      {children}
    </Link>
  );
}

/** An all-day chip: "Project due", "Milestone due" or "Renewal", then what it is about. */
function KeyDateChip({ keyDate, me }: { keyDate: KeyDate; me: MeResponse }) {
  const { t } = useTranslation();
  const Icon = KEY_DATE_ICONS[keyDate.kind];
  const body = (
    <>
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="truncate">
        {t(`calendar.keyDates.${keyDate.kind}`)}: {keyDate.title}
      </span>
    </>
  );
  const className =
    'flex min-w-0 items-center gap-1 rounded-sm bg-status-gold px-1.5 py-0.5 text-xs font-medium text-status-gold-foreground';
  return can(me, 'projects.read') ? (
    <KeyDateLink
      keyDate={keyDate}
      className={cn(
        className,
        'hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
      )}
    >
      {body}
    </KeyDateLink>
  ) : (
    <span className={className}>{body}</span>
  );
}

/**
 * An entry on a calendar day: a key date as a chip; a shoot or meeting as a card with its start
 * time first (a month cell has no room for the range; a long title is cut, never the time), its client, who leads or organizes it and the
 * conflict mark. Cancelled ones are dimmed.
 */
export function EntryCard({ entry, me }: { entry: CalendarEntry; me: MeResponse }) {
  const { t } = useTranslation();
  const clientLabel = useClientLabel();
  if (entry.kind === 'keyDate') return <KeyDateChip keyDate={entry.keyDate} me={me} />;
  if (entry.kind === 'meeting') {
    const { meeting } = entry;
    const cancelled = meeting.status === 'cancelled';
    return (
      <Link
        to="/meetings/$meetingId"
        params={{ meetingId: meeting.id }}
        data-meeting-status={meeting.status}
        className={cn(cardClass, cardLinkClass, cancelled && 'opacity-60')}
      >
        <span className="flex items-center gap-1 text-muted-foreground tabular-nums">
          <UsersRoundIcon
            role="img"
            aria-label={t('calendar.meeting')}
            className="size-3.5 shrink-0"
          />
          <span className="truncate">{formatTime(meeting.startsAt)}</span>
          {meeting.conflict && !cancelled && <ConflictBadge compact />}
        </span>
        <span className={cn('line-clamp-2 font-medium', cancelled && 'line-through')}>
          {meeting.title}
        </span>
        <span className="truncate text-muted-foreground">
          {[meeting.client && clientLabel(meeting.client), meeting.organizer.name]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </Link>
    );
  }
  const { shoot } = entry;
  const cancelled = shoot.status === 'cancelled';
  return (
    <Link
      to="/shoots/$shootId"
      params={{ shootId: shoot.id }}
      data-shoot-status={shoot.status}
      className={cn(cardClass, cardLinkClass, cancelled && 'opacity-60')}
    >
      <span className="flex items-center gap-1 text-muted-foreground tabular-nums">
        <ShootTypeIcon type={shoot.type} className="size-3.5" />
        <span className="truncate">{formatTime(shoot.startsAt)}</span>
        {shoot.conflict && !cancelled && <ConflictBadge compact />}
      </span>
      <span className={cn('line-clamp-2 font-medium', cancelled && 'line-through')}>
        {shoot.title}
      </span>
      <span className="truncate text-muted-foreground">
        {[clientLabel(shoot.client), shoot.lead.name].join(' · ')}
      </span>
    </Link>
  );
}

/**
 * Entries as rows: the agenda of the calendar on a phone and a day's list. Key dates first, as
 * on the grid.
 */
export function EntryRows({ entries, me }: { entries: CalendarEntry[]; me: MeResponse }) {
  const { t } = useTranslation();
  const clientLabel = useClientLabel();
  return (
    <ul className="flex flex-col divide-y divide-border">
      {entries.map((entry) => {
        if (entry.kind === 'keyDate') {
          return (
            <li key={entryKey(entry)} className="flex flex-col gap-1 px-4 py-3">
              <KeyDateChip keyDate={entry.keyDate} me={me} />
              <span className="truncate text-xs text-muted-foreground">
                {clientLabel(entry.keyDate.client)}
              </span>
            </li>
          );
        }
        const item = entry.kind === 'shoot' ? entry.shoot : entry.meeting;
        const person = entry.kind === 'shoot' ? entry.shoot.lead : entry.meeting.organizer;
        const cancelled = item.status === 'cancelled';
        const place = entry.kind === 'shoot' ? entry.shoot.location : entry.meeting.location;
        return (
          <li
            key={item.id}
            className={cn(
              'flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:gap-4',
              cancelled && 'opacity-60',
            )}
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-muted">
                {entry.kind === 'shoot' ? (
                  <ShootTypeIcon type={entry.shoot.type} />
                ) : (
                  <UsersRoundIcon
                    role="img"
                    aria-label={t('calendar.meeting')}
                    className="size-4 text-muted-foreground"
                  />
                )}
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <Link
                  {...(entry.kind === 'shoot'
                    ? { to: '/shoots/$shootId', params: { shootId: item.id } }
                    : { to: '/meetings/$meetingId', params: { meetingId: item.id } })}
                  className={cn(
                    'w-fit max-w-full truncate font-medium hover:underline',
                    cancelled && 'text-muted-foreground line-through',
                  )}
                >
                  {item.title}
                </Link>
                <span className="truncate text-xs text-muted-foreground">
                  {[clientLabel(item.client), place].filter(Boolean).join(' · ')}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-sm">
                <Avatar name={person.name} size="sm" tone={person.archived ? 'muted' : 'brand'} />
                {person.name}
              </span>
              {cancelled && (
                <Badge tone="outline" className="text-muted-foreground">
                  <BanIcon aria-hidden="true" />
                  {entry.kind === 'shoot'
                    ? t('calendar.shootStatuses.cancelled')
                    : t('calendar.meetingStatuses.cancelled')}
                </Badge>
              )}
              {item.conflict && !cancelled && <ConflictBadge />}
              <span className="text-sm tabular-nums">{formatTimeRange(item)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Rule 5: who is booked elsewhere at an overlapping time, each with the other booking. Shown
 * under the crew field while booking, in the confirmation before saving and on the shoot page.
 */
export function ConflictList({ conflicts }: { conflicts: ScheduleConflict[] }) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {conflicts.map((conflict) => (
        <li
          key={`${conflict.user.id}-${conflict.id}`}
          className="flex flex-col gap-0.5 rounded-md border border-border bg-surface px-3 py-2 text-foreground"
        >
          <span className="font-medium">
            {t(`calendar.conflicts.${conflict.kind}`, {
              name: conflict.user.name,
              title: conflict.title,
            })}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatWeekdayDate(calendarDay(conflict.startsAt))} · {formatTimeRange(conflict, true)}
          </span>
        </li>
      ))}
    </ul>
  );
}
