import { z } from 'zod';

/**
 * Currencies of V1 (ADR 0006). `SYP` is the new Syrian pound (owner decision, was Q8). Both use
 * 2 decimal places, so amounts are stored in hundredths.
 */
export const CURRENCIES = ['USD', 'SYP'] as const;

export const currencySchema = z.enum(CURRENCIES).meta({ id: 'Currency' });

export type Currency = z.infer<typeof currencySchema>;

/** A non-negative amount in minor units of its record's currency (ADR 0006). */
export const minorAmountSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const RATE_PATTERN = /^\d{1,8}(\.\d{1,4})?$/;

/**
 * An exchange rate: Syrian pounds per 1 US dollar, > 0, up to 4 decimal places, carried as a
 * decimal string (`"118.5000"`) and stored as `numeric(12,4)` (ADR 0024). Convert amounts only
 * with `convertMinor` and `toUsdMinor`.
 */
export const exchangeRateSchema = z
  .string()
  .trim()
  .regex(RATE_PATTERN, 'Expected SYP per USD with up to 4 decimals')
  .refine((rate) => !RATE_PATTERN.test(rate) || rateTenThousandths(rate) > 0n, 'Must be above 0')
  .meta({ id: 'ExchangeRate' });

export type ExchangeRate = z.infer<typeof exchangeRateSchema>;

/** The rate × 10⁴ as an exact integer. */
function rateTenThousandths(rate: string): bigint {
  const [whole = '0', fraction = ''] = rate.split('.');
  return BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, '0').slice(0, 4) || '0');
}

/** `numerator ÷ denominator`, both non-negative, rounded half up. */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

/**
 * Converts an amount in minor units between the two currencies at `rate` (SYP per USD), rounded
 * half up with exact integer arithmetic (rule 30). Both currencies have 2 decimal places.
 */
export function convertMinor(amount: number, from: Currency, to: Currency, rate: string): number {
  if (from === to) return amount;
  const rateE4 = rateTenThousandths(rate);
  const value = BigInt(amount);
  const converted =
    from === 'USD' ? divideHalfUp(value * rateE4, 10_000n) : divideHalfUp(value * 10_000n, rateE4);
  return Number(converted);
}

/** The amount in USD minor units, the reporting currency (ADR 0006). */
export function toUsdMinor(amount: number, currency: Currency, rate: string): number {
  return convertMinor(amount, currency, 'USD', rate);
}

/** Σ quantity × unit price of an invoice's lines, in its currency. */
export function invoiceTotal(lines: readonly { quantity: number; unitPriceMinor: number }[]) {
  return lines.reduce((sum, line) => sum + line.quantity * line.unitPriceMinor, 0);
}

/**
 * Rule 19: the part of a payment applied to an invoice, in the invoice's currency. The same
 * currency applies as is; another is converted with the payment's rate, rounded half up. A payment
 * less than one minor unit of its own currency away from the exact remaining balance settles it
 * exactly ("pay the rest"). Returns null when the applied amount exceeds the balance (`OVERPAYMENT`).
 */
export function applyPayment(
  balance: number,
  amount: number,
  paymentCurrency: Currency,
  invoiceCurrency: Currency,
  rate: string,
): number | null {
  if (paymentCurrency === invoiceCurrency) return amount <= balance ? amount : null;
  const rateE4 = rateTenThousandths(rate);
  // Both sides scaled to whole numbers: the payment and the rest in payment minor units × unit.
  const [paid, rest, unit] =
    paymentCurrency === 'USD'
      ? [BigInt(amount) * rateE4, BigInt(balance) * 10_000n, rateE4]
      : [BigInt(amount) * 10_000n, BigInt(balance) * rateE4, 10_000n];
  const gap = paid > rest ? paid - rest : rest - paid;
  if (balance > 0 && gap < unit) return balance;
  const applied = convertMinor(amount, paymentCurrency, invoiceCurrency, rate);
  return applied <= balance ? applied : null;
}
