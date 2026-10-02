import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { calendarDay, type ShootDetail } from '@vertex-hub/contracts';
import { Badge, Button, Callout, Checkbox, cn, Skeleton, toast } from '@vertex-hub/ui';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowRightIcon,
  BanIcon,
  ExternalLinkIcon,
  HistoryIcon,
  MapPinIcon,
  PhoneIcon,
  StarIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { isMissing, LoadError } from '../../components/load-error';
import { can, useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { formatDateTime, formatLinkHost, formatNumber, formatWeekdayDate } from '../../lib/format';
import { PersonName } from '../projects/project-badges';
import { TaskStatusBadge } from '../tasks/task-badges';
import { TaskSection } from '../tasks/task-parts';
import { shootQuery, useRestoreShoot, useTickShot } from './calendar.queries';
import {
  ConflictBadge,
  ConflictList,
  formatTimeRange,
  ShootArchivedBadge,
  ShootStatusBadge,
  ShootTypeIcon,
  useClientLabel,
} from './calendar-parts';
import { ShootActions } from './shoot-actions';

/** A shoot (spec F11, screen 3): what, when, where, who, and the shot list the crew ticks. */
export function ShootPage({ shootId }: { shootId: string }) {
  const { t } = useTranslation();
  const shoot = useQuery(shootQuery(shootId));
  return (
    <>
      <div>
        <Button variant="ghost" size="sm" render={<Link to="/calendar" />}>
          <ArrowRightIcon className="ltr:-scale-x-100" />
          {t('calendar.shoot.back')}
        </Button>
      </div>
      {shoot.isPending ? (
        <PageSkeleton />
      ) : shoot.isError ? (
        <LoadError
          message={
            isMissing(shoot.error) ? t('calendar.shoot.notFound') : t('calendar.shoot.loadError')
          }
          onRetry={() => shoot.refetch()}
          error={shoot.error}
        />
      ) : (
        <ShootView shoot={shoot.data} />
      )}
    </>
  );
}

function ShootView({ shoot }: { shoot: ShootDetail }) {
  const { t } = useTranslation();
  return (
    <>
      <ShootHero shoot={shoot} />
      <Banners shoot={shoot} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <ShotsSection shoot={shoot} />
          <TaskSection title={t('calendar.shoot.brief')}>
            {shoot.brief ? (
              <p className="max-w-prose text-base whitespace-pre-line">{shoot.brief}</p>
            ) : (
              <p className="text-sm text-muted-foreground">{t('calendar.shoot.noBrief')}</p>
            )}
          </TaskSection>
          {shoot.status === 'completed' && <ClosingSection shoot={shoot} />}
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <CrewSection shoot={shoot} />
          <WorkSection shoot={shoot} />
        </div>
      </div>
    </>
  );
}

function ShootHero({ shoot }: { shoot: ShootDetail }) {
  const { t } = useTranslation();
  const clientLabel = useClientLabel();
  return (
    <section className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {shoot.client ? (
              <Link
                to="/clients/$clientId"
                params={{ clientId: shoot.client.id }}
                className="hover:text-foreground hover:underline"
              >
                {clientLabel(shoot.client)}
              </Link>
            ) : (
              t('calendar.internal')
            )}
          </p>
          <h1 className="text-2xl font-bold">{shoot.title}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <ShootStatusBadge status={shoot.status} />
            <Badge tone="outline">
              <ShootTypeIcon type={shoot.type} className="size-3.5" />
              {t(`calendar.shootTypes.${shoot.type}`)}
            </Badge>
            {shoot.conflict && <ConflictBadge />}
            {shoot.archivedAt && <ShootArchivedBadge />}
          </div>
        </div>
        <ShootActions shoot={shoot} />
      </div>
      <dl className="grid gap-4 border-t border-border pt-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Fact label={t('calendar.shoot.time')}>
          <span className="flex flex-col tabular-nums">
            <span className="font-medium">{formatWeekdayDate(calendarDay(shoot.startsAt))}</span>
            <span>{formatTimeRange(shoot, true)}</span>
          </span>
        </Fact>
        <Fact label={t('calendar.shoot.location')}>
          <span className="flex flex-col items-start gap-1">
            <span className="font-medium">{shoot.location}</span>
            {shoot.mapUrl && (
              <a
                href={shoot.mapUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-accent-text hover:underline"
              >
                <MapPinIcon aria-hidden="true" className="size-4" />
                {t('calendar.shoot.openMap')}
              </a>
            )}
          </span>
        </Fact>
        <Fact label={t('calendar.shoot.lead')}>
          <Link
            to="/team/$userId"
            params={{ userId: shoot.lead.id }}
            className="font-medium hover:underline"
          >
            <PersonName name={shoot.lead.name} archived={shoot.lead.archived} />
          </Link>
        </Fact>
        <Fact label={t('calendar.shoot.bookedBy')}>
          <span>
            {shoot.createdBy.name}
            <span className="block text-xs text-muted-foreground">
              {formatDateTime(shoot.createdAt)}
            </span>
          </span>
        </Fact>
      </dl>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** Archived, cancelled and double-booked shoots say so above everything else. */
function Banners({ shoot }: { shoot: ShootDetail }) {
  const { t } = useTranslation();
  if (shoot.archivedAt) return <ArchivedCallout shoot={shoot} />;
  if (shoot.status === 'cancelled') {
    return (
      <Callout
        tone="danger"
        icon={<BanIcon />}
        title={
          shoot.cancelledAt
            ? t('calendar.shoot.cancelledTitle', { date: formatDateTime(shoot.cancelledAt) })
            : t('calendar.shootStatuses.cancelled')
        }
        description={
          shoot.cancelReason
            ? t('calendar.shoot.cancelReason', { reason: shoot.cancelReason })
            : undefined
        }
      />
    );
  }
  if (shoot.conflicts.length === 0) return null;
  return (
    <Callout
      tone="warning"
      icon={<TriangleAlertIcon />}
      title={t('calendar.form.conflictsTitle')}
      description={t('calendar.shoot.conflictsBody')}
      className="sm:flex-col sm:items-stretch"
      action={<ConflictList conflicts={shoot.conflicts} />}
    />
  );
}

function ArchivedCallout({ shoot }: { shoot: ShootDetail }) {
  const { t } = useTranslation();
  const restore = useRestoreShoot(shoot.id);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Callout
        icon={<ArchiveIcon />}
        title={t('calendar.shoot.archivedTitle')}
        description={t('calendar.shoot.archivedBody')}
        action={
          shoot.permissions.canArchive && (
            <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
              <ArchiveRestoreIcon />
              {t('calendar.actions.restore')}
            </Button>
          )
        }
      />
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('calendar.restore.title', { title: shoot.title })}
        body={t('calendar.restore.body')}
        action={t('calendar.actions.restore')}
        pending={restore.isPending}
        onConfirm={async () => {
          await restore.mutateAsync(undefined);
          toast.add({ title: t('calendar.restore.done'), type: 'success' });
        }}
      />
    </>
  );
}

/**
 * Rule 7: the shot list, ticked by the crew on the day. Rows are tall enough to hit with a thumb;
 * the list is read-only once the shoot is closed or cancelled.
 */
function ShotsSection({ shoot }: { shoot: ShootDetail }) {
  const { t } = useTranslation();
  const tick = useTickShot(shoot.id);
  const { canTick } = shoot.permissions;
  const done = shoot.shots.filter((shot) => shot.doneAt !== null).length;

  async function set(shotId: string, checked: boolean) {
    try {
      await tick.mutateAsync({ shotId, done: checked });
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  }

  return (
    <TaskSection
      title={t('calendar.shoot.shots')}
      count={
        shoot.shots.length > 0
          ? t('calendar.shoot.shotsCount', {
              done: formatNumber(done),
              total: formatNumber(shoot.shots.length),
            })
          : undefined
      }
    >
      {shoot.shots.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('calendar.shoot.noShots')}</p>
      ) : (
        <ol className="flex flex-col divide-y divide-border">
          {shoot.shots.map((shot) => {
            const ticked = shot.doneAt !== null;
            return (
              <li key={shot.id}>
                <label
                  htmlFor={`shot-${shot.id}`}
                  className={cn(
                    'flex min-h-14 items-center gap-4 px-1 py-2',
                    canTick && 'cursor-pointer hover:bg-muted/50',
                  )}
                >
                  <Checkbox
                    id={`shot-${shot.id}`}
                    className="size-7 [&_svg]:size-5"
                    checked={ticked}
                    disabled={!canTick || tick.isPending}
                    onCheckedChange={(checked) => set(shot.id, checked)}
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span
                      className={cn(
                        'text-base font-medium',
                        ticked && 'text-muted-foreground line-through',
                      )}
                    >
                      {shot.text}
                    </span>
                    {shot.note && (
                      <span className="text-sm text-muted-foreground">{shot.note}</span>
                    )}
                    {shot.doneBy && (
                      <span className="text-xs text-muted-foreground">
                        {t('calendar.shoot.shotDoneBy', { name: shot.doneBy.name })}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ol>
      )}
    </TaskSection>
  );
}

/** What closing recorded: who closed it, the note and where the raw footage is. */
function ClosingSection({ shoot }: { shoot: ShootDetail }) {
  const { t } = useTranslation();
  return (
    <TaskSection title={t('calendar.shoot.closing')}>
      {shoot.completedAt && (
        <p className="text-sm text-muted-foreground">
          {t('calendar.shoot.closedBy', {
            name: shoot.completedBy?.name ?? t('common.none'),
            date: formatDateTime(shoot.completedAt),
          })}
        </p>
      )}
      {shoot.closeNote && (
        <p className="max-w-prose text-base whitespace-pre-line">{shoot.closeNote}</p>
      )}
      {shoot.rawFilesUrl && (
        <div>
          <Button
            variant="outline"
            size="sm"
            render={<a href={shoot.rawFilesUrl} target="_blank" rel="noreferrer" />}
          >
            <ExternalLinkIcon />
            {t('calendar.shoot.rawFiles', { host: formatLinkHost(shoot.rawFilesUrl) })}
          </Button>
        </div>
      )}
    </TaskSection>
  );
}

function CrewSection({ shoot }: { shoot: ShootDetail }) {
  const { t } = useTranslation();
  return (
    <TaskSection title={t('calendar.shoot.crew')}>
      <ul className="flex flex-col gap-3 text-sm">
        {shoot.crew.map((member) => (
          <li key={member.user.id} className="flex items-center justify-between gap-3">
            <Link
              to="/team/$userId"
              params={{ userId: member.user.id }}
              className="min-w-0 font-medium hover:underline"
            >
              <PersonName name={member.user.name} archived={member.user.archived} />
            </Link>
            <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
              {t(`calendar.crewRoles.${member.role}`)}
              {member.isLead && (
                <Badge tone="gold">
                  <StarIcon aria-hidden="true" />
                  {t('calendar.form.lead')}
                </Badge>
              )}
            </span>
          </li>
        ))}
      </ul>
      {shoot.externalCrew.length > 0 && (
        <>
          <h3 className="border-t border-border pt-3 text-sm font-medium text-muted-foreground">
            {t('calendar.shoot.externalCrew')}
          </h3>
          <ul className="flex flex-col gap-3 text-sm">
            {shoot.externalCrew.map((member) => (
              <li
                key={`${member.name}-${member.role}`}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
              >
                <span className="flex flex-col">
                  <span className="font-medium">{member.name}</span>
                  <span className="text-muted-foreground">
                    {t(`calendar.crewRoles.${member.role}`)}
                  </span>
                </span>
                {member.phone && (
                  <Button variant="outline" size="sm" render={<a href={`tel:${member.phone}`} />}>
                    <PhoneIcon />
                    <span dir="ltr" className="tabular-nums">
                      {member.phone}
                    </span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </TaskSection>
  );
}

/** The shoot task, the editing task closing created, and the audit trail for those who read it. */
function WorkSection({ shoot }: { shoot: ShootDetail }) {
  const { t } = useTranslation();
  const me = useMe();
  const tasks = [
    { label: t('calendar.shoot.shootTask'), task: shoot.task },
    ...(shoot.editingTask
      ? [{ label: t('calendar.shoot.editingTask'), task: shoot.editingTask }]
      : []),
  ];
  return (
    <TaskSection
      title={t('calendar.shoot.work')}
      action={
        can(me, 'audit.read') && (
          <Button
            variant="ghost"
            size="sm"
            render={<Link to="/audit" search={{ entityId: shoot.id }} />}
          >
            <HistoryIcon />
            {t('calendar.shoot.auditTrail')}
          </Button>
        )
      }
    >
      <ul className="flex flex-col gap-3 text-sm">
        {tasks.map(({ label, task }) => (
          <li key={task.id} className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className="flex flex-wrap items-center justify-between gap-2">
              <Link
                to="/tasks/$taskId"
                params={{ taskId: task.id }}
                className="min-w-0 truncate font-medium hover:underline"
              >
                {task.title}
              </Link>
              <TaskStatusBadge status={task.status} />
            </span>
          </li>
        ))}
      </ul>
    </TaskSection>
  );
}

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-6 w-56" />
        <div className="grid gap-4 border-t border-border pt-5 sm:grid-cols-4">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
