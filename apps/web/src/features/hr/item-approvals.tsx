import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type {
  AttendanceItem,
  AttendanceItemKind,
  DecideItemInput,
  LatenessTier,
} from '@vertex-hub/contracts';
import { Button, Checkbox, EmptyState, Pagination, Skeleton, toast } from '@vertex-hub/ui';
import { CheckCheckIcon, StampIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { LoadError } from '../../components/load-error';
import { can, useMe } from '../../lib/auth';
import { formatCalendarDate, formatNumber } from '../../lib/format';
import { itemSummary } from './attendance-month';
import { ItemStatusBadge } from './attendance-parts';
import { attendanceItemListQuery, useDecideItem } from './hr.queries';
import { proposalText } from './hr-item-page';

/**
 * Rule C18 for many at once (spec screen "Approvals": bulk decide for items of the same
 * proposal): a deduction of the proposed fraction, a warning where the proposal is none, or
 * waiving a missing out. Overtime has no proposal, so it is decided one by one.
 */
function proposalDecision(item: AttendanceItem): Omit<DecideItemInput, 'note'> | null {
  if (item.kind === 'overtime') return null;
  // Rule C17: a missing out proposes nothing; it is usually waived.
  if (item.kind === 'missing_out') return { decision: 'waived' };
  return item.proposedFraction > 0
    ? { decision: 'deducted', fraction: item.proposedFraction as LatenessTier['fraction'] }
    : { decision: 'warned' };
}

/** Items share a proposal when the same decision applies to them. */
const proposalKey = (item: AttendanceItem) => JSON.stringify(proposalDecision(item));

const PAGE_SIZE = 25;

/**
 * The pending attendance items in Approvals, oldest first, each opening its page; `hr.approve`
 * selects items of one proposal and applies it to them all.
 */
export function ItemApprovals({
  kind,
  departmentId,
  page,
  onPageChange,
}: {
  kind?: AttendanceItemKind;
  departmentId?: string;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const approves = can(me, 'hr.approve');
  const items = useQuery(
    attendanceItemListQuery({
      status: ['pending'],
      kind,
      departmentId,
      order: 'asc',
      page,
      pageSize: PAGE_SIZE,
    }),
  );
  const decide = useDecideItem();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const chosen = (items.data?.items ?? []).filter((item) => selected.has(item.id));
  const key = chosen[0] ? proposalKey(chosen[0]) : null;

  if (items.isPending) return <Skeleton className="h-64" />;
  if (items.isError) {
    return <LoadError message={t('hr.items.listError')} onRetry={() => items.refetch()} />;
  }
  if (items.data.items.length === 0) {
    return (
      <EmptyState
        icon={<StampIcon />}
        title={t('hr.items.emptyTitle')}
        description={t('hr.items.emptyHint')}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {approves && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {chosen.length > 0
              ? t('hr.items.bulk.selected', {
                  count: chosen.length,
                  items: formatNumber(chosen.length),
                  proposal: proposalText(t, chosen[0] as AttendanceItem),
                })
              : t('hr.items.bulk.hint')}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="ms-auto"
            disabled={chosen.length === 0}
            onClick={() => setConfirming(true)}
          >
            <CheckCheckIcon />
            {t('hr.items.bulk.apply')}
          </Button>
        </div>
      )}
      <ul className="flex flex-col gap-2">
        {items.data.items.map((item) => {
          const bulk = approves && proposalDecision(item) !== null;
          const fits = key === null || proposalKey(item) === key;
          return (
            <li
              key={item.id}
              data-item={item.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-surface p-3"
            >
              {bulk && (
                <Checkbox
                  aria-label={t('hr.items.bulk.select', { name: item.user.name })}
                  checked={selected.has(item.id)}
                  disabled={!fits}
                  onCheckedChange={(next) =>
                    setSelected((previous) => {
                      const updated = new Set(previous);
                      if (next) updated.add(item.id);
                      else updated.delete(item.id);
                      return updated;
                    })
                  }
                />
              )}
              <Link
                to="/hr/items/$itemId"
                params={{ itemId: item.id }}
                className="font-medium hover:underline"
              >
                {item.user.name}
              </Link>
              <span>{itemSummary(t, item)}</span>
              <span className="text-sm text-muted-foreground">{formatCalendarDate(item.date)}</span>
              <span className="text-sm text-muted-foreground">
                {t('hr.items.proposalIs', { proposal: proposalText(t, item) })}
              </span>
              {item.justification && (
                <span className="text-sm text-muted-foreground">{t('hr.items.justified')}</span>
              )}
              <span className="ms-auto">
                <ItemStatusBadge status={item.status} />
              </span>
            </li>
          );
        })}
      </ul>
      <Pagination
        page={page}
        pageCount={Math.ceil(items.data.total / PAGE_SIZE)}
        onPageChange={onPageChange}
        summary={t('common.pageSummary', {
          from: formatNumber((page - 1) * PAGE_SIZE + 1),
          to: formatNumber((page - 1) * PAGE_SIZE + items.data.items.length),
          total: formatNumber(items.data.total),
        })}
        previousLabel={t('common.previous')}
        nextLabel={t('common.next')}
      />
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('hr.items.bulk.title', {
          count: chosen.length,
          items: formatNumber(chosen.length),
        })}
        body={chosen[0] ? t('hr.items.bulk.body', { proposal: proposalText(t, chosen[0]) }) : ''}
        action={t('hr.items.bulk.apply')}
        pending={decide.isPending}
        onConfirm={async () => {
          // One at a time: each decision is its own audited change (rule C18).
          for (const item of chosen) {
            const decision = proposalDecision(item);
            if (decision) await decide.mutateAsync({ id: item.id, ...decision, note: null });
          }
          setSelected(new Set());
          toast.add({ title: t('hr.items.bulk.done'), type: 'success' });
        }}
      />
    </div>
  );
}
