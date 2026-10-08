import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { LeadDetail, LeadNote, LeadStage, MANUAL_LEAD_STAGES } from '@vertex-hub/contracts';
import {
  AscentLines,
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from '@vertex-hub/ui';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowRightIcon,
  CalendarClockIcon,
  CircleCheckBigIcon,
  CircleXIcon,
  EllipsisIcon,
  FileTextIcon,
  MailIcon,
  MessageCircleIcon,
  MessagesSquareIcon,
  MoveIcon,
  PencilIcon,
  PhoneIcon,
  PlusIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  UserRoundCogIcon,
} from 'lucide-react';
import { type ReactNode, type RefObject, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { isMissing, LoadError } from '../../components/load-error';
import { can, useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import {
  businessDay,
  formatCalendarDate,
  formatDate,
  formatNumber,
  formatTime,
} from '../../lib/format';
import { useReturnFocus } from '../../lib/use-return-focus';
import { useShownWhileClosing } from '../../lib/use-shown-while-closing';
import { HealthcareBadge } from '../clients/client-badges';
import { channelIcon } from '../clients/communication-tab';
import { NewQuoteDialog } from '../quotes/new-quote-dialog';
import { Money, QuoteStatusBadge } from '../quotes/quote-badges';
import { leadQuotesQuery } from '../quotes/quotes.queries';
import { Budget, FollowUpDate, LeadStageBadge, SourceMark } from './lead-badges';
import { LeadDialog } from './lead-dialog';
import {
  ConvertDialog,
  FollowUpDialog,
  LoseDialog,
  NoteDialog,
  OwnerDialog,
  ReopenDialog,
} from './lead-dialogs';
import {
  leadQuery,
  useArchiveLead,
  useArchiveLeadNote,
  useMoveLead,
  useRestoreLead,
} from './leads.queries';
import { ArchiveConfirm } from './leads-page';

/** WhatsApp opens a chat from the international number without the plus sign. */
const whatsappUrl = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '')}`;

type Open =
  | 'edit'
  | 'note'
  | 'quote'
  | 'convert'
  | 'lose'
  | 'reopen'
  | 'owner'
  | 'followUp'
  | 'archive'
  | 'restore';

/** Spec screen 3. */
export function LeadPage({ leadId }: { leadId: string }) {
  const { t } = useTranslation();
  const lead = useQuery(leadQuery(leadId));
  return (
    <>
      <div>
        <Button variant="ghost" size="sm" render={<Link to="/leads" />}>
          <ArrowRightIcon className="ltr:-scale-x-100" />
          {t('leads.page.back')}
        </Button>
      </div>
      {lead.isPending ? (
        <PageSkeleton />
      ) : lead.isError ? (
        <LoadError
          message={isMissing(lead.error) ? t('leads.page.notFound') : t('leads.page.loadError')}
          onRetry={() => lead.refetch()}
          error={lead.error}
        />
      ) : (
        <LeadView lead={lead.data} />
      )}
    </>
  );
}

function LeadView({ lead }: { lead: LeadDetail }) {
  const { t } = useTranslation();
  const [open, setOpenState] = useState<Open | null>(null);
  const [editingNote, setEditingNote] = useState<LeadNote | null>(null);
  // The edited note stays while its dialog fades out, so the title does not turn to "log".
  const shownNote = useShownWhileClosing(editingNote);
  const [archivingNote, setArchivingNote] = useState<LeadNote | null>(null);
  const archive = useArchiveLead();
  const restore = useRestoreLead();
  const archiveNote = useArchiveLeadNote(lead.id);
  const heading = useRef<HTMLHeadingElement>(null);
  const returnFocus = useReturnFocus(heading);
  const logActivity = useRef<HTMLButtonElement>(null);
  const setOpen = (next: Open, opener: HTMLElement | null) => {
    returnFocus.from(opener);
    setOpenState(next);
  };
  const close = () => setOpenState(null);
  const dialog = { onClose: close, finalFocus: returnFocus.target };
  const archived = lead.archivedAt !== null;

  return (
    <>
      <Header lead={lead} onOpen={setOpen} heading={heading} />

      {archived ? (
        <Callout
          icon={<ArchiveIcon />}
          title={t('leads.page.archivedTitle')}
          description={t('leads.page.archivedBody')}
          action={
            lead.permissions.canRestore && (
              <Button
                variant="outline"
                size="sm"
                onClick={(event) => setOpen('restore', event.currentTarget)}
              >
                <ArchiveRestoreIcon />
                {t('leads.actions.restore')}
              </Button>
            )
          }
        />
      ) : lead.stage === 'won' && lead.client ? (
        <Callout
          tone="info"
          icon={<CircleCheckBigIcon />}
          title={t('leads.page.wonTitle', { name: lead.client.name })}
          description={t('leads.page.wonBody', {
            date: lead.closedAt ? formatDate(lead.closedAt) : '',
            name: lead.convertedBy?.name ?? '',
          })}
          action={
            <Button
              variant="outline"
              size="sm"
              render={<Link to="/clients/$clientId" params={{ clientId: lead.client.id }} />}
            >
              {t('leads.page.openClient')}
            </Button>
          }
        />
      ) : lead.stage === 'lost' ? (
        <Callout
          tone="danger"
          icon={<CircleXIcon />}
          title={t('leads.page.lostTitle', {
            reason: lead.lostReason ? t(`leads.lossReasons.${lead.lostReason}`) : '',
          })}
          description={lead.lostNote ?? t('leads.page.lostNoNote')}
          action={
            lead.permissions.canReopen && (
              <Button
                variant="outline"
                size="sm"
                onClick={(event) => setOpen('reopen', event.currentTarget)}
              >
                <RotateCcwIcon />
                {t('leads.actions.reopen')}
              </Button>
            )
          }
        />
      ) : null}

      {!lead.ownerCanManage && (
        <Callout
          tone="warning"
          icon={<ShieldAlertIcon />}
          title={t('leads.page.ownerCannotManage', { name: lead.owner.name })}
          description={t('leads.page.ownerCannotManageHint')}
        />
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <ActivitySection
            lead={lead}
            logButton={logActivity}
            onLog={(opener) => setOpen('note', opener)}
            onEdit={setEditingNote}
            onArchive={setArchivingNote}
          />
          <QuotesSection lead={lead} onNew={(opener) => setOpen('quote', opener)} />
        </div>
        <div className="flex flex-col gap-6">
          <ContactSection lead={lead} />
          <RequestSection lead={lead} />
        </div>
      </div>

      <LeadDialog open={open === 'edit'} {...dialog} lead={lead} />
      <NoteDialog lead={lead} open={open === 'note'} {...dialog} />
      {shownNote && (
        <NoteDialog
          lead={lead}
          note={shownNote}
          open={editingNote !== null}
          onClose={() => setEditingNote(null)}
        />
      )}
      <ConvertDialog lead={lead} open={open === 'convert'} {...dialog} />
      <LoseDialog lead={lead} open={open === 'lose'} {...dialog} />
      <ReopenDialog lead={lead} open={open === 'reopen'} {...dialog} />
      <OwnerDialog lead={lead} open={open === 'owner'} {...dialog} />
      <FollowUpDialog lead={lead} open={open === 'followUp'} {...dialog} />
      {lead.permissions.canNewQuote && (
        <NewQuoteDialog open={open === 'quote'} onClose={close} leadId={lead.id} />
      )}
      <ArchiveConfirm
        target={
          open === 'archive' || open === 'restore' ? { lead, restore: open === 'restore' } : null
        }
        {...dialog}
        pending={archive.isPending || restore.isPending}
        onConfirm={async (target) => {
          if (target.restore) await restore.mutateAsync(lead.id);
          else await archive.mutateAsync(lead.id);
        }}
      />
      <ConfirmDialog
        open={archivingNote !== null}
        onClose={() => setArchivingNote(null)}
        title={t('leads.activity.archiveTitle')}
        body={t('leads.activity.archiveBody')}
        action={t('leads.activity.archiveAction')}
        destructive
        pending={archiveNote.isPending}
        // The note's menu leaves with it: the focus goes to "log activity" above the list.
        finalFocus={() => logActivity.current ?? true}
        onConfirm={async () => {
          if (!archivingNote) return;
          await archiveNote.mutateAsync(archivingNote.id);
          toast.add({ title: t('leads.activity.archived'), type: 'success' });
        }}
      />
    </>
  );
}

/** The pipeline from New to Won, with Lost in place of Won once lost. */
function StageStepper({ stage }: { stage: LeadStage }) {
  const { t } = useTranslation();
  const steps: LeadStage[] = [
    'new',
    'contacted',
    'meeting',
    'quote_sent',
    stage === 'lost' ? 'lost' : 'won',
  ];
  const index = steps.indexOf(stage);
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label={t('leads.page.pipeline')}>
      {steps.map((step, position) => (
        <li
          key={step}
          aria-current={step === stage ? 'step' : undefined}
          className={cn(
            'flex h-7 items-center rounded-sm px-2.5 text-xs font-medium',
            step === stage
              ? step === 'lost'
                ? 'bg-status-danger text-status-danger-foreground'
                : 'bg-primary text-primary-foreground'
              : position < index
                ? 'bg-status-brand text-status-brand-foreground'
                : 'bg-muted text-muted-foreground',
          )}
        >
          {t(`leads.stages.${step}`)}
        </li>
      ))}
    </ol>
  );
}

function Header({
  lead,
  onOpen,
  heading,
}: {
  lead: LeadDetail;
  onOpen: (open: Open, opener: HTMLElement | null) => void;
  heading: RefObject<HTMLHeadingElement | null>;
}) {
  const { t } = useTranslation();
  const move = useMoveLead();
  const { permissions } = lead;
  // A dialog started from the menu gives the focus back to the menu's button.
  const menuButton = useRef<HTMLButtonElement>(null);
  const fromMenu = (open: Open) => () => onOpen(open, menuButton.current);
  const opens = (open: Open) => (event: { currentTarget: HTMLElement }) =>
    onOpen(open, event.currentTarget);

  async function moveTo(stage: (typeof MANUAL_LEAD_STAGES)[number]) {
    try {
      await move.mutateAsync({ id: lead.id, stage });
      toast.add({
        title: t('leads.board.moved', {
          name: lead.displayName,
          stage: t(`leads.stages.${stage}`),
        }),
        type: 'success',
      });
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  }

  const more =
    permissions.canChangeOwner ||
    permissions.canLose ||
    permissions.canArchive ||
    permissions.moves.length > 0;

  return (
    <section className="relative overflow-hidden rounded-lg border border-border bg-surface">
      <AscentLines className="absolute inset-y-0 end-0 hidden h-full w-32 text-border md:block" />
      <div className="relative flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h1 ref={heading} tabIndex={-1} className="text-2xl font-bold wrap-anywhere">
                {lead.displayName}
              </h1>
              <LeadStageBadge stage={lead.stage} />
              {lead.isHealthcare && <HealthcareBadge />}
              {lead.archivedAt && <Badge tone="neutral">{t('leads.archivedBadge')}</Badge>}
            </div>
            <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <Fact label={t('leads.form.owner')}>
                <Avatar
                  name={lead.owner.name}
                  size="sm"
                  tone={lead.owner.archived ? 'muted' : 'brand'}
                />
                <span className="font-medium">{lead.owner.name}</span>
              </Fact>
              <Fact label={t('leads.form.source')}>
                <SourceMark source={lead.source} decorative />
                {t(`leads.sources.${lead.source}`)}
                {lead.sourceDetail && (
                  <span className="text-muted-foreground">· {lead.sourceDetail}</span>
                )}
              </Fact>
              {lead.nextFollowUpOn && (
                <Fact label={t('leads.followUp.label')}>
                  <FollowUpDate lead={lead} />
                  {permissions.canEdit && (
                    <Button variant="link" size="sm" onClick={opens('followUp')}>
                      {t('leads.followUp.set')}
                    </Button>
                  )}
                </Fact>
              )}
              <Fact label={t('leads.page.inStage')}>
                <span className="text-muted-foreground">
                  {t('leads.card.daysInStage', {
                    count: lead.daysInStage,
                    n: formatNumber(lead.daysInStage),
                  })}
                </span>
              </Fact>
            </dl>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {permissions.canLogActivity && (
              <Button onClick={opens('note')}>
                <MessagesSquareIcon />
                {t('leads.activity.log')}
              </Button>
            )}
            {permissions.canConvert && (
              <Button variant="outline" onClick={opens('convert')}>
                <CircleCheckBigIcon />
                {t('leads.actions.convert')}
              </Button>
            )}
            {permissions.canNewQuote && (
              <Button variant="outline" onClick={opens('quote')}>
                <PlusIcon />
                {t('leads.quotes.new')}
              </Button>
            )}
            {permissions.canEdit && (
              <Button variant="outline" onClick={opens('edit')}>
                <PencilIcon />
                {t('leads.actions.edit')}
              </Button>
            )}
            {permissions.canReopen && (
              <Button variant="outline" onClick={opens('reopen')}>
                <RotateCcwIcon />
                {t('leads.actions.reopen')}
              </Button>
            )}
            {more && (
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
                            aria-label={t('leads.actions.more')}
                          />
                        }
                      />
                    }
                  >
                    <EllipsisIcon />
                  </TooltipTrigger>
                  <TooltipContent>{t('leads.actions.more')}</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end">
                  {permissions.moves.map((stage) => (
                    <DropdownMenuItem
                      key={stage}
                      disabled={move.isPending}
                      onClick={() => moveTo(stage)}
                    >
                      <MoveIcon />
                      {t('leads.actions.moveTo', { stage: t(`leads.stages.${stage}`) })}
                    </DropdownMenuItem>
                  ))}
                  {permissions.canChangeOwner && (
                    <DropdownMenuItem onClick={fromMenu('owner')}>
                      <UserRoundCogIcon />
                      {t('leads.actions.changeOwner')}
                    </DropdownMenuItem>
                  )}
                  {(permissions.canLose || permissions.canArchive) && <DropdownMenuSeparator />}
                  {permissions.canLose && (
                    <DropdownMenuItem variant="destructive" onClick={fromMenu('lose')}>
                      <CircleXIcon />
                      {t('leads.actions.lose')}
                    </DropdownMenuItem>
                  )}
                  {permissions.canArchive && (
                    <DropdownMenuItem variant="destructive" onClick={fromMenu('archive')}>
                      <ArchiveIcon />
                      {t('leads.actions.archive')}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
        <StageStepper stage={lead.stage} />
      </div>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="sr-only">{label}</dt>
      <dd className="flex flex-wrap items-center gap-2">{children}</dd>
    </div>
  );
}

function SideCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="gap-4 p-5">
      <h2 className="font-bold">{title}</h2>
      {children}
    </Card>
  );
}

function ContactSection({ lead }: { lead: LeadDetail }) {
  const { t } = useTranslation();
  return (
    <SideCard title={t('leads.page.contact')}>
      <dl className="flex flex-col gap-3 text-sm">
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted-foreground">{t('leads.form.contactName')}</dt>
          <dd className="font-medium">{lead.contactName}</dd>
        </div>
        {lead.companyName && (
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground">{t('leads.form.companyName')}</dt>
            <dd className="font-medium">{lead.companyName}</dd>
          </div>
        )}
      </dl>
      <div className="flex flex-col gap-2 border-t border-border pt-4 text-sm">
        {lead.phone && (
          <div className="flex items-center gap-2">
            <PhoneIcon aria-hidden="true" className="size-4 text-muted-foreground" />
            <a dir="ltr" href={`tel:${lead.phone}`} className="flex-1 text-end hover:underline">
              {lead.phone}
            </a>
            <IconButton
              variant="outline"
              label={t('clients.contacts.call', { name: lead.contactName })}
              render={<a href={`tel:${lead.phone}`} />}
            >
              <PhoneIcon />
            </IconButton>
            <IconButton
              variant="outline"
              label={t('clients.contacts.whatsapp', { name: lead.contactName })}
              render={<a href={whatsappUrl(lead.phone)} target="_blank" rel="noreferrer" />}
            >
              <MessageCircleIcon />
            </IconButton>
          </div>
        )}
        {lead.email && (
          <div className="flex items-center gap-2">
            <MailIcon aria-hidden="true" className="size-4 text-muted-foreground" />
            <a
              dir="ltr"
              href={`mailto:${lead.email}`}
              className="min-w-0 flex-1 truncate text-end hover:underline"
            >
              {lead.email}
            </a>
          </div>
        )}
        {lead.socialHandle && (
          <div className="flex items-center gap-2">
            <SourceMark source={lead.source} decorative />
            <span dir="ltr" className="min-w-0 flex-1 truncate text-end">
              {lead.socialHandle}
            </span>
          </div>
        )}
      </div>
    </SideCard>
  );
}

function RequestSection({ lead }: { lead: LeadDetail }) {
  const { t } = useTranslation();
  return (
    <SideCard title={t('leads.page.request')}>
      {lead.request ? (
        <p className="text-sm whitespace-pre-line">{lead.request}</p>
      ) : (
        <p className="text-sm text-muted-foreground">{t('leads.page.noRequest')}</p>
      )}
      {lead.interests.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('leads.form.interests')}>
          {lead.interests.map((interest) => (
            <li key={`${interest.kind}-${interest.id}`}>
              <Badge tone={interest.archived ? 'neutral' : 'outline'}>
                {interest.archived
                  ? t('leads.form.archivedInterest', { name: interest.name })
                  : interest.name}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t border-border pt-4 text-sm">
        <dt className="text-muted-foreground">{t('leads.form.budget')}</dt>
        <dd>{lead.budgetMinor !== null ? <Budget lead={lead} /> : t('common.none')}</dd>
        <dt className="text-muted-foreground">{t('clients.form.sector')}</dt>
        <dd>{lead.sector ?? t('common.none')}</dd>
        <dt className="text-muted-foreground">{t('leads.page.createdBy')}</dt>
        <dd>
          {t('leads.page.createdOn', {
            name: lead.createdBy.name,
            date: formatDate(lead.createdAt),
          })}
        </dd>
      </dl>
    </SideCard>
  );
}

function ActivitySection({
  lead,
  logButton,
  onLog,
  onEdit,
  onArchive,
}: {
  lead: LeadDetail;
  logButton: RefObject<HTMLButtonElement | null>;
  onLog: (opener: HTMLElement) => void;
  onEdit: (note: LeadNote) => void;
  onArchive: (note: LeadNote) => void;
}) {
  const { t } = useTranslation();
  const readOnly = lead.stage === 'won' || lead.stage === 'lost' || lead.archivedAt !== null;
  const days = new Map<string, LeadNote[]>();
  for (const note of lead.notes) {
    const day = businessDay(note.occurredAt);
    days.set(day, [...(days.get(day) ?? []), note]);
  }
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">{t('leads.activity.title')}</h2>
        {lead.permissions.canLogActivity && (
          <Button
            ref={logButton}
            variant="outline"
            size="sm"
            onClick={(event) => onLog(event.currentTarget)}
          >
            <PlusIcon />
            {t('leads.activity.log')}
          </Button>
        )}
      </div>
      {lead.notes.length === 0 ? (
        <EmptyState
          icon={<MessagesSquareIcon />}
          title={t('leads.activity.emptyTitle')}
          description={lead.permissions.canLogActivity ? t('leads.activity.emptyHint') : undefined}
        />
      ) : (
        <div className="flex flex-col gap-6">
          {[...days.entries()].map(([day, notes]) => (
            <section key={day} className="flex flex-col gap-3">
              <h3 className="flex items-center gap-3 text-sm font-medium text-muted-foreground">
                <span aria-hidden="true" className="inline-block h-4 w-0.5 -skew-x-30 bg-accent" />
                {formatDate(notes[0]?.occurredAt ?? day)}
              </h3>
              <ol className="flex flex-col gap-3">
                {notes.map((note) => {
                  const Icon = channelIcon[note.channel];
                  const canEdit = !readOnly && note.canEdit;
                  const canArchive = !readOnly && note.canArchive;
                  return (
                    <li key={note.id} className="flex gap-4">
                      <span
                        aria-hidden="true"
                        className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground"
                      >
                        <Icon className="size-4" />
                      </span>
                      <article className="flex min-w-0 flex-1 flex-col gap-3 rounded-lg border border-border bg-surface p-4">
                        <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                          <Badge tone="neutral">
                            {t(`clients.notes.channels.${note.channel}`)}
                          </Badge>
                          <time
                            dateTime={note.occurredAt}
                            className="text-muted-foreground tabular-nums"
                          >
                            {formatTime(note.occurredAt)}
                          </time>
                          <span className="ms-auto flex items-center gap-2">
                            <Avatar name={note.author.name} size="sm" />
                            <span className="text-muted-foreground">{note.author.name}</span>
                            {(canEdit || canArchive) && (
                              <DropdownMenu>
                                <NoteMenuTrigger
                                  label={t('leads.activity.actions', {
                                    time: formatTime(note.occurredAt),
                                  })}
                                />
                                <DropdownMenuContent align="end">
                                  {canEdit && (
                                    <DropdownMenuItem onClick={() => onEdit(note)}>
                                      <PencilIcon />
                                      {t('clients.notes.edit')}
                                    </DropdownMenuItem>
                                  )}
                                  {canEdit && canArchive && <DropdownMenuSeparator />}
                                  {canArchive && (
                                    <DropdownMenuItem
                                      variant="destructive"
                                      onClick={() => onArchive(note)}
                                    >
                                      <ArchiveIcon />
                                      {t('clients.notes.archive')}
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </span>
                        </header>
                        <p className="text-base whitespace-pre-line">{note.summary}</p>
                      </article>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

/** A note's menu button, named by the note's time so each one reads apart. */
function NoteMenuTrigger({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label={label} />}
          />
        }
      >
        <EllipsisIcon />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function QuotesSection({
  lead,
  onNew,
}: {
  lead: LeadDetail;
  onNew: (opener: HTMLElement) => void;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const quotes = useQuery(leadQuotesQuery(lead.id));
  // Quote pages need `quotes.read`; members of the sales departments see the summary only.
  const opens = can(me, 'quotes.read');
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">{t('leads.quotes.title')}</h2>
        {lead.permissions.canNewQuote && (
          <Button variant="outline" size="sm" onClick={(event) => onNew(event.currentTarget)}>
            <PlusIcon />
            {t('leads.quotes.new')}
          </Button>
        )}
      </div>
      {quotes.isPending ? (
        <Skeleton className="h-24" />
      ) : quotes.isError ? (
        <LoadError message={t('leads.quotes.loadError')} onRetry={() => quotes.refetch()} />
      ) : quotes.data.items.length === 0 ? (
        <EmptyState icon={<FileTextIcon />} title={t('leads.quotes.emptyTitle')} />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
          {quotes.data.items.map((quote) => (
            <li key={quote.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                {opens ? (
                  <Link
                    to="/quotes/$quoteId"
                    params={{ quoteId: quote.id }}
                    className="font-medium hover:underline"
                  >
                    {quote.title}
                  </Link>
                ) : (
                  <span className="font-medium">{quote.title}</span>
                )}
                <span dir="ltr" className="text-start text-xs text-muted-foreground tabular-nums">
                  {quote.displayNumber}
                </span>
              </span>
              <QuoteStatusBadge status={quote.status} />
              <span className="flex flex-col text-xs text-muted-foreground">
                {quote.sentAt && (
                  <span>{t('leads.quotes.sentOn', { date: formatDate(quote.sentAt) })}</span>
                )}
                {quote.validUntil && (
                  <span>
                    <CalendarClockIcon aria-hidden="true" className="me-1 inline size-3.5" />
                    {t('leads.quotes.validUntil', { date: formatCalendarDate(quote.validUntil) })}
                  </span>
                )}
              </span>
              {(quote.oneOffNetMinor !== null || quote.monthlyNetMinor !== null) && (
                <span className="flex flex-col items-end text-sm">
                  {!!quote.oneOffNetMinor && (
                    <Money minor={quote.oneOffNetMinor} currency={quote.currency} />
                  )}
                  {!!quote.monthlyNetMinor && (
                    <span className="flex items-center gap-1">
                      <Money minor={quote.monthlyNetMinor} currency={quote.currency} />
                      <span className="text-xs text-muted-foreground">{t('quotes.perMonth')}</span>
                    </span>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-6">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-80" />
        <Skeleton className="h-7 w-96" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
