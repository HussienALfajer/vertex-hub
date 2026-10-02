import { describe, expect, it } from 'vitest';
import { convertMinor, exchangeRateSchema, invoiceTotal, toUsdMinor } from './money.js';

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
