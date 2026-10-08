import { describe, expect, it } from 'vitest';
import { count } from './update-count';

describe('count', () => {
  it('reads Latin and Arabic-Indic digits', () => {
    expect(count('1250')).toBe(1250);
    expect(count('١٢٥٠')).toBe(1250);
    expect(count(' 0 ')).toBe(0);
  });

  it('drops thousands separators: a count is whole', () => {
    expect(count('15,000')).toBe(15000);
    expect(count('١٥٬٠٠٠')).toBe(15000);
    expect(count('15 000')).toBe(15000);
  });

  it('refuses anything else', () => {
    for (const text of ['', '12.5', '١٢٫٥', '-3', '12a', 'abc']) {
      expect(count(text), text).toBeNaN();
    }
  });
});
