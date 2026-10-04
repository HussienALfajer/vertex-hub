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

/** A balance in minor units that may go negative (a statement, a margin, an ad wallet). */
export const signedMinorAmountSchema = z
  .number()
  .int()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);

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

/** An issued, non-void invoice on a client's statement. */
export interface StatementInvoice {
  id: string;
  displayNumber: string;
  issuedOn: string;
  totalMinor: number;
}

/** A non-void payment of an issued, non-void invoice on a client's statement. */
export interface StatementPayment {
  id: string;
  receiptNumber: string;
  invoiceId: string;
  invoiceNumber: string;
  paidOn: string;
  /** In the statement's currency (rule 19). */
  appliedMinor: number;
  amountMinor: number;
  currency: Currency;
}

export interface StatementRow {
  kind: 'invoice' | 'payment';
  /** The invoice or the payment. */
  id: string;
  date: string;
  /** `INV-…` or `RC-…`. */
  number: string;
  /** The invoice itself, or the invoice a payment pays. */
  invoiceId: string;
  invoiceNumber: string;
  debitMinor: number;
  creditMinor: number;
  /** The running balance after this row; negative when payments came first. */
  balanceMinor: number;
  /** A payment's own amount when it was paid in the other currency. */
  original: { amountMinor: number; currency: Currency } | null;
}

export interface StatementRows {
  openingMinor: number;
  rows: StatementRow[];
  closingMinor: number;
  invoicedMinor: number;
  paidMinor: number;
}

/**
 * Rule 28: a client's statement in one currency over the days `[from, to]`. The opening balance
 * is what was invoiced before `from` minus what was paid before it; each invoice in the period is
 * a debit and each payment a credit by its applied amount, by date (an invoice before the
 * payments of its day); the closing balance is the outstanding amount. Pass issued, non-void
 * invoices and the non-void payments of those invoices only, all in the statement's currency.
 */
export function statementRows(input: {
  invoices: readonly StatementInvoice[];
  payments: readonly StatementPayment[];
  statementCurrency: Currency;
  from: string;
  to: string;
}): StatementRows {
  const { from, to } = input;
  const before = (date: string) => date < from;
  const within = (date: string) => date >= from && date <= to;
  const openingMinor =
    input.invoices.reduce(
      (sum, invoice) => sum + (before(invoice.issuedOn) ? invoice.totalMinor : 0),
      0,
    ) -
    input.payments.reduce(
      (sum, payment) => sum + (before(payment.paidOn) ? payment.appliedMinor : 0),
      0,
    );
  const entries: Omit<StatementRow, 'balanceMinor'>[] = [
    ...input.invoices
      .filter((invoice) => within(invoice.issuedOn))
      .map((invoice) => ({
        kind: 'invoice' as const,
        id: invoice.id,
        date: invoice.issuedOn,
        number: invoice.displayNumber,
        invoiceId: invoice.id,
        invoiceNumber: invoice.displayNumber,
        debitMinor: invoice.totalMinor,
        creditMinor: 0,
        original: null,
      })),
    ...input.payments
      .filter((payment) => within(payment.paidOn))
      .map((payment) => ({
        kind: 'payment' as const,
        id: payment.id,
        date: payment.paidOn,
        number: payment.receiptNumber,
        invoiceId: payment.invoiceId,
        invoiceNumber: payment.invoiceNumber,
        debitMinor: 0,
        creditMinor: payment.appliedMinor,
        original:
          payment.currency === input.statementCurrency
            ? null
            : { amountMinor: payment.amountMinor, currency: payment.currency },
      })),
  ].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.kind === b.kind ? 0 : a.kind === 'invoice' ? -1 : 1) ||
      a.number.localeCompare(b.number),
  );
  let balance = openingMinor;
  const rows = entries.map((entry) => {
    balance += entry.debitMinor - entry.creditMinor;
    return { ...entry, balanceMinor: balance };
  });
  return {
    openingMinor,
    rows,
    closingMinor: balance,
    invoicedMinor: rows.reduce((sum, row) => sum + row.debitMinor, 0),
    paidMinor: rows.reduce((sum, row) => sum + row.creditMinor, 0),
  };
}
