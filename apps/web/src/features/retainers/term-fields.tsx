import {
  addMonths,
  type CalendarDate,
  type Currency,
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
import { formatMonth, formatNumber } from '../../lib/format';
import { formatMoney } from '../../lib/money';

/** A term being filled in: amounts stay empty until typed. */
export interface TermDraft {
  months: number | null;
  agreedTotalMinor: number | null;
  schedule: (number | null)[];
  endAction: TermEndAction;
}

export type TermProblems = Partial<Record<'months' | 'total' | 'schedule', true>>;

export const EMPTY_TERM: TermDraft = {
  months: 3,
  agreedTotalMinor: null,
  schedule: [null, null, null],
  endAction: 'renew',
};

/** A scheduled term as the edit dialog starts from it (its base amounts). */
export function draftOf(term: RetainerTerm): TermDraft {
  return {
    months: term.months,
    agreedTotalMinor: term.money?.agreedTotalMinor ?? null,
    schedule: term.schedule.map((month) => month.money?.baseAmountMinor ?? null),
    endAction: term.endAction,
  };
}

/** T3 before the round trip: whole months, a total, and a schedule that adds up to it. */
export function parseTerm(draft: TermDraft): RetainerTermInput | TermProblems {
  const problems: TermProblems = {};
  const { months, agreedTotalMinor } = draft;
  if (!months || months < TERM_LIMITS.minMonths || months > TERM_LIMITS.maxMonths) {
    problems.months = true;
  }
  if (agreedTotalMinor === null) problems.total = true;
  const schedule = draft.schedule.map((amount) => amount ?? 0);
  if (
    !problems.months &&
    !problems.total &&
    !scheduleMatches({ months: months ?? 0, agreedTotalMinor: agreedTotalMinor ?? 0, schedule })
  ) {
    problems.schedule = true;
  }
  if (Object.keys(problems).length > 0) return problems;
  return {
    months: months ?? 0,
    agreedTotalMinor: agreedTotalMinor ?? 0,
    schedule,
    endAction: draft.endAction,
  };
}

export const isTermProblems = (value: RetainerTermInput | TermProblems): value is TermProblems =>
  !('endAction' in value);

/** A new count of months re-splits the total evenly (T3's default). */
function withMonths(draft: TermDraft, months: number | null): TermDraft {
  const count = months && months > 0 ? Math.min(months, TERM_LIMITS.maxMonths) : 0;
  return {
    ...draft,
    months,
    schedule:
      draft.agreedTotalMinor === null
        ? Array.from({ length: count }, () => null)
        : splitEvenly(draft.agreedTotalMinor, count),
  };
}

function withTotal(draft: TermDraft, total: number | null): TermDraft {
  const count = draft.months ?? 0;
  return {
    ...draft,
    agreedTotalMinor: total,
    schedule:
      total === null ? draft.schedule : splitEvenly(total, Math.min(count, TERM_LIMITS.maxMonths)),
  };
}

/**
 * Spec screen 1: the term's months, agreed total and schedule (one row per month, "Split
 * evenly", the running difference from the total), and its end action.
 */
export function TermPlanEditor({
  value,
  onChange,
  startMonth,
  currency,
  problems,
}: {
  value: TermDraft;
  onChange: (next: TermDraft) => void;
  /** The first day of the term's first month, for the month names; null while unknown. */
  startMonth: CalendarDate | null;
  currency: Currency;
  problems: TermProblems;
}) {
  const { t } = useTranslation();
  const ids = { months: useId(), total: useId(), schedule: useId() };
  const scheduled = value.schedule.reduce<number>((sum, amount) => sum + (amount ?? 0), 0);
  const remaining = (value.agreedTotalMinor ?? 0) - scheduled;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field invalid={!!problems.months}>
          <FieldLabel htmlFor={ids.months}>{t('retainers.terms.months')}</FieldLabel>
          <Input
            id={ids.months}
            type="number"
            inputMode="numeric"
            min={TERM_LIMITS.minMonths}
            max={TERM_LIMITS.maxMonths}
            className="text-end tabular-nums"
            value={value.months ?? ''}
            onChange={(event) =>
              onChange(
                withMonths(value, event.target.value === '' ? null : Number(event.target.value)),
              )
            }
          />
          <FieldDescription>{t('retainers.terms.monthsHint')}</FieldDescription>
          <FieldError match={!!problems.months}>{t('retainers.terms.errors.months')}</FieldError>
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
        // Not a `Field`: it would name every month's input after the schedule's label.
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
              const month = startMonth ? formatMonth(addMonths(startMonth, index)) : null;
              const label = t('retainers.terms.position', {
                position: formatNumber(index + 1),
                months: formatNumber(value.schedule.length),
              });
              return (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: one row per month, by position
                  key={index}
                  className="grid grid-cols-[minmax(0,1fr)_11rem] items-center gap-3 px-3 py-2"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{month ?? label}</span>
                    {month && <span className="text-xs text-muted-foreground">{label}</span>}
                  </span>
                  <MoneyInput
                    aria-label={t('retainers.terms.monthAmount', { month: month ?? label })}
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
          {problems.schedule && (
            <p role="alert" className="text-sm text-destructive-text">
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

/** T7–T9: renew (default), end, or continue open-ended at the monthly fee. */
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
