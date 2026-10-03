import { describe, expect, it } from 'vitest';
import {
  applyPayment,
  convertMinor,
  exchangeRateSchema,
  invoiceTotal,
  toUsdMinor,
} from './money.js';

describe('exchangeRateSchema', () => {
  it('takes a positive rate with up to 4 decimals', () => {
    expect(exchangeRateSchema.parse('118.5')).toBe('118.5');
    expect(exchangeRateSchema.parse('13000.0000')).toBe('13000.0000');
    expect(exchangeRateSchema.parse('0.0001')).toBe('0.0001');
  });

  it('refuses zero, negatives, too many decimals and other text', () => {
    for (const rate of ['0', '0.0000', '-1', '1.23456', '1e3', '', '12,5', '123456789']) {
      expect(exchangeRateSchema.safeParse(rate).success, rate).toBe(false);
    }
  });
});

describe('convertMinor', () => {
  it('keeps an amount in its own currency', () => {
    expect(convertMinor(12_345, 'USD', 'USD', '118.5')).toBe(12_345);
  });

  it('converts USD to SYP and SYP to USD', () => {
    // $100.00 at 118.5 = 11 850.00 SYP
    expect(convertMinor(10_000, 'USD', 'SYP', '118.5')).toBe(1_185_000);
    expect(convertMinor(1_185_000, 'SYP', 'USD', '118.5000')).toBe(10_000);
  });

  it('rounds half up at .5', () => {
    // 1 cent × 0.5 = 0.5 → 1; 3 cents × 0.5 = 1.5 → 2
    expect(convertMinor(1, 'USD', 'SYP', '0.5')).toBe(1);
    expect(convertMinor(3, 'USD', 'SYP', '0.5')).toBe(2);
    // 1 SYP cent ÷ 2 = 0.5 → 1; 1 ÷ 3 = 0.33 → 0
    expect(convertMinor(1, 'SYP', 'USD', '2')).toBe(1);
    expect(convertMinor(1, 'SYP', 'USD', '3')).toBe(0);
  });

  it('uses all four decimals of the rate exactly', () => {
    // 1 000 000.00 USD × 13 000.1234 = 13 000 123 400.00 SYP
    expect(convertMinor(100_000_000, 'USD', 'SYP', '13000.1234')).toBe(1_300_012_340_000);
  });

  it('stays exact for large amounts', () => {
    const large = 9_000_000_000_000;
    expect(convertMinor(large, 'SYP', 'USD', '13000')).toBe(692_307_692);
    // The intermediate product (6.5 × 10¹⁹) is far above the safe integer range.
    expect(convertMinor(500_000_000_000, 'USD', 'SYP', '13000')).toBe(6_500_000_000_000_000);
  });
});

describe('toUsdMinor', () => {
  it('converts SYP and keeps USD', () => {
    expect(toUsdMinor(1_300_000, 'SYP', '13000')).toBe(100);
    expect(toUsdMinor(100, 'USD', '13000')).toBe(100);
  });
});

describe('invoiceTotal', () => {
  it('sums quantity × unit price', () => {
    expect(invoiceTotal([])).toBe(0);
    expect(
      invoiceTotal([
        { quantity: 2, unitPriceMinor: 15_000 },
        { quantity: 1, unitPriceMinor: 0 },
        { quantity: 3, unitPriceMinor: 333 },
      ]),
    ).toBe(30_999);
  });
});

describe('applyPayment (rule 19)', () => {
  it('applies a payment in the invoice currency as is, up to the balance', () => {
    expect(applyPayment(10_000, 4_000, 'USD', 'USD', '118.5')).toBe(4_000);
    expect(applyPayment(10_000, 10_000, 'SYP', 'SYP', '118.5')).toBe(10_000);
    expect(applyPayment(10_000, 10_001, 'USD', 'USD', '118.5')).toBeNull();
  });

  it('converts a payment in the other currency, rounded half up', () => {
    // 5 925.00 SYP at 118.5 = $50.00 of a $100.00 balance
    expect(applyPayment(10_000, 592_500, 'SYP', 'USD', '118.5')).toBe(5_000);
    // $10.00 at 118.5 = 1 185.00 SYP of a 5 000.00 SYP balance
    expect(applyPayment(500_000, 1_000, 'USD', 'SYP', '118.5')).toBe(118_500);
  });

  it('settles a USD invoice paid in SYP within one SYP minor unit of the rest', () => {
    // The rest of $9.99 at 118.5 is 1 183.815 SYP: 1 183.82 and 1 183.81 both settle it.
    expect(applyPayment(999, 118_382, 'SYP', 'USD', '118.5')).toBe(999);
    expect(applyPayment(999, 118_381, 'SYP', 'USD', '118.5')).toBe(999);
    // 1 183.83 is more than one minor unit away: converted ($9.99 after rounding), not settled.
    expect(applyPayment(999, 118_383, 'SYP', 'USD', '118.5')).toBe(999);
    // 1 185.00 converts to $10.00, above the balance.
    expect(applyPayment(999, 118_500, 'SYP', 'USD', '118.5')).toBeNull();
  });

  it('settles a SYP invoice paid in USD within one cent of the rest', () => {
    // The rest of 1 000.00 SYP at 118.5 is $8.4388…: $8.44 converts to 1 000.14 SYP and settles it.
    expect(applyPayment(100_000, 844, 'USD', 'SYP', '118.5')).toBe(100_000);
    expect(applyPayment(100_000, 843, 'USD', 'SYP', '118.5')).toBe(100_000);
    // $8.42 is more than a cent short: applied as converted, the rest stays open.
    expect(applyPayment(100_000, 842, 'USD', 'SYP', '118.5')).toBe(99_777);
    // $8.46 is more than a cent over: refused.
    expect(applyPayment(100_000, 846, 'USD', 'SYP', '118.5')).toBeNull();
  });

  it('handles large amounts exactly', () => {
    // $1 000 000.00 at 13 000.1234 = 13 000 123 400.00 SYP, settled exactly
    expect(applyPayment(1_300_012_340_000, 100_000_000, 'USD', 'SYP', '13000.1234')).toBe(
      1_300_012_340_000,
    );
  });

  it('refuses a payment on a paid invoice', () => {
    expect(applyPayment(0, 1, 'USD', 'USD', '118.5')).toBeNull();
    expect(applyPayment(0, 1, 'USD', 'SYP', '118.5')).toBeNull();
  });
});
