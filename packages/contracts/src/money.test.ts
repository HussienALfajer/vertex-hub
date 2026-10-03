import { describe, expect, it } from 'vitest';
import {
  applyPayment,
  convertMinor,
  exchangeRateSchema,
  invoiceTotal,
  statementRows,
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

describe('statementRows', () => {
  const invoice = (id: string, issuedOn: string, totalMinor: number) => ({
    id,
    displayNumber: `INV-2026-${id}`,
    issuedOn,
    totalMinor,
  });
  const payment = (
    id: string,
    invoiceId: string,
    paidOn: string,
    appliedMinor: number,
    other?: { amountMinor: number; currency: 'SYP' },
  ) => ({
    id,
    receiptNumber: `RC-2026-${id}`,
    invoiceId,
    invoiceNumber: `INV-2026-${invoiceId}`,
    paidOn,
    appliedMinor,
    amountMinor: other?.amountMinor ?? appliedMinor,
    currency: other?.currency ?? ('USD' as const),
  });

  it('carries the opening balance and runs the balance through the period', () => {
    const result = statementRows({
      invoices: [invoice('0001', '2026-01-10', 10_000), invoice('0002', '2026-03-01', 5_000)],
      payments: [
        payment('0001', '0001', '2026-01-20', 4_000),
        payment('0002', '0001', '2026-03-01', 6_000, { amountMinor: 711_000, currency: 'SYP' }),
      ],
      statementCurrency: 'USD',
      from: '2026-02-01',
      to: '2026-12-31',
    });
    expect(result.openingMinor).toBe(6_000);
    // Same day: the invoice before the payment.
    expect(result.rows.map((row) => [row.number, row.balanceMinor])).toEqual([
      ['INV-2026-0002', 11_000],
      ['RC-2026-0002', 5_000],
    ]);
    expect(result.rows[1]?.original).toEqual({ amountMinor: 711_000, currency: 'SYP' });
    expect(result.rows[0]?.original).toBeNull();
    expect(result).toMatchObject({ closingMinor: 5_000, invoicedMinor: 5_000, paidMinor: 6_000 });
  });

  it('leaves out documents after the period', () => {
    const result = statementRows({
      invoices: [invoice('0001', '2026-05-01', 10_000)],
      payments: [payment('0001', '0001', '2026-05-02', 10_000)],
      statementCurrency: 'USD',
      from: '2026-01-01',
      to: '2026-04-30',
    });
    expect(result).toMatchObject({ openingMinor: 0, rows: [], closingMinor: 0 });
  });

  it('goes negative for a payment received before its invoice (edge case 15)', () => {
    const result = statementRows({
      invoices: [invoice('0001', '2026-05-10', 10_000)],
      payments: [payment('0001', '0001', '2026-05-01', 3_000)],
      statementCurrency: 'USD',
      from: '2026-05-01',
      to: '2026-05-05',
    });
    expect(result.rows.map((row) => row.balanceMinor)).toEqual([-3_000]);
    expect(result.closingMinor).toBe(-3_000);
  });
});
