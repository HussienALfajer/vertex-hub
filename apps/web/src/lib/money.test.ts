import { describe, expect, it } from 'vitest';
import { amountText, formatMoney, isAmountDraft, parseAmount } from './money';

describe('money', () => {
  it('formats minor units with two decimals, Latin digits and the currency code', () => {
    expect(formatMoney(150_050, 'USD')).toMatch(/1,500\.50\sUSD/);
    // ICU shows no decimals for SYP by default; V1 keeps two (owner decision, was Q8).
    expect(formatMoney(150_000, 'SYP')).toMatch(/1,500\.00\sSYP/);
  });

  it('parses typed amounts into minor units without floating point', () => {
    expect(parseAmount('1500')).toBe(150_000);
    expect(parseAmount('1500.5')).toBe(150_050);
    expect(parseAmount('0.07')).toBe(7);
    expect(parseAmount('.5')).toBe(50);
    expect(parseAmount('19.99')).toBe(1999);
    expect(parseAmount(' 12, ')).toBe(1200);
  });

  it('reads Arabic-Indic digits and the Arabic decimal mark', () => {
    expect(parseAmount('١٥٠٠٫٢٥')).toBe(150_025);
  });

  it('tells an empty field from text that is not an amount', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('   ')).toBeNull();
    expect(parseAmount('12.345')).toBeUndefined();
    expect(parseAmount('-5')).toBeUndefined();
    expect(parseAmount('1e3')).toBeUndefined();
    expect(isAmountDraft('12.')).toBe(true);
    expect(isAmountDraft('12.3.4')).toBe(false);
  });

  it('writes minor units back as editable text', () => {
    expect(amountText(150_000)).toBe('1500');
    expect(amountText(150_005)).toBe('1500.05');
    expect(amountText(null)).toBe('');
    for (const minor of [0, 1, 99, 100, 123_456])
      expect(parseAmount(amountText(minor))).toBe(minor);
  });
});
