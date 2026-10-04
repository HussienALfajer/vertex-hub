import { describe, expect, it } from 'vitest';
import { defaultPeriod } from './update-period';

describe('defaultPeriod', () => {
  it('is the 7 days ending yesterday', () => {
    expect(defaultPeriod('2026-10-20')).toEqual({
      periodStart: '2026-10-13',
      periodEnd: '2026-10-19',
    });
  });

  it('is cut at the start of the month', () => {
    expect(defaultPeriod('2026-10-04')).toEqual({
      periodStart: '2026-10-01',
      periodEnd: '2026-10-03',
    });
  });

  it('is the last days of the previous month on the 1st', () => {
    expect(defaultPeriod('2026-10-01')).toEqual({
      periodStart: '2026-09-24',
      periodEnd: '2026-09-30',
    });
  });
});
