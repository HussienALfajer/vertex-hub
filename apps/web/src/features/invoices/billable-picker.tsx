import { useQuery } from '@tanstack/react-query';
import type { BillableItems, Currency, InvoiceLine } from '@vertex-hub/contracts';
import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Skeleton,
} from '@vertex-hub/ui';
import { ListPlusIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { formatMonth } from '../../lib/format';
import { Money } from '../quotes/quote-badges';
import { billableItemsQuery } from './invoices.queries';

/** What a draft line bills, with where it lives (as the API answers it). */
export type LineSource = NonNullable<InvoiceLine['source']>;

/** A line the picker adds: the source with its default description and amount (rule 6). */
export interface PickedLine {
  description: string;
  unitPriceMinor: number;
  source: LineSource;
}

type Named = { id: string; name: string };

/** `project:<id>` or `retainer:<id>`: all sources of one invoice share one (`MIXED_ENGAGEMENTS`). */
export const engagementKey = (source: { project: Named | null; retainer: Named | null }) =>
  source.project
    ? `project:${source.project.id}`
    : source.retainer
      ? `retainer:${source.retainer.id}`
      : null;

interface Option {
  key: string;
  group: string;
  line: PickedLine;
  detail: string | null;
}

function optionsOf(items: BillableItems, t: (key: string) => string): Option[] {
  return [
    ...items.milestones.map((milestone) => ({
      key: milestone.id,
      group: milestone.project.name,
      detail: t(`projects.milestones.statuses.${milestone.status}`),
      line: {
        description: `${milestone.project.name} — ${milestone.name}`,
        unitPriceMinor: milestone.installmentMinor,
        source: {
          type: 'milestone' as const,
          id: milestone.id,
          name: milestone.name,
          project: milestone.project,
          retainer: null,
        },
      },
    })),
    ...items.charges.map((charge) => ({
      key: charge.id,
      group: charge.retainer.name,
      detail: t(`retainers.chargeKinds.${charge.kind}`),
      line: {
        description: `${charge.retainer.name} — ${formatMonth(charge.month)}`,
        unitPriceMinor: charge.amountMinor,
        source: {
          type: 'retainer_charge' as const,
          id: charge.id,
          name: formatMonth(charge.month),
          project: null,
          retainer: charge.retainer,
        },
      },
    })),
    ...items.extraWork.map((work) => ({
      key: work.id,
      group: t('invoices.picker.extraWork'),
      detail: (work.project ?? work.retainer)?.name ?? null,
      line: {
        description: work.title,
        unitPriceMinor: work.estimateMinor ?? 0,
        source: {
          type: 'extra_work' as const,
          id: work.id,
          name: work.title,
          project: work.project,
          retainer: work.retainer,
        },
      },
    })),
  ];
}

/**
 * Spec screen 2, "Add billable items": the client's milestones, retainer months and unbilled extra
 * work in the invoice's currency, grouped by where they live. Items of another engagement than
 * the draft's are offered disabled (`MIXED_ENGAGEMENTS`).
 */
export function BillablePicker({
  open,
  onClose,
  clientId,
  currency,
  taken,
  engagement,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  clientId: string;
  currency: Currency;
  /** Sources already on the draft (saved or not). */
  taken: Set<string>;
  /** The draft's engagement key, when its lines or its link set one. */
  engagement: string | null;
  onPick: (lines: PickedLine[]) => void;
}) {
  const { t } = useTranslation();
  const items = useQuery({ ...billableItemsQuery({ clientId, currency }), enabled: open });
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const options = items.data
    ? optionsOf(items.data, t as (key: string) => string).filter((option) => !taken.has(option.key))
    : [];
  const byKey = new Map(options.map((option) => [option.key, option]));
  const first = [...picked].map((key) => byKey.get(key)).find(Boolean);
  const locked = engagement ?? (first ? engagementKey(first.line.source) : null);
  const groups = [...new Set(options.map((option) => option.group))];

  function close() {
    setPicked(new Set());
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent closeLabel={t('common.close')} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('invoices.picker.title')}</DialogTitle>
          <DialogDescription>{t('invoices.picker.hint', { currency })}</DialogDescription>
        </DialogHeader>
        {items.isPending ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : items.isError ? (
          <LoadError message={t('invoices.picker.loadError')} onRetry={() => items.refetch()} />
        ) : options.length === 0 ? (
          <EmptyState
            icon={<ListPlusIcon />}
            title={t('invoices.picker.emptyTitle')}
            description={t('invoices.picker.emptyHint')}
          />
        ) : (
          <div className="flex max-h-[60vh] flex-col gap-5 overflow-y-auto">
            {groups.map((group) => (
              <PickerGroup
                key={group}
                title={group}
                options={options.filter((option) => option.group === group)}
                currency={currency}
                picked={picked}
                locked={locked}
                onToggle={(key, on) =>
                  setPicked((previous) => {
                    const next = new Set(previous);
                    if (on) next.add(key);
                    else next.delete(key);
                    return next;
                  })
                }
              />
            ))}
          </div>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>
            {t('common.cancel')}
          </DialogClose>
          <Button
            type="button"
            disabled={picked.size === 0}
            onClick={() => {
              onPick(
                options.filter((option) => picked.has(option.key)).map((option) => option.line),
              );
              close();
            }}
          >
            {t('invoices.picker.add', { count: picked.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PickerGroup({
  title,
  options,
  currency,
  picked,
  locked,
  onToggle,
}: {
  title: string;
  options: Option[];
  currency: Currency;
  picked: Set<string>;
  locked: string | null;
  onToggle: (key: string, on: boolean) => void;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="font-bold">
        {title}
      </h3>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {options.map((option) => {
          const other = locked !== null && engagementKey(option.line.source) !== locked;
          return (
            <li key={option.key}>
              <label
                htmlFor={`${headingId}-${option.key}`}
                className="flex cursor-pointer items-center gap-3 px-3 py-2 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
              >
                <Checkbox
                  id={`${headingId}-${option.key}`}
                  checked={picked.has(option.key)}
                  disabled={other}
                  onCheckedChange={(on) => onToggle(option.key, on === true)}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span>{option.line.source.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {other ? t('invoices.picker.otherEngagement') : option.detail}
                  </span>
                </span>
                <Money minor={option.line.unitPriceMinor} currency={currency} />
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
