import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type {
  AdCampaignStatus,
  CampaignDetail,
  CampaignMonth,
  CampaignUpdate,
} from '@vertex-hub/contracts';
import {
  Button,
  Callout,
  Card,
  cn,
  type DialogContent,
  EmptyState,
  IconButton,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@vertex-hub/ui';
import type { TFunction } from 'i18next';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BanIcon,
  ChartColumnIcon,
  CheckCheckIcon,
  FolderKanbanIcon,
  ListTodoIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RepeatIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { type ComponentProps, type ReactNode, type RefObject, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { isMissing, LoadError } from '../../components/load-error';
import { useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { formatCalendarDate, formatMonth, formatNumber, isolateLtr } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { useFocusAfterChange } from '../../lib/use-focus-after-change';
import { useShownWhileClosing } from '../../lib/use-shown-while-closing';
import { ReasonDialog } from '../invoices/invoice-dialogs';
import { ArchivedBadge, PersonName } from '../projects/project-badges';
import { Money } from '../quotes/quote-badges';
import { FormDialog } from '../quotes/quote-dialogs';
import { TaskStatusBadge } from '../tasks/task-badges';
import {
  Balance,
  BudgetUsed,
  CampaignStatusBadge,
  CostPerResult,
  DirectFundingBadge,
  EndPassedBadge,
  PlatformName,
} from './campaign-badges';
import { CampaignDialog } from './campaign-dialog';
import {
  campaignQuery,
  useArchiveCampaign,
  useArchiveCampaignUpdate,
  useChangeCampaignStatus,
  useRestoreCampaign,
} from './campaigns.queries';
import { UpdateDialog } from './update-dialog';

/** Spec screen 3: a campaign with its totals, months and updates, and the actions its status allows. */
export function CampaignPage({ campaignId }: { campaignId: string }) {
  const { t } = useTranslation();
  const campaign = useQuery(campaignQuery(campaignId));
  return (
    <>
      <div>
        <Button variant="ghost" size="sm" render={<Link to="/campaigns" />}>
          <ArrowRightIcon className="ltr:-scale-x-100" />
          {t('campaigns.back')}
        </Button>
      </div>
      {campaign.isPending ? (
        <div className="flex flex-col gap-6">
          <Skeleton className="h-10 w-72" />
          <div className="grid gap-3 sm:grid-cols-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
          <Skeleton className="h-72" />
        </div>
      ) : campaign.isError ? (
        <LoadError
          message={
            isMissing(campaign.error) ? t('campaigns.notFound') : t('campaigns.loadOneError')
          }
          onRetry={() => campaign.refetch()}
          error={campaign.error}
        />
      ) : (
        <Campaign campaign={campaign.data} />
      )}
    </>
  );
}

type Dialog =
  | { kind: 'edit' }
  | { kind: 'status'; from: AdCampaignStatus; to: AdCampaignStatus }
  | { kind: 'archive' }
  | { kind: 'restore' }
  | { kind: 'addUpdate' }
  | { kind: 'editUpdate'; update: CampaignUpdate }
  | { kind: 'archiveUpdate'; update: CampaignUpdate }
  | null;

type FinalFocus = ComponentProps<typeof DialogContent>['finalFocus'];

/**
 * Every dialog of the page stays mounted, so it fades out and gives the focus back: to the button
 * that opened it, or, when the action took that button away (a status move, an archive), to the
 * header's first action, else the heading.
 */
function Campaign({ campaign }: { campaign: CampaignDetail }) {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<Dialog>(null);
  // The dialog's content stays while it fades out after closing.
  const shown = useShownWhileClosing(dialog);
  const close = () => setDialog(null);
  const { permissions } = campaign;
  const archived = campaign.archivedAt !== null;
  const heading = useRef<HTMLHeadingElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  const addUpdate = useRef<HTMLButtonElement>(null);
  const updatesHeading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const open = (next: Dialog) => {
    opener.current = document.activeElement as HTMLElement | null;
    setDialog(next);
  };
  const headerTarget = () =>
    actions.current?.querySelector<HTMLElement>('button') ?? heading.current;
  const finalFocus: FinalFocus = () =>
    (opener.current?.isConnected && opener.current) || headerTarget() || true;
  // A status move or an archive swaps the header's buttons.
  useFocusAfterChange(`${campaign.status}:${campaign.archivedAt ?? ''}`, headerTarget);
  // An archived update leaves the table: "add update", else the table's heading.
  const updatesTarget: FinalFocus = () =>
    (opener.current?.isConnected && opener.current) ||
    addUpdate.current ||
    updatesHeading.current ||
    true;
  const dialogs = { dialog, shown, onClose: close, finalFocus };

  return (
    <>
      <PageHeader
        headingRef={heading}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {campaign.name}
            <CampaignStatusBadge status={campaign.status} />
            {campaign.funding === 'client_direct' && <DirectFundingBadge />}
            {campaign.endPassed && <EndPassedBadge />}
            {archived && <ArchivedBadge />}
          </span>
        }
        description={<Facts campaign={campaign} />}
        actions={
          <div ref={actions} className="flex flex-wrap items-center gap-2">
            <Actions campaign={campaign} onAction={open} />
          </div>
        }
      />

      {archived && (
        <Callout
          tone="neutral"
          icon={<ArchiveIcon />}
          title={t('campaigns.archivedTitle')}
          description={t('campaigns.archivedBody')}
        />
      )}
      {campaign.status === 'cancelled' && campaign.cancelReason && (
        <Callout
          tone="neutral"
          icon={<BanIcon />}
          title={t('campaigns.cancelledTitle')}
          description={campaign.cancelReason}
        />
      )}

      <Totals campaign={campaign} />
      <MonthsCard campaign={campaign} />
      <UpdatesCard
        campaign={campaign}
        headingRef={updatesHeading}
        addRef={addUpdate}
        onAdd={permissions.canAddUpdate ? () => open({ kind: 'addUpdate' }) : undefined}
        onEdit={
          permissions.canEditUpdates ? (update) => open({ kind: 'editUpdate', update }) : undefined
        }
        onArchive={
          permissions.canEditUpdates
            ? (update) => open({ kind: 'archiveUpdate', update })
            : undefined
        }
      />
      {campaign.notes && (
        <Card className="gap-2 p-6">
          <h2 className="text-lg font-bold">{t('campaigns.form.notes')}</h2>
          <p className="whitespace-pre-line text-sm">{campaign.notes}</p>
        </Card>
      )}

      {permissions.canEdit && (
        <CampaignDialog
          open={dialog?.kind === 'edit'}
          onClose={close}
          campaign={campaign}
          finalFocus={finalFocus}
        />
      )}
      <StatusDialogs campaign={campaign} {...dialogs} />
      <ArchiveDialogs campaign={campaign} {...dialogs} />
      {permissions.canAddUpdate && (
        <UpdateDialog
          campaign={campaign}
          open={dialog?.kind === 'addUpdate'}
          onClose={close}
          finalFocus={finalFocus}
        />
      )}
      <UpdateDialog
        campaign={campaign}
        update={shown?.kind === 'editUpdate' ? shown.update : undefined}
        open={dialog?.kind === 'editUpdate'}
        onClose={close}
        finalFocus={finalFocus}
      />
      <ArchiveUpdateDialog
        update={shown?.kind === 'archiveUpdate' ? shown.update : null}
        open={dialog?.kind === 'archiveUpdate'}
        onClose={close}
        finalFocus={updatesTarget}
      />
    </>
  );
}

/** What the page's dialogs take: the one open now, the one still fading out, and the focus. */
interface DialogsProps {
  campaign: CampaignDetail;
  dialog: Dialog;
  shown: Dialog;
  onClose: () => void;
  finalFocus: FinalFocus;
}

function Facts({ campaign }: { campaign: CampaignDetail }) {
  const { t } = useTranslation();
  const { engagement, task } = campaign;
  return (
    <span className="flex flex-col gap-2">
      <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link
          to="/clients/$clientId"
          params={{ clientId: campaign.client.id }}
          search={{ tab: 'ads' }}
          className="font-medium hover:underline"
        >
          {campaign.client.name}
        </Link>
        <PlatformName platform={campaign.platform} />
        <span>
          {t('campaigns.objectiveIs', {
            objective: t(`campaigns.objectives.${campaign.objective}`),
          })}
        </span>
        <span>{t(`campaigns.funding.${campaign.funding}`)}</span>
        <span>
          {campaign.endsOn
            ? t('campaigns.dateRange', {
                from: formatCalendarDate(campaign.startsOn),
                to: formatCalendarDate(campaign.endsOn),
              })
            : t('campaigns.openEnded', { from: formatCalendarDate(campaign.startsOn) })}
        </span>
        <span className="flex items-center gap-2">
          {t('campaigns.ownerIs')}
          <PersonName name={campaign.owner.name} archived={campaign.owner.archived} />
        </span>
      </span>
      {(engagement || task) && (
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {engagement?.type === 'project' && (
            <LinkChip archived={engagement.archived}>
              <Link
                to="/projects/$projectId"
                params={{ projectId: engagement.id }}
                className="flex items-center gap-1 hover:underline"
              >
                <FolderKanbanIcon aria-hidden="true" className="size-4" />
                {engagement.name}
              </Link>
            </LinkChip>
          )}
          {engagement?.type === 'retainer' && (
            <LinkChip archived={engagement.archived}>
              <Link
                to="/retainers/$retainerId"
                params={{ retainerId: engagement.id }}
                className="flex items-center gap-1 hover:underline"
              >
                <RepeatIcon aria-hidden="true" className="size-4" />
                {engagement.name}
              </Link>
            </LinkChip>
          )}
          {task && (
            <LinkChip archived={task.archived}>
              <Link
                to="/tasks/$taskId"
                params={{ taskId: task.id }}
                className="flex items-center gap-1 hover:underline"
              >
                <ListTodoIcon aria-hidden="true" className="size-4" />
                {task.name}
              </Link>
              <TaskStatusBadge status={task.status} />
            </LinkChip>
          )}
        </span>
      )}
    </span>
  );
}

/** A linked record, marked when it was archived after the link was made (rule 3). */
function LinkChip({ archived, children }: { archived: boolean; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      {children}
      {archived && <ArchivedBadge />}
    </span>
  );
}

/** The status changes a campaign manager may make now, labelled by where they start. */
function transitionLabel(from: AdCampaignStatus, to: AdCampaignStatus) {
  if (to === 'active') {
    return from === 'planned' ? 'start' : from === 'paused' ? 'resume' : 'reopen';
  }
  return to === 'paused' ? 'pause' : to === 'completed' ? 'complete' : 'cancel';
}

const transitionIcon = {
  start: PlayIcon,
  resume: PlayIcon,
  reopen: RotateCcwIcon,
  pause: PauseIcon,
  complete: CheckCheckIcon,
  cancel: BanIcon,
} as const;

function Actions({
  campaign,
  onAction,
}: {
  campaign: CampaignDetail;
  onAction: (dialog: Dialog) => void;
}) {
  const { t } = useTranslation();
  const { permissions } = campaign;
  return (
    <>
      {permissions.transitions.map((to) => {
        const label = transitionLabel(campaign.status, to);
        const Icon = transitionIcon[label];
        return (
          <Button
            key={to}
            variant={label === 'start' || label === 'resume' ? 'primary' : 'outline'}
            onClick={() => onAction({ kind: 'status', from: campaign.status, to })}
          >
            <Icon />
            {t(`campaigns.actions.${label}`)}
          </Button>
        );
      })}
      {permissions.canEdit && (
        <Button variant="outline" onClick={() => onAction({ kind: 'edit' })}>
          <PencilIcon />
          {t('common.edit')}
        </Button>
      )}
      {permissions.canArchive && (
        <Button variant="ghost" onClick={() => onAction({ kind: 'archive' })}>
          <ArchiveIcon />
          {t('campaigns.actions.archive')}
        </Button>
      )}
      {permissions.canRestore && (
        <Button variant="outline" onClick={() => onAction({ kind: 'restore' })}>
          <ArchiveRestoreIcon />
          {t('campaigns.actions.restore')}
        </Button>
      )}
    </>
  );
}

function StatusDialogs({ campaign, dialog, shown, onClose, finalFocus }: DialogsProps) {
  const { t } = useTranslation();
  const change = useChangeCampaignStatus(campaign.id);
  // Labelled by the status it started from: the dialog keeps its words while it fades out.
  const move = shown?.kind === 'status' ? shown : null;
  const label = move ? transitionLabel(move.from, move.to) : null;
  const isOpen = (name: ReturnType<typeof transitionLabel>) =>
    dialog?.kind === 'status' && transitionLabel(dialog.from, dialog.to) === name;
  const done = () => toast.add({ title: t('campaigns.statusChanged'), type: 'success' });
  // Starting and cancelling have dialogs of their own.
  const confirm = label === 'cancel' || label === 'start' ? null : label;
  return (
    <>
      <StartDialog
        campaign={campaign}
        open={isOpen('start')}
        onClose={onClose}
        finalFocus={finalFocus}
      />
      <ReasonDialog
        open={isOpen('cancel')}
        onClose={onClose}
        finalFocus={finalFocus}
        title={t('campaigns.cancel.title')}
        description={t('campaigns.cancel.hint')}
        action={t('campaigns.actions.cancel')}
        label={t('campaigns.cancel.reason')}
        onSubmit={async (reason) => {
          await change.mutateAsync({ to: 'cancelled', reason });
          done();
          return true;
        }}
      />
      <ConfirmDialog
        open={dialog?.kind === 'status' && !isOpen('start') && !isOpen('cancel')}
        onClose={onClose}
        finalFocus={finalFocus}
        title={confirm ? t(`campaigns.confirm.${confirm}.title`) : ''}
        body={confirm ? t(`campaigns.confirm.${confirm}.body`) : ''}
        action={confirm ? t(`campaigns.actions.${confirm}`) : ''}
        pending={change.isPending}
        onConfirm={async () => {
          // A campaign never moves back to planned.
          if (!move || move.to === 'planned') return;
          await change.mutateAsync({ to: move.to });
          done();
        }}
      />
    </>
  );
}

/**
 * Rule 8: starting a wallet campaign whose remaining budget is more than the client's balance
 * warns; it is never refused.
 */
function StartDialog({
  campaign,
  open,
  onClose,
  finalFocus,
}: {
  campaign: CampaignDetail;
  open: boolean;
  onClose: () => void;
  finalFocus: FinalFocus;
}) {
  const { t } = useTranslation();
  const change = useChangeCampaignStatus(campaign.id);
  const [failure, setFailure] = useState<string | null>(null);
  const remaining = Math.max(campaign.budgetMinor - campaign.totals.spendMinor, 0);
  const short = campaign.walletBalanceMinor !== null && remaining > campaign.walletBalanceMinor;
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onClosed={() => setFailure(null)}
      finalFocus={finalFocus}
      submitting={change.isPending}
      title={t('campaigns.confirm.start.title')}
      description={t('campaigns.confirm.start.body')}
      action={t('campaigns.actions.start')}
      failure={failure}
      onSubmit={async (event) => {
        event?.preventDefault();
        setFailure(null);
        try {
          await change.mutateAsync({ to: 'active' });
          toast.add({ title: t('campaigns.statusChanged'), type: 'success' });
          onClose();
        } catch (error) {
          setFailure(errorMessage(t, error));
        }
      }}
    >
      {short && campaign.walletBalanceMinor !== null && (
        <Callout
          tone="warning"
          icon={<TriangleAlertIcon />}
          title={t('campaigns.start.shortTitle')}
          description={t('campaigns.start.shortBody', {
            remaining: isolateLtr(formatMoney(remaining, 'USD')),
            balance: isolateLtr(formatMoney(campaign.walletBalanceMinor, 'USD')),
          })}
        />
      )}
    </FormDialog>
  );
}

function ArchiveDialogs({ campaign, dialog, onClose, finalFocus }: DialogsProps) {
  const { t } = useTranslation();
  const archive = useArchiveCampaign(campaign.id);
  const restore = useRestoreCampaign(campaign.id);
  return (
    <>
      <ConfirmDialog
        open={dialog?.kind === 'archive'}
        onClose={onClose}
        finalFocus={finalFocus}
        title={t('campaigns.archive.title')}
        body={t('campaigns.archive.body')}
        action={t('campaigns.actions.archive')}
        destructive
        pending={archive.isPending}
        onConfirm={async () => {
          await archive.mutateAsync();
          toast.add({ title: t('campaigns.archive.done'), type: 'success' });
        }}
      />
      <ConfirmDialog
        open={dialog?.kind === 'restore'}
        onClose={onClose}
        finalFocus={finalFocus}
        title={t('campaigns.restore.title')}
        body={t('campaigns.restore.body')}
        action={t('campaigns.actions.restore')}
        pending={restore.isPending}
        onConfirm={async () => {
          await restore.mutateAsync();
          toast.add({ title: t('campaigns.restore.done'), type: 'success' });
        }}
      />
    </>
  );
}

function ArchiveUpdateDialog({
  update,
  open,
  onClose,
  finalFocus,
}: {
  /** The update open now, or still shown while the dialog fades out. */
  update: CampaignUpdate | null;
  open: boolean;
  onClose: () => void;
  finalFocus: FinalFocus;
}) {
  const { t } = useTranslation();
  const archive = useArchiveCampaignUpdate();
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      finalFocus={finalFocus}
      title={t('campaigns.updates.archiveTitle')}
      body={
        update
          ? t('campaigns.updates.archiveBody', {
              period: periodText(t, update),
              spend: isolateLtr(formatMoney(update.spendMinor, 'USD')),
            })
          : ''
      }
      action={t('campaigns.updates.archive')}
      destructive
      pending={archive.isPending}
      onConfirm={async () => {
        if (!update) return;
        await archive.mutateAsync(update.id);
        toast.add({ title: t('campaigns.updates.archived'), type: 'success' });
      }}
    />
  );
}
function periodText(t: TFunction, period: { periodStart: string; periodEnd: string }) {
  return t('campaigns.dateRange', {
    from: formatCalendarDate(period.periodStart),
    to: formatCalendarDate(period.periodEnd),
  });
}

/** Rule 11: the campaign's totals; for a wallet campaign, the client's balance (rule 8). */
function Totals({ campaign }: { campaign: CampaignDetail }) {
  const { t } = useTranslation();
  const { totals } = campaign;
  return (
    <section
      aria-label={t('campaigns.totals.label')}
      className={cn(
        'grid gap-3 sm:grid-cols-2',
        campaign.walletBalanceMinor === null ? 'lg:grid-cols-4' : 'lg:grid-cols-5',
      )}
    >
      <Stat label={t('campaigns.totals.budget')}>
        <Money minor={campaign.budgetMinor} currency="USD" className="text-xl font-bold" />
        <BudgetUsed percent={totals.budgetUsed} />
      </Stat>
      <Stat label={t('campaigns.totals.spend')}>
        <Money minor={totals.spendMinor} currency="USD" className="text-xl font-bold" />
      </Stat>
      <Stat label={t(`campaigns.results.${campaign.objective}`)}>
        <span className="text-xl font-bold tabular-nums">{formatNumber(totals.results)}</span>
        <span className="flex items-baseline gap-2 text-sm">
          <span className="text-muted-foreground">{t('campaigns.columns.costPerResult')}</span>
          <CostPerResult minor={totals.costPerResultMinor} />
        </span>
      </Stat>
      <Stat label={t('campaigns.totals.reach')}>
        <span className="text-xl font-bold tabular-nums">{formatNumber(totals.reach)}</span>
        <span className="flex items-baseline gap-2 text-sm">
          <span className="text-muted-foreground">{t('campaigns.totals.clicks')}</span>
          <span className="tabular-nums">{formatNumber(totals.clicks)}</span>
        </span>
      </Stat>
      {campaign.walletBalanceMinor !== null && (
        <Stat label={t('campaigns.totals.wallet')}>
          <span className="flex">
            <Balance minor={campaign.walletBalanceMinor} className="text-xl font-bold" />
          </span>
          <Link
            to="/clients/$clientId"
            params={{ clientId: campaign.client.id }}
            search={{ tab: 'ads' }}
            className="flex items-center gap-1 text-sm hover:underline"
          >
            {t('campaigns.totals.openWallet')}
            <ArrowLeftIcon aria-hidden="true" className="size-4 ltr:-scale-x-100" />
          </Link>
        </Stat>
      )}
    </section>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Card className="gap-2 p-4">
      <h2 className="text-sm text-muted-foreground">{label}</h2>
      {children}
    </Card>
  );
}

function MetricCells({
  row,
}: {
  row: Pick<CampaignMonth, 'spendMinor' | 'reach' | 'clicks' | 'results' | 'costPerResultMinor'>;
}) {
  return (
    <>
      <TableCell className="text-end">
        <Money minor={row.spendMinor} currency="USD" />
      </TableCell>
      <TableCell className="text-end tabular-nums">{formatNumber(row.reach)}</TableCell>
      <TableCell className="text-end tabular-nums">{formatNumber(row.clicks)}</TableCell>
      <TableCell className="text-end tabular-nums">{formatNumber(row.results)}</TableCell>
      <TableCell className="text-end">
        <CostPerResult minor={row.costPerResultMinor} />
      </TableCell>
    </>
  );
}

function MetricHeads({ campaign }: { campaign: CampaignDetail }) {
  const { t } = useTranslation();
  return (
    <>
      <TableHead className="text-end">{t('campaigns.updates.spend')}</TableHead>
      <TableHead className="text-end">{t('campaigns.updates.reach')}</TableHead>
      <TableHead className="text-end">{t('campaigns.updates.clicks')}</TableHead>
      <TableHead className="text-end">{t(`campaigns.results.${campaign.objective}`)}</TableHead>
      <TableHead className="text-end">{t('campaigns.columns.costPerResult')}</TableHead>
    </>
  );
}

function MonthsCard({ campaign }: { campaign: CampaignDetail }) {
  const { t } = useTranslation();
  if (campaign.months.length === 0) return null;
  return (
    <Card className="gap-4 p-6">
      <h2 className="text-lg font-bold">{t('campaigns.months.heading')}</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('campaigns.months.month')}</TableHead>
            <MetricHeads campaign={campaign} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {campaign.months.map((month) => (
            <TableRow key={month.month}>
              <TableCell>{formatMonth(`${month.month}-01`)}</TableCell>
              <MetricCells row={month} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function UpdatesCard({
  campaign,
  headingRef,
  addRef,
  onAdd,
  onEdit,
  onArchive,
}: {
  campaign: CampaignDetail;
  headingRef: RefObject<HTMLHeadingElement | null>;
  addRef: RefObject<HTMLButtonElement | null>;
  onAdd?: () => void;
  onEdit?: (update: CampaignUpdate) => void;
  onArchive?: (update: CampaignUpdate) => void;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const none = <span className="text-muted-foreground">{t('common.none')}</span>;
  return (
    <Card className="gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-bold outline-none">
          {t('campaigns.updates.heading')}
        </h2>
        {onAdd && (
          <Button ref={addRef} size="sm" onClick={onAdd}>
            <PlusIcon />
            {t('campaigns.updates.add')}
          </Button>
        )}
      </div>
      {campaign.updates.length === 0 ? (
        <EmptyState
          icon={<ChartColumnIcon />}
          title={t('campaigns.updates.empty')}
          description={
            onAdd ? t('campaigns.updates.emptyHint') : t('campaigns.updates.emptyClosedHint')
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('campaigns.updates.period')}</TableHead>
              <MetricHeads campaign={campaign} />
              <TableHead>{t('campaigns.updates.note')}</TableHead>
              <TableHead>{t('campaigns.updates.enteredBy')}</TableHead>
              {onEdit && (
                <TableHead>
                  <span className="sr-only">{t('campaigns.updates.actions')}</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaign.updates.map((update) => (
              <TableRow key={update.id}>
                <TableCell>{periodText(t, update)}</TableCell>
                <MetricCells row={update} />
                <TableCell className="max-w-64 whitespace-normal">{update.note || none}</TableCell>
                <TableCell>
                  {update.enteredBy.id === me.user.id
                    ? t('campaigns.updates.you')
                    : update.enteredBy.name}
                </TableCell>
                {onEdit && onArchive && (
                  <TableCell>
                    <span className="flex items-center gap-1">
                      <IconButton
                        label={t('campaigns.updates.editOf', { period: periodText(t, update) })}
                        onClick={() => onEdit(update)}
                      >
                        <PencilIcon />
                      </IconButton>
                      <IconButton
                        label={t('campaigns.updates.archiveOf', { period: periodText(t, update) })}
                        onClick={() => onArchive(update)}
                      >
                        <ArchiveIcon />
                      </IconButton>
                    </span>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
