import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  addDays,
  businessDate,
  daysInclusive,
  type RetainerDetail,
  type RetainerTerm,
} from '@vertex-hub/contracts';
import {
  AscentLines,
  Avatar,
  Button,
  Callout,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@vertex-hub/ui';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowRightIcon,
  CalendarDaysIcon,
  CircleStopIcon,
  FileSignatureIcon,
  FileTextIcon,
  HistoryIcon,
  ReceiptTextIcon,
  TriangleAlertIcon,
  WalletIcon,
} from 'lucide-react';
import { type ReactNode, type RefObject, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { isMissing, LoadError } from '../../components/load-error';
import { formatCalendarDate, formatMonth, formatNumber } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { useFocusAfterChange } from '../../lib/use-focus-after-change';
import { useShownWhileClosing } from '../../lib/use-shown-while-closing';
import { OwnerDocumentsTab } from '../files/owner-documents-tab';
import { RetainerBillingTab } from '../invoices/retainer-billing-tab';
import { ExtraWorkTab } from '../projects/extra-work-tab';
import { ArchivedBadge, DepartmentChips, PersonName } from '../projects/project-badges';
import { SourceQuotes } from '../quotes/source-quotes';
import { ContractTab } from './contract-tab';
import { ThisMonthTab } from './cycle-tab';
import { HistoryTab } from './history-tab';
import { focusTarget, RetainerActions, type RetainerFocus } from './retainer-actions';
import {
  BehindBadge,
  DeliveryRate,
  PendingApprovalBadge,
  RenewalBadge,
  RetainerStatusBadge,
  TermChip,
} from './retainer-badges';
import {
  retainerQuery,
  retainerTermsQuery,
  useArchiveRetainer,
  useRestoreRetainer,
} from './retainers.queries';

const RETAINER_TABS = [
  'this-month',
  'contract',
  'history',
  'extra-work',
  'billing',
  'documents',
] as const;

type RetainerTab = (typeof RETAINER_TABS)[number];

export interface RetainerPageSearch {
  /** Unset means the first tab. */
  tab?: RetainerTab;
}

export function parseRetainerPageSearch(search: Record<string, unknown>): RetainerPageSearch {
  return { tab: RETAINER_TABS.find((tab) => tab !== 'this-month' && tab === search.tab) };
}

export function RetainerPage({
  retainerId,
  search,
}: {
  retainerId: string;
  search: RetainerPageSearch;
}) {
  const { t } = useTranslation();
  const retainer = useQuery(retainerQuery(retainerId));

  return (
    <>
      <div>
        <Button variant="ghost" size="sm" render={<Link to="/retainers" />}>
          <ArrowRightIcon className="ltr:-scale-x-100" />
          {t('retainers.page.back')}
        </Button>
      </div>
      {retainer.isPending ? (
        <PageSkeleton />
      ) : retainer.isError ? (
        <LoadError
          message={
            isMissing(retainer.error) ? t('retainers.page.notFound') : t('retainers.page.loadError')
          }
          onRetry={() => retainer.refetch()}
          error={retainer.error}
        />
      ) : (
        <RetainerView retainer={retainer.data} tab={search.tab ?? 'this-month'} />
      )}
    </>
  );
}

function RetainerView({ retainer, tab }: { retainer: RetainerDetail; tab: RetainerTab }) {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: '/retainers/$retainerId' });
  const archived = retainer.archivedAt !== null;
  const { permissions } = retainer;

  const heading = useRef<HTMLHeadingElement>(null);
  const resume = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLButtonElement>(null);
  const reactivate = useRef<HTMLButtonElement>(null);
  const restore = useRef<HTMLButtonElement>(null);
  const focus = useMemo<RetainerFocus>(() => ({ heading, resume, menu, reactivate, restore }), []);
  // A status change or an archive swaps the header's controls (archive → restore → actions menu,
  // pause → resume); a menu item or a dialog may give the focus back to one just before it leaves.
  useFocusAfterChange(`${retainer.status}:${retainer.archivedAt ?? ''}`, () => {
    const target = focusTarget(focus, 'restore', 'reactivate', 'resume', 'menu');
    return target === true ? null : target;
  });
  // The archive and restore confirmation lives here: the menu and the notice that open it leave
  // the page with the change.
  const [confirming, setConfirming] = useState<'archive' | 'restore' | null>(null);
  const shownConfirm = useShownWhileClosing(confirming) ?? 'archive';
  const archive = useArchiveRetainer(retainer.id);
  const restoreRetainer = useRestoreRetainer(retainer.id);

  const openTab = (next: RetainerTab) =>
    navigate({
      search: (previous) => ({ ...previous, tab: next === 'this-month' ? undefined : next }),
      replace: true,
    });

  return (
    <>
      <RetainerHero retainer={retainer} focus={focus} onArchive={() => setConfirming('archive')} />
      {archived ? (
        <ArchivedCallout
          retainer={retainer}
          restoreRef={restore}
          onRestore={() => setConfirming('restore')}
        />
      ) : (
        <EndedCallout retainer={retainer} />
      )}
      <Tabs value={tab} onValueChange={(value: RetainerTab) => openTab(value)}>
        <TabsList aria-label={retainer.name}>
          <TabsTrigger value="this-month">
            <CalendarDaysIcon />
            {t('retainers.page.tabs.thisMonth')}
          </TabsTrigger>
          <TabsTrigger value="contract">
            <FileSignatureIcon />
            {t('retainers.page.tabs.contract')}
          </TabsTrigger>
          <TabsTrigger value="history">
            <HistoryIcon />
            {t('retainers.page.tabs.history')}
          </TabsTrigger>
          <TabsTrigger value="extra-work">
            <ReceiptTextIcon />
            {t('projects.page.tabs.extraWork')}
          </TabsTrigger>
          {permissions.canSeeMoney && (
            <TabsTrigger value="billing">
              <WalletIcon />
              {t('projects.page.tabs.billing')}
            </TabsTrigger>
          )}
          <TabsTrigger value="documents">
            <FileTextIcon />
            {t('files.documents.title')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="this-month">
          <ThisMonthTab retainer={retainer} />
        </TabsContent>
        <TabsContent value="contract">
          <ContractTab retainer={retainer} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab retainer={retainer} />
        </TabsContent>
        <TabsContent value="extra-work">
          <ExtraWorkTab
            owner={{
              kind: 'retainer',
              id: retainer.id,
              clientId: retainer.client.id,
              // M3: extra work is logged on active and paused retainers.
              canLog: permissions.canManage,
              canBill: permissions.canBill,
              currency: retainer.money?.currency ?? null,
              editCurrency: permissions.canEditMoney ? (retainer.money?.currency ?? null) : null,
            }}
          />
        </TabsContent>
        {permissions.canSeeMoney && (
          <TabsContent value="billing">
            <RetainerBillingTab retainer={retainer} />
          </TabsContent>
        )}
        <TabsContent value="documents">
          <OwnerDocumentsTab owner={{ type: 'retainer', id: retainer.id }} />
        </TabsContent>
      </Tabs>
      <ConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={t(`retainers.${shownConfirm}.title`, { name: retainer.name })}
        body={t(`retainers.${shownConfirm}.body`)}
        action={t(`retainers.actions.${shownConfirm}`)}
        destructive={shownConfirm === 'archive'}
        pending={archive.isPending || restoreRetainer.isPending}
        // The focus goes to the button that undoes the change, or back to the one that opened it.
        finalFocus={() => focusTarget(focus, 'restore', 'menu')}
        onConfirm={async () => {
          if (confirming === 'restore') {
            await restoreRetainer.mutateAsync(undefined);
            toast.add({ title: t('retainers.restore.done'), type: 'success' });
          } else {
            await archive.mutateAsync(undefined);
            toast.add({ title: t('retainers.archive.done'), type: 'success' });
          }
        }}
      />
    </>
  );
}

/**
 * The retainer at a glance: who it is for and who answers for it, then its vital signs — this
 * month's delivery, the renewal date and (with money access) the monthly fee.
 */
function RetainerHero({
  retainer,
  focus,
  onArchive,
}: {
  retainer: RetainerDetail;
  focus: RetainerFocus;
  onArchive: () => void;
}) {
  const { t } = useTranslation();
  const archived = retainer.archivedAt !== null;
  const muted = archived || retainer.status === 'ended';

  return (
    <section className="relative overflow-hidden rounded-lg border border-border bg-surface">
      <AscentLines className="absolute inset-y-0 end-0 hidden h-full w-32 text-border md:block" />
      <div className="relative flex flex-col gap-6 p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          <Link
            to="/clients/$clientId"
            params={{ clientId: retainer.client.id }}
            aria-label={retainer.client.name}
            className="shrink-0 rounded-lg outline-offset-4"
          >
            <Avatar
              name={retainer.client.name}
              shape="square"
              size="lg"
              tone={muted ? 'muted' : 'brand'}
            />
          </Link>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Link
                to="/clients/$clientId"
                params={{ clientId: retainer.client.id }}
                className="w-fit text-sm text-muted-foreground hover:text-foreground hover:underline"
              >
                {retainer.client.name}
              </Link>
              <div className="flex flex-wrap items-center gap-3">
                <h1 ref={focus.heading} tabIndex={-1} className="text-2xl font-bold">
                  {retainer.name}
                </h1>
                <RetainerStatusBadge status={retainer.status} />
                {retainer.currentCycle?.behind && <BehindBadge />}
                {retainer.renewal && <RenewalBadge state={retainer.renewal} />}
                {retainer.pendingAmendments > 0 && (
                  <PendingApprovalBadge count={retainer.pendingAmendments} />
                )}
                {archived && <ArchivedBadge />}
              </div>
              {retainer.term && <TermChip term={retainer.term} />}
            </div>
            <dl className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
              <div className="flex items-center gap-2">
                <dt className="text-muted-foreground">{t('retainers.columns.accountManager')}</dt>
                <dd>
                  <Link
                    to="/team/$userId"
                    params={{ userId: retainer.accountManager.id }}
                    className="font-medium hover:underline"
                  >
                    <PersonName name={retainer.accountManager.name} />
                  </Link>
                </dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="sr-only">{t('projects.form.departments')}</dt>
                <dd>
                  <DepartmentChips codes={retainer.departments} />
                </dd>
              </div>
              <SourceQuotes retainerId={retainer.id} />
            </dl>
          </div>
          <RetainerActions retainer={retainer} focus={focus} onArchive={onArchive} />
        </div>
        <div className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(14rem,1fr))]">
          <Vital label={t('retainers.page.thisMonth')}>
            {retainer.currentCycle ? (
              <>
                <p className="text-xl font-bold">{formatMonth(retainer.currentCycle.month)}</p>
                <DeliveryRate rate={retainer.currentCycle.deliveryRate} />
              </>
            ) : (
              <p className="text-xl font-bold">{t('retainers.noOpenCycle')}</p>
            )}
          </Vital>
          <TermVital retainer={retainer} />
          {retainer.money && <FeeVital retainer={retainer} money={retainer.money} />}
        </div>
      </div>
    </section>
  );
}

function Vital({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-sm text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/**
 * M4: the open-ended monthly fee. Without one, open-ended months cannot be invoiced (F13); the
 * months of a term bill from its schedule (F05B T1), so the fee only matters outside the terms.
 */
function FeeVital({
  retainer,
  money,
}: {
  retainer: RetainerDetail;
  money: NonNullable<RetainerDetail['money']>;
}) {
  const { t } = useTranslation();
  const { term } = retainer;
  // Without a fee, only a running retainer billed open-ended now or after its term needs one (T9).
  const needsFee = retainer.status !== 'ended' && (!term || term.endAction === 'continue');
  let hint: string | null = null;
  if (term) hint = t('retainers.page.feeOutsideTerm');
  else if (money.monthlyFeeMinor !== null) hint = t('retainers.page.perMonth');
  else if (needsFee) hint = t('retainers.page.feeMissingHint');
  return (
    <Vital label={t('retainers.form.monthlyFee')}>
      {money.monthlyFeeMinor !== null ? (
        <p className="text-xl font-bold tabular-nums">
          {formatMoney(money.monthlyFeeMinor, money.currency)}
        </p>
      ) : needsFee ? (
        <p className="flex items-center gap-2 text-xl font-bold text-status-warning-foreground">
          <TriangleAlertIcon aria-hidden="true" className="size-5" />
          {t('retainers.page.feeMissing')}
        </p>
      ) : (
        <p className="text-xl font-bold text-muted-foreground">{t('retainers.page.feeNotSet')}</p>
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </Vital>
  );
}

/**
 * Since when the retainer runs, and how far its renewal date is (R6: a reminder only). With a
 * term the date is the day after the last term (T11), and what happens then follows its end
 * action: a renewal, the retainer's end, or open-ended months.
 */
function TermVital({ retainer }: { retainer: RetainerDetail }) {
  const { t } = useTranslation();
  const today = businessDate();
  const { renewalDate, term } = retainer;
  // The date follows the last term (T11), which may be a scheduled one after the active term.
  const terms = useQuery({ ...retainerTermsQuery(retainer.id), enabled: term !== null });
  const lastTerm = terms.data?.items
    .filter((item) => item.status === 'active' || item.status === 'scheduled')
    .reduce<RetainerTerm | null>(
      (last, item) => (last === null || item.number > last.number ? item : last),
      null,
    );
  const endAction = term ? (lastTerm ?? term).endAction : null;
  // What the day after the last term brings: the retainer's end, open-ended months, or a renewal.
  const upcoming =
    endAction === 'end' ? 'endsIn' : endAction === 'continue' ? 'termEndsIn' : 'renewalIn';
  let headline: string;
  if (retainer.status === 'ended' && retainer.endedOn) {
    headline = t('retainers.page.endedOn', { date: formatCalendarDate(retainer.endedOn) });
  } else if (!renewalDate) {
    headline = t('retainers.page.noRenewal');
  } else if (renewalDate < today) {
    const days = daysInclusive(renewalDate, today) - 1;
    headline = t('retainers.page.renewalPast', { count: days, days: formatNumber(days) });
  } else {
    const days = daysInclusive(today, renewalDate) - 1;
    headline = t(`retainers.page.${upcoming}`, { count: days, days: formatNumber(days) });
  }
  return (
    <Vital label={t('retainers.page.term')}>
      <p className="text-xl font-bold">{headline}</p>
      <p className="text-xs text-muted-foreground">
        {retainer.status === 'ended' || !renewalDate
          ? t(retainer.startDate <= today ? 'retainers.startedOn' : 'retainers.startsOn', {
              date: formatCalendarDate(retainer.startDate),
            })
          : term
            ? t('retainers.startTermEnd', {
                start: formatCalendarDate(retainer.startDate),
                end: formatCalendarDate(addDays(renewalDate, -1)),
              })
            : t('retainers.startRenewal', {
                start: formatCalendarDate(retainer.startDate),
                renewal: formatCalendarDate(renewalDate),
              })}
      </p>
    </Vital>
  );
}

/** An ended retainer is read-only except reactivation (R12); billing stays open (M3). */
function EndedCallout({ retainer }: { retainer: RetainerDetail }) {
  const { t } = useTranslation();
  if (retainer.status !== 'ended') return null;
  return (
    <Callout
      icon={<CircleStopIcon />}
      title={
        retainer.endedOn
          ? t('retainers.page.endedTitle', { date: formatCalendarDate(retainer.endedOn) })
          : t('retainers.statuses.ended')
      }
      description={t('retainers.page.endedBody')}
    />
  );
}

function ArchivedCallout({
  retainer,
  restoreRef,
  onRestore,
}: {
  retainer: RetainerDetail;
  restoreRef: RefObject<HTMLButtonElement | null>;
  onRestore: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Callout
      icon={<ArchiveIcon />}
      title={t('retainers.page.archivedTitle')}
      description={t('projects.page.archivedBody')}
      action={
        retainer.permissions.canArchive && (
          <Button ref={restoreRef} variant="outline" size="sm" onClick={onRestore}>
            <ArchiveRestoreIcon />
            {t('retainers.actions.restore')}
          </Button>
        )
      }
    />
  );
}

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-6 rounded-lg border border-border bg-surface p-6">
        <div className="flex items-center gap-5">
          <Skeleton className="size-14 rounded-lg" />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-7 w-64" />
          </div>
        </div>
        <div className="grid gap-4 border-t border-border pt-5 sm:grid-cols-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      </div>
      <Skeleton className="h-11" />
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
    </div>
  );
}
