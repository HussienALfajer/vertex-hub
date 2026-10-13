import {
  type CalendarDate,
  type Currency,
  cyclePeriod,
  type RetainerTerm,
  type RetainerTermInput,
  scheduleMatches,
  splitEvenly,
  TERM_END_ACTIONS,
  TERM_LIMITS,
  type TermEndAction,
} from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  ToggleGroup,
  ToggleGroupItem,
} from '@vertex-hub/ui';
import { CheckIcon, SplitIcon } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { MoneyInput } from '../../components/money-input';
import { formatNumber, formatPeriod } from '../../lib/format';
import { formatMoney } from '../../lib/money';

/** A term being filled in: amounts stay empty until typed. */
export interface TermDraft {
  cycles: number | null;
  agreedTotalMinor: number | null;
  schedule: (number | null)[];
  endAction: TermEndAction;
}

export type TermProblems = Partial<Record<'cycles' | 'total' | 'schedule', true>>;

export const EMPTY_TERM: TermDraft = {
  cycles: 3,
  agreedTotalMinor: null,
  schedule: [null, null, null],
  endAction: 'renew',
};

/** A scheduled term as the edit dialog starts from it (its base amounts). */
export function draftOf(term: RetainerTerm): TermDraft {
  return {
    cycles: term.cycles,
    agreedTotalMinor: term.money?.agreedTotalMinor ?? null,
    schedule: term.schedule.map((cycle) => cycle.money?.baseAmountMinor ?? null),
    endAction: term.endAction,
  };
}

/** T3 before the round trip: whole cycles, a total, and a schedule that adds up to it. */
export function parseTerm(draft: TermDraft): RetainerTermInput | TermProblems {
  const problems: TermProblems = {};
  const { cycles, agreedTotalMinor } = draft;
  if (!cycles || cycles < TERM_LIMITS.minCycles || cycles > TERM_LIMITS.maxCycles) {
    problems.cycles = true;
  }
  if (agreedTotalMinor === null) problems.total = true;
  const schedule = draft.schedule.map((amount) => amount ?? 0);
  if (
    !problems.cycles &&
    !problems.total &&
    !scheduleMatches({ cycles: cycles ?? 0, agreedTotalMinor: agreedTotalMinor ?? 0, schedule })
  ) {
    problems.schedule = true;
  }
  if (Object.keys(problems).length > 0) return problems;
  return {
    cycles: cycles ?? 0,
    agreedTotalMinor: agreedTotalMinor ?? 0,
    schedule,
    endAction: draft.endAction,
  };
}

export const isTermProblems = (value: RetainerTermInput | TermProblems): value is TermProblems =>
  !('endAction' in value);

/** A new count of cycles re-splits the total evenly (T3's default). */
function withCycles(draft: TermDraft, cycles: number | null): TermDraft {
  const count = cycles && cycles > 0 ? Math.min(cycles, TERM_LIMITS.maxCycles) : 0;
  return {
    ...draft,
    cycles,
    schedule:
      draft.agreedTotalMinor === null
        ? Array.from({ length: count }, () => null)
        : splitEvenly(draft.agreedTotalMinor, count),
  };
}

function withTotal(draft: TermDraft, total: number | null): TermDraft {
  const count = draft.cycles ?? 0;
  return {
    ...draft,
    agreedTotalMinor: total,
    schedule:
      total === null ? draft.schedule : splitEvenly(total, Math.min(count, TERM_LIMITS.maxCycles)),
  };
}

/** Where a term's cycles fall: the retainer's start date (the anchor) and the term's first cycle. */
export interface TermCycles {
  anchor: CalendarDate;
  startCycle: number;
}

/**
 * Spec screen 1, F05C: the term's cycles, agreed total and schedule (one row per cycle with its
 * period, "Split evenly", the running difference from the total), and its end action.
 */
export function TermPlanEditor({
  value,
  onChange,
  cycles,
  currency,
  problems,
}: {
  value: TermDraft;
  onChange: (next: TermDraft) => void;
  /** Where the term's cycles fall, for their periods; null while unknown. */
  cycles: TermCycles | null;
  currency: Currency;
  problems: TermProblems;
}) {
  const { t } = useTranslation();
  const ids = { cycles: useId(), total: useId(), schedule: useId(), scheduleError: useId() };
  const scheduled = value.schedule.reduce<number>((sum, amount) => sum + (amount ?? 0), 0);
  const remaining = (value.agreedTotalMinor ?? 0) - scheduled;
  // The mismatch shows until the amounts add up again, without another save.
  const scheduleInvalid = !!problems.schedule && remaining !== 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field invalid={!!problems.cycles}>
          <FieldLabel htmlFor={ids.cycles}>{t('retainers.terms.cycles')}</FieldLabel>
          <Input
            id={ids.cycles}
            type="number"
            inputMode="numeric"
            min={TERM_LIMITS.minCycles}
            max={TERM_LIMITS.maxCycles}
            className="text-end tabular-nums"
            value={value.cycles ?? ''}
            onChange={(event) =>
              onChange(
                withCycles(value, event.target.value === '' ? null : Number(event.target.value)),
              )
            }
          />
          <FieldDescription>{t('retainers.terms.cyclesHint')}</FieldDescription>
          <FieldError match={!!problems.cycles}>{t('retainers.terms.errors.cycles')}</FieldError>
        </Field>
        <Field invalid={!!problems.total}>
          <FieldLabel htmlFor={ids.total}>{t('retainers.terms.agreedTotal')}</FieldLabel>
          <MoneyInput
            id={ids.total}
            currency={currency}
            value={value.agreedTotalMinor}
            onValueChange={(minor) => onChange(withTotal(value, minor))}
          />
          <FieldError match={!!problems.total}>{t('retainers.terms.errors.total')}</FieldError>
        </Field>
      </div>

      {value.schedule.length > 0 && (
        // Not a `Field`: it would name every cycle's input after the schedule's label.
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span id={ids.schedule} className="text-sm font-medium">
              {t('retainers.terms.schedule')}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={value.agreedTotalMinor === null}
              onClick={() => onChange(withTotal(value, value.agreedTotalMinor))}
            >
              <SplitIcon />
              {t('retainers.terms.splitEvenly')}
            </Button>
          </div>
          <ol
            aria-labelledby={ids.schedule}
            className="flex flex-col divide-y divide-border rounded-lg border border-border"
          >
            {value.schedule.map((amount, index) => {
              const number = cycles ? cycles.startCycle + index : null;
              const period = cycles && number ? cyclePeriod(cycles.anchor, number) : null;
              const position = t('retainers.terms.position', {
                position: formatNumber(index + 1),
                cycles: formatNumber(value.schedule.length),
              });
              const label = number
                ? t('retainers.cycleNumber', { number: formatNumber(number) })
                : position;
              return (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: one row per cycle, by position
                  key={index}
                  className="grid grid-cols-[minmax(0,1fr)_11rem] items-center gap-3 px-3 py-2"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{label}</span>
                    {period && (
                      <span className="text-xs text-muted-foreground">
                        {formatPeriod(period.periodStart, period.periodEnd)} · {position}
                      </span>
                    )}
                  </span>
                  <MoneyInput
                    aria-label={t('retainers.terms.cycleAmount', { cycle: label })}
                    aria-invalid={scheduleInvalid || undefined}
                    aria-describedby={scheduleInvalid ? ids.scheduleError : undefined}
                    currency={currency}
                    value={amount}
                    onValueChange={(minor) =>
                      onChange({
                        ...value,
                        schedule: value.schedule.map((current, at) =>
                          at === index ? minor : current,
                        ),
                      })
                    }
                  />
                </li>
              );
            })}
          </ol>
          <p
            className="flex items-center justify-between gap-2 text-sm"
            aria-live="polite"
            data-testid="term-remaining"
          >
            {remaining === 0 && value.agreedTotalMinor !== null ? (
              <Badge tone="success">
                <CheckIcon aria-hidden="true" />
                {t('retainers.terms.balanced')}
              </Badge>
            ) : (
              <>
                <span className="text-muted-foreground">{t('retainers.terms.remaining')}</span>
                <span className="font-bold tabular-nums text-status-warning-foreground">
                  {formatMoney(remaining, currency)}
                </span>
              </>
            )}
          </p>
          <p className="text-sm text-muted-foreground">{t('retainers.terms.scheduleHint')}</p>
          {scheduleInvalid && (
            <p id={ids.scheduleError} role="alert" className="text-sm text-destructive-text">
              {t('retainers.terms.errors.schedule')}
            </p>
          )}
        </div>
      )}

      <EndActionField
        value={value.endAction}
        onChange={(endAction) => onChange({ ...value, endAction })}
      />
    </div>
  );
}

/** T7–T9: renew (default), end, or continue open-ended at the fee per cycle. */
export function EndActionField({
  value,
  onChange,
  disabled = false,
}: {
  value: TermEndAction;
  onChange: (next: TermEndAction) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <Field>
      <FieldLabel id={id} render={<span />}>
        {t('retainers.terms.endAction')}
      </FieldLabel>
      <ToggleGroup
        aria-labelledby={id}
        value={[value]}
        disabled={disabled}
        onValueChange={(next: TermEndAction[]) => {
          if (next[0]) onChange(next[0]);
        }}
      >
        {TERM_END_ACTIONS.map((action) => (
          <ToggleGroupItem key={action} value={action}>
            {t(`retainers.terms.endActions.${action}`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <FieldDescription>{t(`retainers.terms.endActionHints.${value}`)}</FieldDescription>
    </Field>
  );
}
