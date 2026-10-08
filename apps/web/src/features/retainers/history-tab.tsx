import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { Cycle, RetainerDetail } from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Skeleton,
} from '@vertex-hub/ui';
import { ChevronLeftIcon, HistoryIcon, PackageCheckIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { TabHeader } from '../../components/tab-header';
import { formatCalendarDate, formatDateTime, formatMonth, formatNumber } from '../../lib/format';
import { useShownWhileClosing } from '../../lib/use-shown-while-closing';
import { AdjustmentsList } from './cycle-tab';
import { DeliverableIcon, DeliveryRate, lineName } from './retainer-badges';
import { retainerCycleQuery, retainerCyclesQuery } from './retainers.queries';

/**
 * Closed cycles, newest first: each month's frozen delivery rate (R8, R13) and what was
 * delivered after it closed. A cycle opens in full with its adjustments.
 */
export function HistoryTab({ retainer }: { retainer: RetainerDetail }) {
  const { t } = useTranslation();
  const cycles = useInfiniteQuery(retainerCyclesQuery(retainer.id));
  const [openId, setOpenId] = useState<string | null>(null);
  // The dialog stays mounted, with its last cycle, so it fades out and gives the focus back.
  const shownId = useShownWhileClosing(openId);
  const opener = useRef<HTMLElement | null>(null);
  const closed = (cycles.data?.pages.flatMap((page) => page.items) ?? []).filter(
    (cycle) => cycle.status === 'closed',
  );

  return (
    <>
      <TabHeader title={t('retainers.history.title')} description={t('retainers.history.hint')} />
      {cycles.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : cycles.isError ? (
        <LoadError message={t('retainers.cycle.loadError')} onRetry={() => cycles.refetch()} />
      ) : closed.length === 0 ? (
        <EmptyState
          icon={<HistoryIcon />}
          title={t('retainers.history.emptyTitle')}
          description={t('retainers.history.emptyHint')}
        />
      ) : (
        <>
          <ul aria-label={t('retainers.history.title')} className="flex flex-col gap-3">
            {closed.map((cycle) => (
              <ClosedCycleRow
                key={cycle.id}
                cycle={cycle}
                onOpen={(button) => {
                  opener.current = button;
                  setOpenId(cycle.id);
                }}
              />
            ))}
          </ul>
          {cycles.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                disabled={cycles.isFetchingNextPage}
                onClick={() => cycles.fetchNextPage()}
              >
                {t('projects.extraWork.showOlder')}
              </Button>
            </div>
          )}
        </>
      )}
      {shownId && (
        <CycleDialog
          retainerId={retainer.id}
          cycleId={shownId}
          open={openId !== null}
          onClose={() => setOpenId(null)}
          finalFocus={() => opener.current ?? true}
        />
      )}
    </>
  );
}

function ClosedCycleRow({
  cycle,
  onOpen,
}: {
  cycle: Cycle;
  /** Receives the row's button, which takes the focus back when the dialog closes. */
  onOpen: (button: HTMLButtonElement) => void;
}) {
  const { t } = useTranslation();
  const month = formatMonth(cycle.month);
  const after = cycle.lines.reduce((sum, line) => sum + line.deliveredAfterClose, 0);
  return (
    <li>
      <button
        type="button"
        onClick={(event) => onOpen(event.currentTarget)}
        aria-label={t('retainers.history.open', { month })}
        className="group flex w-full flex-col gap-3 rounded-lg border border-border bg-surface p-4 text-start transition-colors duration-150 ease-out outline-offset-4 hover:border-primary md:flex-row md:items-center"
      >
        <span className="flex min-w-0 flex-col gap-1 md:w-44">
          <span className="font-bold">{month}</span>
          <span className="text-xs text-muted-foreground">
            {t('projects.dateRange', {
              start: formatCalendarDate(cycle.periodStart),
              due: formatCalendarDate(cycle.periodEnd),
            })}
          </span>
        </span>
        <span className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-1 text-sm">
          {cycle.lines.length === 0 ? (
            <span className="text-muted-foreground">{t('retainers.noLines')}</span>
          ) : (
            cycle.lines.map((line) => (
              <span key={line.id} className="flex items-center gap-1.5">
                <DeliverableIcon kind={line.kind} className="text-muted-foreground" />
                {lineName(t, line)}
                <span className="font-medium tabular-nums">
                  {formatNumber(line.delivered)}/{formatNumber(line.committed)}
                </span>
                {line.deliveredAfterClose > 0 && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    (+{formatNumber(line.deliveredAfterClose)})
                  </span>
                )}
              </span>
            ))
          )}
        </span>
        <span className="flex items-center gap-3">
          {after > 0 && (
            <Badge tone="neutral">
              <PackageCheckIcon aria-hidden="true" />
              {t('retainers.history.afterClose', { n: formatNumber(after) })}
            </Badge>
          )}
          <DeliveryRate rate={cycle.deliveryRate} />
          <ChevronLeftIcon
            aria-hidden="true"
            className="size-4 text-muted-foreground ltr:-scale-x-100"
          />
        </span>
      </button>
    </li>
  );
}

/** A closed cycle in full: each line's frozen count, late deliveries and adjustments. */
function CycleDialog({
  retainerId,
  cycleId,
  open,
  onClose,
  finalFocus,
}: {
  retainerId: string;
  cycleId: string;
  open: boolean;
  onClose: () => void;
  finalFocus: () => HTMLElement | true;
}) {
  const { t } = useTranslation();
  const cycle = useQuery(retainerCycleQuery(retainerId, cycleId));

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')} className="max-w-2xl" finalFocus={finalFocus}>
        {cycle.isPending ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : cycle.isError ? (
          <LoadError message={t('retainers.cycle.loadError')} onRetry={() => cycle.refetch()} />
        ) : (
          <div className="grid gap-5">
            <DialogHeader>
              <DialogTitle>{formatMonth(cycle.data.month)}</DialogTitle>
              <DialogDescription>
                {cycle.data.closedAt
                  ? t('retainers.history.closedOn', { when: formatDateTime(cycle.data.closedAt) })
                  : t('projects.dateRange', {
                      start: formatCalendarDate(cycle.data.periodStart),
                      due: formatCalendarDate(cycle.data.periodEnd),
                    })}
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-4">
              <span className="text-sm text-muted-foreground">
                {t('retainers.columns.deliveryRate')}
              </span>
              <DeliveryRate rate={cycle.data.deliveryRate} />
            </div>
            <ul className="flex flex-col gap-3">
              {cycle.data.lines.map((line) => (
                <li
                  key={line.id}
                  className="flex flex-col gap-2 rounded-lg border border-border p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <DeliverableIcon kind={line.kind} className="text-muted-foreground" />
                    <span className="flex-1 font-medium">{lineName(t, line)}</span>
                    <span className="font-bold tabular-nums" dir="ltr">
                      {formatNumber(line.delivered)}/{formatNumber(line.committed)}
                    </span>
                  </div>
                  {line.deliveredAfterClose > 0 && (
                    <p className="text-sm text-muted-foreground">
                      {t('retainers.history.lineAfterClose', {
                        n: formatNumber(line.deliveredAfterClose),
                      })}
                    </p>
                  )}
                  {line.adjustments.length > 0 && (
                    <AdjustmentsList adjustments={line.adjustments} />
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
