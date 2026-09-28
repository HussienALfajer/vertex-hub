import { describe, expect, it } from 'vitest';
import i18n from './index';

describe('i18n', () => {
  it('runs in Arabic, right to left', () => {
    expect(i18n.language).toBe('ar');
    expect(i18n.dir()).toBe('rtl');
  });

  it('interpolates values into Arabic strings', () => {
    expect(i18n.t('status.checkedAt', { time: '10:00' })).toBe('آخر فحص: 10:00');
  });
});
