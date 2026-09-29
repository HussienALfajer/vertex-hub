import type { Currency } from '@vertex-hub/contracts';
import { cn, Input } from '@vertex-hub/ui';
import { type ComponentProps, useState } from 'react';
import { amountText, isAmountDraft, parseAmount } from '../lib/money';

interface MoneyInputProps
  extends Omit<
    ComponentProps<typeof Input>,
    'value' | 'defaultValue' | 'onChange' | 'onValueChange' | 'type'
  > {
  /** The amount in minor units; null for none. */
  value: number | null | undefined;
  onValueChange: (minor: number | null) => void;
  currency: Currency;
}

/**
 * An amount typed in major units (`1500.50`) and reported in minor units (ADR 0006). Keystrokes
 * that cannot become an amount are ignored, so the value is always valid or empty.
 */
export function MoneyInput({
  value,
  onValueChange,
  currency,
  className,
  ...props
}: MoneyInputProps) {
  // The typed text is kept as typed ("12." stays), and replaced only when the value changes from
  // outside (a form reset).
  const [draft, setDraft] = useState(() => ({ text: amountText(value), value: value ?? null }));
  if ((value ?? null) !== draft.value) setDraft({ text: amountText(value), value: value ?? null });

  return (
    // Amounts read left to right, the code after the figure, as in `1,500.50 USD`.
    <div dir="ltr" className="relative">
      <Input
        {...props}
        inputMode="decimal"
        autoComplete="off"
        value={draft.text}
        onChange={(event) => {
          const text = event.target.value;
          if (!isAmountDraft(text)) return;
          const minor = parseAmount(text) ?? null;
          setDraft({ text, value: minor });
          onValueChange(minor);
        }}
        className={cn('pe-14 text-end tabular-nums', className)}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-sm text-muted-foreground"
      >
        {currency}
      </span>
    </div>
  );
}
