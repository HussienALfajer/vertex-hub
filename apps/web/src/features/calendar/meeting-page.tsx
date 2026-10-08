import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  CALENDAR_LIMITS,
  calendarDay,
  cancelMeetingSchema,
  type MeetingDetail,
  type MeetingStatus,
} from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Callout,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  FieldError,
  FieldLabel,
  Skeleton,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from '@vertex-hub/ui';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowRightIcon,
  BanIcon,
  EllipsisIcon,
  HistoryIcon,
  PencilIcon,
  PhoneIcon,
  TriangleAlertIcon,
  VideoIcon,
} from 'lucide-react';
import { type ReactNode, type RefObject, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { isMissing, LoadError } from '../../components/load-error';
import { can, useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { formatDateTime, formatLinkHost, formatNumber, formatWeekdayDate } from '../../lib/format';
import { type ReturnFocus, useReturnFocus } from '../../lib/use-return-focus';
import { PersonName } from '../projects/project-badges';
import { TaskSection } from '../tasks/task-parts';
import {
  meetingQuery,
  useArchiveMeeting,
  useCancelMeeting,
  useRestoreMeeting,
} from './calendar.queries';
import { ConflictBadge, ConflictList, formatTimeRange, useClientLabel } from './calendar-parts';
import { MeetingDialog } from './meeting-dialog';

/** A meeting (spec F11, screen 6): when, where, who attends, and what it is about. */
export function MeetingPage({ meetingId }: { meetingId: string }) {
  const { t } = useTranslation();
  const meeting = useQuery(meetingQuery(meetingId));
  return (
    <>
      <div>
        <Button variant="ghost" size="sm" render={<Link to="/calendar" />}>
          <ArrowRightIcon className="ltr:-scale-x-100" />
          {t('calendar.shoot.back')}
        </Button>
      </div>
      {meeting.isPending ? (
        <PageSkeleton />
      ) : meeting.isError ? (
        <LoadError
          message={
            isMissing(meeting.error)
              ? t('calendar.meetings.notFound')
              : t('calendar.meetings.loadError')
          }
          onRetry={() => meeting.refetch()}
          error={meeting.error}
        />
      ) : (
        <MeetingView meeting={meeting.data} />
      )}
    </>
  );
}

export function MeetingStatusBadge({ status }: { status: MeetingStatus }) {
  const { t } = useTranslation();
  if (status === 'cancelled') {
    return (
      <Badge tone="outline" data-status={status} className="text-muted-foreground">
        <BanIcon aria-hidden="true" />
        {t('calendar.meetingStatuses.cancelled')}
      </Badge>
    );
  }
  return (
    <Badge tone="info" data-status={status}>
      {t('calendar.meetingStatuses.scheduled')}
    </Badge>
  );
}

function MeetingView({ meeting }: { meeting: MeetingDetail }) {
  const { t } = useTranslation();
  const me = useMe();
  // Cancelling, archiving and restoring take their own button off the page.
  const heading = useRef<HTMLHeadingElement>(null);
  const returnFocus = useReturnFocus(heading);
  return (
    <>
      <MeetingHero meeting={meeting} heading={heading} returnFocus={returnFocus} />
      <Banners meeting={meeting} returnFocus={returnFocus} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <TaskSection
            title={t('calendar.meetings.agenda')}
            action={
              can(me, 'audit.read') && (
                <Button
                  variant="ghost"
                  size="sm"
                  render={<Link to="/audit" search={{ entityId: meeting.id }} />}
                >
                  <HistoryIcon />
                  {t('calendar.shoot.auditTrail')}
                </Button>
              )
            }
          >
            {meeting.agenda ? (
              <p className="max-w-prose text-base whitespace-pre-line">{meeting.agenda}</p>
            ) : (
              <p className="text-sm text-muted-foreground">{t('calendar.meetings.noAgenda')}</p>
            )}
          </TaskSection>
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <AttendeesSection meeting={meeting} />
          {meeting.client && <ContactsSection meeting={meeting} />}
        </div>
      </div>
    </>
  );
}

function MeetingHero({
  meeting,
  heading,
  returnFocus,
}: {
  meeting: MeetingDetail;
  heading: RefObject<HTMLHeadingElement | null>;
  returnFocus: ReturnFocus;
}) {
  const { t } = useTranslation();
  const clientLabel = useClientLabel();
  return (
    <section className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {meeting.client ? (
              <Link
                to="/clients/$clientId"
                params={{ clientId: meeting.client.id }}
                className="hover:text-foreground hover:underline"
              >
                {clientLabel(meeting.client)}
              </Link>
            ) : (
              t('calendar.internal')
            )}
          </p>
          <h1 ref={heading} tabIndex={-1} className="text-2xl font-bold wrap-anywhere">
            {meeting.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <MeetingStatusBadge status={meeting.status} />
            {meeting.conflict && <ConflictBadge />}
            {meeting.archivedAt && (
              <Badge tone="neutral">
                <ArchiveIcon aria-hidden="true" />
                {t('calendar.meetings.archived')}
              </Badge>
            )}
          </div>
        </div>
        <MeetingActions meeting={meeting} returnFocus={returnFocus} />
      </div>
      <dl className="grid gap-4 border-t border-border pt-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Fact label={t('calendar.shoot.time')}>
          <span className="flex flex-col tabular-nums">
            <span className="font-medium">{formatWeekdayDate(calendarDay(meeting.startsAt))}</span>
            <span>{formatTimeRange(meeting, true)}</span>
          </span>
        </Fact>
        <Fact label={t('calendar.shoot.location')}>
          {meeting.location ? (
            <span className="font-medium">{meeting.location}</span>
          ) : (
            <span className="text-muted-foreground">
              {meeting.onlineUrl ? t('calendar.meetings.online') : t('common.none')}
            </span>
          )}
        </Fact>
        <Fact label={t('calendar.meetings.organizer')}>
          <Link
            to="/team/$userId"
            params={{ userId: meeting.organizer.id }}
            className="font-medium hover:underline"
          >
            <PersonName name={meeting.organizer.name} archived={meeting.organizer.archived} />
          </Link>
        </Fact>
        <Fact label={t('calendar.meetings.createdBy')}>
          <span>
            {meeting.createdBy.name}
            <span className="block text-xs text-muted-foreground">
              {formatDateTime(meeting.createdAt)}
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

type Open = 'edit' | 'cancel' | 'archive' | null;

/** The online link for everyone, then what the caller may do, from the server's answer. */
function MeetingActions({
  meeting,
  returnFocus,
}: {
  meeting: MeetingDetail;
  returnFocus: ReturnFocus;
}) {
  const { t } = useTranslation();
  const [open, setOpenState] = useState<Open>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const setOpen = (next: Exclude<Open, null>, opener: HTMLElement | null) => {
    returnFocus.from(opener);
    setOpenState(next);
  };
  const close = () => setOpenState(null);
  const archive = useArchiveMeeting(meeting.id);
  const { canEdit, canCancel, canArchive } = meeting.permissions;
  const archived = meeting.archivedAt !== null;
  const menu = canCancel || (canArchive && !archived);
  const joinable = meeting.onlineUrl && meeting.status === 'scheduled' && !archived;
  // The dialogs outlive the buttons: a cancelled meeting has none left, and its dialog still
  // fades out and gives the focus to the heading.
  const buttons = joinable || canEdit || menu;

  return (
    <>
      {buttons && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {meeting.onlineUrl && joinable && (
            <Button render={<a href={meeting.onlineUrl} target="_blank" rel="noreferrer" />}>
              <VideoIcon />
              {t('calendar.meetings.join', { host: formatLinkHost(meeting.onlineUrl) })}
            </Button>
          )}
          {canEdit && (
            <Button variant="outline" onClick={(event) => setOpen('edit', event.currentTarget)}>
              <PencilIcon />
              {t('calendar.meetings.actions.edit')}
            </Button>
          )}
          {menu && (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <DropdownMenuTrigger
                      render={
                        <Button
                          ref={menuButton}
                          variant="outline"
                          size="icon"
                          aria-label={t('calendar.actions.more')}
                        />
                      }
                    />
                  }
                >
                  <EllipsisIcon />
                </TooltipTrigger>
                <TooltipContent>{t('calendar.actions.more')}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                {canCancel && (
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setOpen('cancel', menuButton.current)}
                  >
                    <BanIcon />
                    {t('calendar.meetings.actions.cancel')}
                  </DropdownMenuItem>
                )}
                {canArchive && !archived && (
                  <>
                    {canCancel && <DropdownMenuSeparator />}
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setOpen('archive', menuButton.current)}
                    >
                      <ArchiveIcon />
                      {t('calendar.meetings.actions.archive')}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
      <MeetingDialog
        meeting={meeting}
        open={open === 'edit'}
        onClose={close}
        finalFocus={returnFocus.target}
      />
      <CancelDialog
        meeting={meeting}
        open={open === 'cancel'}
        onClose={close}
        finalFocus={returnFocus.target}
      />
      <ConfirmDialog
        open={open === 'archive'}
        onClose={close}
        finalFocus={returnFocus.target}
        title={t('calendar.meetings.archive.title', { title: meeting.title })}
        body={t('calendar.meetings.archive.body')}
        action={t('calendar.meetings.actions.archive')}
        destructive
        pending={archive.isPending}
        onConfirm={async () => {
          await archive.mutateAsync(undefined);
          toast.add({ title: t('calendar.meetings.archive.done'), type: 'success' });
        }}
      />
    </>
  );
}

/** Rule 14: cancelling is final; the reason is optional. */
function CancelDialog({
  meeting,
  open,
  onClose,
  finalFocus,
}: {
  meeting: MeetingDetail;
  open: boolean;
  onClose: () => void;
  finalFocus: () => HTMLElement | null;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')} finalFocus={finalFocus}>
        {/* Unmounted once the dialog has faded out. */}
        <CancelForm meeting={meeting} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

function CancelForm({ meeting, onClose }: { meeting: MeetingDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const cancel = useCancelMeeting(meeting.id);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function submit() {
    setProblem(null);
    setFailure(null);
    const input = cancelMeetingSchema.safeParse({ reason });
    if (!input.success) {
      setProblem(t('calendar.meetings.cancel.errors.reason'));
      return;
    }
    try {
      await cancel.mutateAsync(input.data);
      toast.add({ title: t('calendar.meetings.cancel.done'), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <form
      className="grid gap-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('calendar.meetings.cancel.title', { title: meeting.title })}</DialogTitle>
        <DialogDescription>{t('calendar.meetings.cancel.body')}</DialogDescription>
      </DialogHeader>
      <Field invalid={!!problem}>
        <FieldLabel>
          {t('calendar.cancel.reason')}
          <span className="ms-1 font-normal text-muted-foreground">({t('common.optional')})</span>
        </FieldLabel>
        <Textarea
          rows={3}
          maxLength={CALENDAR_LIMITS.cancelReason}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <FieldError match={!!problem}>{problem}</FieldError>
      </Field>
      {failure && <FormAlert>{failure}</FormAlert>}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>{t('common.cancel')}</DialogClose>
        <Button type="submit" variant="destructive" disabled={cancel.isPending}>
          {t('calendar.meetings.actions.cancel')}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Archived, cancelled and double-booked meetings say so above everything else. */
function Banners({ meeting, returnFocus }: { meeting: MeetingDetail; returnFocus: ReturnFocus }) {
  const { t } = useTranslation();
  if (meeting.archivedAt) return <ArchivedCallout meeting={meeting} returnFocus={returnFocus} />;
  if (meeting.status === 'cancelled') {
    return (
      <Callout
        tone="danger"
        icon={<BanIcon />}
        title={
          meeting.cancelledAt
            ? t('calendar.meetings.cancelledTitle', { date: formatDateTime(meeting.cancelledAt) })
            : t('calendar.meetingStatuses.cancelled')
        }
        description={
          meeting.cancelReason
            ? t('calendar.shoot.cancelReason', { reason: meeting.cancelReason })
            : undefined
        }
      />
    );
  }
  if (meeting.conflicts.length === 0) return null;
  return (
    <Callout
      tone="warning"
      icon={<TriangleAlertIcon />}
      title={t('calendar.form.conflictsTitle')}
      description={t('calendar.meetings.conflictsBody')}
      className="sm:flex-col sm:items-stretch"
      action={<ConflictList conflicts={meeting.conflicts} />}
    />
  );
}

function ArchivedCallout({
  meeting,
  returnFocus,
}: {
  meeting: MeetingDetail;
  returnFocus: ReturnFocus;
}) {
  const { t } = useTranslation();
  const restore = useRestoreMeeting(meeting.id);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Callout
        icon={<ArchiveIcon />}
        title={t('calendar.meetings.archivedTitle')}
        description={t('calendar.meetings.archivedBody')}
        action={
          meeting.permissions.canArchive && (
            <Button
              variant="outline"
              size="sm"
              onClick={(event) => {
                returnFocus.from(event.currentTarget);
                setConfirming(true);
              }}
            >
              <ArchiveRestoreIcon />
              {t('calendar.meetings.actions.restore')}
            </Button>
          )
        }
      />
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        finalFocus={returnFocus.target}
        title={t('calendar.meetings.restore.title', { title: meeting.title })}
        body={t('calendar.meetings.restore.body')}
        action={t('calendar.meetings.actions.restore')}
        pending={restore.isPending}
        onConfirm={async () => {
          await restore.mutateAsync(undefined);
          toast.add({ title: t('calendar.meetings.restore.done'), type: 'success' });
        }}
      />
    </>
  );
}

/** The organizer first, who attends without being listed (rule 14), then the attendees. */
function AttendeesSection({ meeting }: { meeting: MeetingDetail }) {
  const { t } = useTranslation();
  const people = [
    { ...meeting.organizer, organizer: true },
    ...meeting.attendees.map((attendee) => ({ ...attendee, organizer: false })),
  ];
  return (
    <TaskSection title={t('calendar.meetings.attendees')} count={formatNumber(people.length)}>
      <ul className="flex flex-col gap-3 text-sm">
        {people.map((person) => (
          <li key={person.id} className="flex items-center justify-between gap-3">
            <Link
              to="/team/$userId"
              params={{ userId: person.id }}
              className="min-w-0 font-medium hover:underline"
            >
              <PersonName name={person.name} archived={person.archived} />
            </Link>
            {person.organizer && <Badge tone="gold">{t('calendar.meetings.organizer')}</Badge>}
          </li>
        ))}
      </ul>
    </TaskSection>
  );
}

/** The client's people in the meeting, one tap away from a call. */
function ContactsSection({ meeting }: { meeting: MeetingDetail }) {
  const { t } = useTranslation();
  return (
    <TaskSection title={t('calendar.meetings.contacts')}>
      {meeting.contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('calendar.meetings.noContacts')}</p>
      ) : (
        <ul className="flex flex-col gap-3 text-sm">
          {meeting.contacts.map((contact) => (
            <li
              key={contact.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
            >
              <PersonName name={contact.name} archived={contact.archived} />
              {contact.phone && (
                <Button variant="outline" size="sm" render={<a href={`tel:${contact.phone}`} />}>
                  <PhoneIcon />
                  <span dir="ltr" className="tabular-nums">
                    {contact.phone}
                  </span>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
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
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}
