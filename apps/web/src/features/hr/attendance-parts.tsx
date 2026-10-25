import type {
  AttendanceDayStatus,
  AttendanceGreeting,
  AttendanceItemStatus,
  AttendancePunch,
} from '@vertex-hub/contracts';
import { Avatar, Badge, type BadgeProps } from '@vertex-hub/ui';
import type { TFunction } from 'i18next';
import { LogInIcon, LogOutIcon, MapPinIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber, formatTime } from '../../lib/format';

type Tone = NonNullable<BadgeProps['tone']>;

export const dayTone = {
  upcoming: 'outline',
  in_progress: 'info',
  present: 'success',
  partial: 'warning',
  absent: 'danger',
  leave: 'info',
  holiday: 'brand',
  off: 'neutral',
  trial: 'gold',
} as const satisfies Record<AttendanceDayStatus, Tone>;

export function DayStatusBadge({ status }: { status: AttendanceDayStatus }) {
  const { t } = useTranslation();
  return (
    <Badge tone={dayTone[status]} data-status={status}>
      {t(`hr.attendance.dayStatuses.${status}`)}
    </Badge>
  );
}

const itemTone = {
  pending: 'warning',
  deducted: 'danger',
  waived: 'success',
  warned: 'gold',
  paid: 'success',
  time_off: 'info',
  rejected: 'neutral',
  void: 'outline',
} as const satisfies Record<AttendanceItemStatus, Tone>;

export function ItemStatusBadge({ status }: { status: AttendanceItemStatus }) {
  const { t } = useTranslation();
  return (
    <Badge tone={itemTone[status]} data-status={status}>
      {t(`hr.items.statuses.${status}`)}
    </Badge>
  );
}

/** "2 س 15 د", "45 د", "3 س". */
export function durationText(t: TFunction, minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return t('hr.attendance.duration.minutes', { minutes: formatNumber(rest) });
  if (rest === 0) return t('hr.attendance.duration.hours', { hours: formatNumber(hours) });
  return t('hr.attendance.duration.both', {
    hours: formatNumber(hours),
    minutes: formatNumber(rest),
  });
}

/** A point in the phone's maps app (the CSP allows no map tiles on the page). */
export function mapsUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

export function MapLink({ latitude, longitude }: { latitude: number; longitude: number }) {
  const { t } = useTranslation();
  return (
    <a
      href={mapsUrl(latitude, longitude)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
    >
      <MapPinIcon aria-hidden="true" className="size-3.5" />
      {t('hr.attendance.openInMaps')}
    </a>
  );
}

/** Rule C20: the greeting after a punch, on the phone and, larger, on the entrance screen. */
export function GreetingView({
  greeting,
  large = false,
}: {
  greeting: AttendanceGreeting;
  large?: boolean;
}) {
  const { t } = useTranslation();
  const arriving = greeting.direction === 'in';
  return (
    <div
      role="status"
      data-testid="attendance-greeting"
      className="flex flex-col items-center gap-3 text-center"
    >
      {/* F01C rule 15: the photo comes inside the greeting, as the screen has no session. */}
      <Avatar
        name={greeting.firstName}
        src={greeting.photo}
        size="xl"
        className={large ? 'size-32 text-4xl' : undefined}
      />
      <p className={large ? 'text-4xl font-bold' : 'text-2xl font-bold'}>
        {arriving
          ? t(`hr.attendance.greeting.${greeting.partOfDay ?? 'morning'}`, {
              name: greeting.firstName,
            })
          : t('hr.attendance.greeting.goodbye', { name: greeting.firstName })}
      </p>
      <p className={large ? 'text-3xl text-muted-foreground' : 'text-muted-foreground'}>
        {arriving
          ? [
              t('hr.attendance.greeting.tasks', {
                count: greeting.tasksDueToday ?? 0,
                tasks: formatNumber(greeting.tasksDueToday ?? 0),
              }),
              greeting.firstEventAt &&
                t('hr.attendance.greeting.firstEvent', { time: formatTime(greeting.firstEventAt) }),
            ]
              .filter(Boolean)
              .join(' · ')
          : t('hr.attendance.greeting.worked', {
              duration: durationText(t, greeting.workedMinutes ?? 0),
            })}
      </p>
    </div>
  );
}

/** What a punch was made with: the screen, the shoot, the field note and its task or meeting. */
function punchDetail(t: TFunction, punch: AttendancePunch): string {
  const parts = [t(`hr.attendance.methods.${punch.method}`)];
  if (punch.kioskName) parts.push(punch.kioskName);
  if (punch.shoot) parts.push(`${punch.shoot.title} · ${punch.shoot.location}`);
  if (punch.fieldWork) parts.push(punch.fieldWork.title);
  if (punch.fieldNote) parts.push(punch.fieldNote);
  return parts.join(' · ');
}

/**
 * A day's punches in time order (the spec's day timeline): time, direction, method and place,
 * the location as a maps link, rejected ones struck through. `action` adds a button per punch.
 */
export function PunchTimeline({
  punches,
  action,
}: {
  punches: readonly AttendancePunch[];
  action?: (punch: AttendancePunch) => ReactNode;
}) {
  const { t } = useTranslation();
  if (punches.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('hr.attendance.noPunches')}</p>;
  }
  return (
    <ol className="flex flex-col gap-2" aria-label={t('hr.attendance.punches')}>
      {punches.map((punch) => {
        const rejected = !!punch.archivedAt;
        const Icon = punch.direction === 'in' ? LogInIcon : LogOutIcon;
        return (
          <li
            key={punch.id}
            data-punch={punch.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border p-2"
          >
            <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span className="font-medium tabular-nums">{formatTime(punch.at)}</span>
            <span className="text-sm">{t(`hr.attendance.directions.${punch.direction}`)}</span>
            <span
              className={
                rejected
                  ? 'min-w-0 flex-1 text-sm text-muted-foreground line-through'
                  : 'min-w-0 flex-1 text-sm text-muted-foreground'
              }
            >
              {punchDetail(t, punch)}
            </span>
            {rejected && <Badge tone="danger">{t('hr.attendance.rejected')}</Badge>}
            {punch.latitude !== null && punch.longitude !== null && (
              <MapLink latitude={punch.latitude} longitude={punch.longitude} />
            )}
            {action?.(punch)}
          </li>
        );
      })}
    </ol>
  );
}
