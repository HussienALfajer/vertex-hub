import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { businessDate, daysInclusive, type RetainerDetail } from '@vertex-hub/contracts';
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
  HistoryIcon,
  ReceiptTextIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { isMissing, LoadError } from '../../components/load-error';
import { formatCalendarDate, formatMonth, formatNumber } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { ExtraWorkTab } from '../projects/extra-work-tab';
import { ArchivedBadge, DepartmentChips, PersonName } from '../projects/project-badges';
import { ThisMonthTab } from './cycle-tab';
import { HistoryTab } from './history-tab';
import { RetainerActions } from './retainer-actions';
import { BehindBadge, DeliveryRate, RenewalBadge, RetainerStatusBadge } from './retainer-badges';
import { retainerQuery, useRestoreRetainer } from './retainers.queries';

const RETAINER_TABS = ['this-month', 'history', 'extra-work'] as const;

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

  const openTab = (next: RetainerTab) =>
    navigate({
      search: (previous) => ({ ...previous, tab: next === 'this-month' ? undefined : next }),
      replace: true,
    });

  return (
    <>
      <RetainerHero retainer={retainer} />
      {archived ? <ArchivedCallout retainer={retainer} /> : <EndedCallout retainer={retainer} />}
      <Tabs value={tab} onValueChange={(value: RetainerTab) => openTab(value)}>
        <TabsList aria-label={retainer.name}>
          <TabsTrigger value="this-month">
            <CalendarDaysIcon />
            {t('retainers.page.tabs.thisMonth')}
          </TabsTrigger>
          <TabsTrigger value="history">
            <HistoryIcon />
            {t('retainers.page.tabs.history')}
          </TabsTrigger>
          <TabsTrigger value="extra-work">
            <ReceiptTextIcon />
            {t('projects.page.tabs.extraWork')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="this-month">
          <ThisMonthTab retainer={retainer} />
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
      </Tabs>
    </>
  );
}

/**
 * The retainer at a glance: who it is for and who answers for it, then its vital signs — this
 * month's delivery, the renewal date and (with money access) the monthly fee.
 */
function RetainerHero({ retainer }: { retainer: RetainerDetail }) {
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
                <h1 className="text-2xl font-bold">{retainer.name}</h1>
                <RetainerStatusBadge status={retainer.status} />
                {retainer.currentCycle?.behind && <BehindBadge />}
                {retainer.renewal && <RenewalBadge state={retainer.renewal} />}
                {archived && <ArchivedBadge />}
              </div>
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
            </dl>
          </div>
          <RetainerActions retainer={retainer} />
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
          {retainer.money && (
            <Vital label={t('retainers.form.monthlyFee')}>
              {retainer.money.monthlyFeeMinor === null ? (
                // M4: a retainer without a fee cannot be invoiced (F13).
                <p className="flex items-center gap-2 text-xl font-bold text-status-warning-foreground">
                  <TriangleAlertIcon aria-hidden="true" className="size-5" />
                  {t('retainers.page.feeMissing')}
                </p>
              ) : (
                <p className="text-xl font-bold tabular-nums">
                  {formatMoney(retainer.money.monthlyFeeMinor, retainer.money.currency)}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {retainer.money.monthlyFeeMinor === null
                  ? t('retainers.page.feeMissingHint')
                  : t('retainers.page.perMonth')}
              </p>
            </Vital>
          )}
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

/** Since when the retainer runs, and how far its renewal date is (R6: a reminder only). */
function TermVital({ retainer }: { retainer: RetainerDetail }) {
  const { t } = useTranslation();
  const today = businessDate();
  const { renewalDate } = retainer;
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
    headline = t('retainers.page.renewalIn', { count: days, days: formatNumber(days) });
  }
  return (
    <Vital label={t('retainers.page.term')}>
      <p className="text-xl font-bold">{headline}</p>
      <p className="text-xs text-muted-foreground">
        {renewalDate
          ? t('retainers.startRenewal', {
              start: formatCalendarDate(retainer.startDate),
              renewal: formatCalendarDate(renewalDate),
            })
          : t('retainers.startsOn', { date: formatCalendarDate(retainer.startDate) })}
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

function ArchivedCallout({ retainer }: { retainer: RetainerDetail }) {
  const { t } = useTranslation();
  const restore = useRestoreRetainer(retainer.id);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Callout
        icon={<ArchiveIcon />}
        title={t('retainers.page.archivedTitle')}
        description={t('projects.page.archivedBody')}
        action={
          retainer.permissions.canArchive && (
            <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
              <ArchiveRestoreIcon />
              {t('retainers.actions.restore')}
            </Button>
          )
        }
      />
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('retainers.restore.title', { name: retainer.name })}
        body={t('retainers.restore.body')}
        action={t('retainers.actions.restore')}
        pending={restore.isPending}
        onConfirm={async () => {
          await restore.mutateAsync(undefined);
          toast.add({ title: t('retainers.restore.done'), type: 'success' });
        }}
      />
    </>
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
