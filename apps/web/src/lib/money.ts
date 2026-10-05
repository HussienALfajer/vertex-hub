import type { Currency } from '@vertex-hub/contracts';
import { APP_LOCALE } from '@vertex-hub/messages';

/** Both V1 currencies use 2 decimal places, so amounts are kept in hundredths (ADR 0006). */
const MINOR_PER_UNIT = 100;

/** An amount in minor units with its currency code, e.g. `1,500.00 USD`. */
export function formatMoney(minor: number, currency: Currency): string {
  return new Intl.NumberFormat(APP_LOCALE, {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / MINOR_PER_UNIT);
}

export { formatAmount } from '@vertex-hub/messages';

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;

/** Arabic-Indic and Persian digits typed on an Arabic keyboard, as Latin digits. */
function latinDigits(text: string): string {
  return text.replace(ARABIC_DIGITS, (digit) => String(digit.charCodeAt(0) & 0xf));
}

/** What an amount field accepts while typing: digits, then one decimal mark and up to 2 decimals. */
const AMOUNT_DRAFT = /^(\d{0,13})(?:[.,٫](\d{0,2}))?$/;

/** Whether the typed text can still become an amount (the field refuses other keystrokes). */
export function isAmountDraft(text: string): boolean {
  return AMOUNT_DRAFT.test(latinDigits(text.trim()));
}

/**
 * The typed amount in minor units, computed without floating point; null for an empty field and
 * undefined for text that is not an amount.
 */
export function parseAmount(text: string): number | null | undefined {
  const match = AMOUNT_DRAFT.exec(latinDigits(text.trim()));
  if (!match) return undefined;
  const [, units = '', decimals = ''] = match;
  if (!units && !decimals) return null;
  return Number(units || '0') * MINOR_PER_UNIT + Number(decimals.padEnd(2, '0'));
}

/** An amount in minor units as editable text: `1500`, `1500.50`, or empty for none. */
export function amountText(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return '';
  const units = Math.floor(minor / MINOR_PER_UNIT);
  const cents = minor % MINOR_PER_UNIT;
  return cents === 0 ? String(units) : `${units}.${String(cents).padStart(2, '0')}`;
}
