import {
  type CalendarDate,
  type CatchUpBilling,
  type CatchUpDelivery,
  type CatchUpEntry,
  type Currency,
  cyclePeriod,
  type DeliverableKind,
} from '@vertex-hub/contracts';
import { Badge, Field, FieldLabel, Input, ToggleGroup, ToggleGroupItem } from '@vertex-hub/ui';
import { HistoryIcon } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { FormSection } from '../../components/form-section';
import { formatNumber, formatPeriod } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { DeliverableIcon, lineName } from './retainer-badges';

/** A past cycle being filled in (F05C B3, B4): counts stay empty until typed. */
export interface PastCycleDraft {
  billing: CatchUpBilling;
  delivery: CatchUpDelivery;
  delivered: (number | null)[];
}

const DEFAULT_PAST_CYCLE: PastCycleDraft = {
  billing: 'billed_externally',
  delivery: 'untracked',
  delivered: [],
};

/** One draft per past cycle, keeping the choices already made when the count changes. */
export function pastCycleDrafts(drafts: PastCycleDraft[], count: number): PastCycleDraft[] {
  return Array.from({ length: count }, (_, index) => drafts[index] ?? DEFAULT_PAST_CYCLE);
}

/**
 * B2 before the round trip: the catch-up of `count` past cycles, or the cycles whose delivered
 * counts are missing or out of 0–999 for one of the `lineCount` lines.
 */
export function parsePastCycles(
  drafts: PastCycleDraft[],
  count: number,
  lineCount: number,
): { entries: CatchUpEntry[] } | { invalid: number[] } {
  const entries: CatchUpEntry[] = [];
  const invalid: number[] = [];
  pastCycleDrafts(drafts, count).forEach((draft, index) => {
    const cycle = index + 1;
    if (draft.delivery === 'untracked') {
      entries.push({ cycle, billing: draft.billing, delivery: 'untracked' });
      return;
    }
    const delivered = Array.from({ length: lineCount }, (_, line) => draft.delivered[line]);
    if (delivered.some((value) => value == null || value < 0 || value > 999)) {
      invalid.push(cycle);
      return;
    }
    entries.push({
      cycle,
      billing: draft.billing,
      delivery: 'entered',
      delivered: delivered.map((value) => value ?? 0),
    });
  });
  return invalid.length > 0 ? { invalid } : { entries };
}

/**
 * Spec screen 1, F05C B2–B4: a start date before the current cycle lists each past cycle with its
 * period and amount, its billing (billed outside / draft invoice now) and its delivery (not
 * tracked / enter delivered, one count per line).
 */
export function PastCyclesSection({
  anchor,
  value,
  onChange,
  lines,
  amountOf,
  currency,
  invalid,
}: {
  anchor: CalendarDate;
  value: PastCycleDraft[];
  onChange: (next: PastCycleDraft[]) => void;
  lines: { kind: DeliverableKind; label?: string | null }[];
  /** The cycle's amount: the term's schedule amount, else the fee; null for none. */
  amountOf: (cycle: number) => number | null;
  currency: Currency;
  invalid: number[];
}) {
  const { t } = useTranslation();
  const change = (index: number, next: Partial<PastCycleDraft>) =>
    onChange(value.map((draft, at) => (at === index ? { ...draft, ...next } : draft)));
  return (
    <FormSection title={t('retainers.past.title')} hint={t('retainers.past.hint')}>
      <ol className="flex flex-col gap-3" data-testid="past-cycles">
        {value.map((draft, index) => (
          <PastCycleRow
            // biome-ignore lint/suspicious/noArrayIndexKey: one row per past cycle, by number
            key={index}
            cycle={index + 1}
            anchor={anchor}
            draft={draft}
            onChange={(next) => change(index, next)}
            lines={lines}
            amountMinor={amountOf(index + 1)}
            currency={currency}
            invalid={invalid.includes(index + 1)}
          />
        ))}
      </ol>
    </FormSection>
  );
}

function PastCycleRow({
  cycle,
  anchor,
  draft,
  onChange,
  lines,
  amountMinor,
  currency,
  invalid,
}: {
  cycle: number;
  anchor: CalendarDate;
  draft: PastCycleDraft;
  onChange: (next: Partial<PastCycleDraft>) => void;
  lines: { kind: DeliverableKind; label?: string | null }[];
  amountMinor: number | null;
  currency: Currency;
  invalid: boolean;
}) {
  const { t } = useTranslation();
  const ids = { billing: useId(), delivery: useId(), error: useId() };
  const period = cyclePeriod(anchor, cycle);
  const name = t('retainers.cycleNumber', { number: formatNumber(cycle) });
  const charged = amountMinor !== null && amountMinor > 0;
  return (
    <li className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <HistoryIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          <span className="font-medium">{name}</span>
          <span className="text-sm text-muted-foreground">
            {formatPeriod(period.periodStart, period.periodEnd)}
          </span>
        </span>
        {charged ? (
          <span className="font-bold tabular-nums">{formatMoney(amountMinor, currency)}</span>
        ) : (
          <Badge tone="outline">{t('retainers.past.noAmount')}</Badge>
        )}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1.5">
          <span id={ids.billing} className="text-sm font-medium">
            {t('retainers.past.billing')}
          </span>
          <ToggleGroup
            aria-labelledby={ids.billing}
            value={[draft.billing]}
            disabled={!charged}
            onValueChange={(next: CatchUpBilling[]) => next[0] && onChange({ billing: next[0] })}
          >
            {(['billed_externally', 'draft_now'] as const).map((billing) => (
              <ToggleGroupItem key={billing} value={billing}>
                {t(`retainers.past.billings.${billing}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="flex flex-col gap-1.5">
          <span id={ids.delivery} className="text-sm font-medium">
            {t('retainers.past.delivery')}
          </span>
          <ToggleGroup
            aria-labelledby={ids.delivery}
            value={[draft.delivery]}
            onValueChange={(next: CatchUpDelivery[]) => next[0] && onChange({ delivery: next[0] })}
          >
            {(['untracked', 'entered'] as const).map((delivery) => (
              <ToggleGroupItem key={delivery} value={delivery}>
                {t(`retainers.past.deliveries.${delivery}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>
      {draft.delivery === 'entered' &&
        (lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('retainers.past.noLines')}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {lines.map((line, index) => (
              <DeliveredField
                // biome-ignore lint/suspicious/noArrayIndexKey: one count per line, by position
                key={index}
                line={line}
                value={draft.delivered[index] ?? null}
                invalid={invalid && draft.delivered[index] == null}
                errorId={ids.error}
                onChange={(count) =>
                  onChange({
                    delivered: Array.from({ length: lines.length }, (_, at) =>
                      at === index ? count : (draft.delivered[at] ?? null),
                    ),
                  })
                }
              />
            ))}
          </div>
        ))}
      {invalid && (
        <p id={ids.error} role="alert" className="text-sm text-destructive-text">
          {t('retainers.past.errors.delivered')}
        </p>
      )}
    </li>
  );
}

function DeliveredField({
  line,
  value,
  invalid,
  errorId,
  onChange,
}: {
  line: { kind: DeliverableKind; label?: string | null };
  value: number | null;
  invalid: boolean;
  errorId: string;
  onChange: (count: number | null) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const name = lineName(t, line);
  return (
    <Field invalid={invalid}>
      <FieldLabel htmlFor={id} className="flex items-center gap-2">
        <DeliverableIcon kind={line.kind} className="text-muted-foreground" />
        {name}
      </FieldLabel>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        max={999}
        className="text-end tabular-nums"
        aria-describedby={invalid ? errorId : undefined}
        value={value ?? ''}
        onChange={(event) =>
          onChange(event.target.value === '' ? null : Number(event.target.value))
        }
      />
    </Field>
  );
}
