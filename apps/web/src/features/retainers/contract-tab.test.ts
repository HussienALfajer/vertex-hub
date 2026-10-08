import type { RetainerDetail, RetainerTerm } from '@vertex-hub/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { earliestStart } from './contract-tab';

// The auth client reads the page's origin when its module loads.
vi.hoisted(() => vi.stubGlobal('window', { location: { origin: 'http://localhost' } }));

const retainer = (startDate: string) => ({ startDate }) as RetainerDetail;
const term = (status: RetainerTerm['status'], endMonth: string) =>
  ({ status, endMonth }) as RetainerTerm;

describe('earliestStart (T2)', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T09:00:00Z'));
  });
  afterAll(() => vi.useRealTimers());

  it('is this month for a retainer that started before it', () => {
    expect(earliestStart(retainer('2026-03-10'), [])).toBe('2026-10-01');
  });

  it('is the month of a later start date', () => {
    expect(earliestStart(retainer('2027-01-20'), [])).toBe('2027-01-01');
  });

  it('follows every term that is not cancelled, in any order', () => {
    const others = [
      term('scheduled', '2027-03-01'),
      term('active', '2026-12-01'),
      term('cancelled', '2027-08-01'),
    ];
    expect(earliestStart(retainer('2026-03-10'), others)).toBe('2027-04-01');
  });

  it('ignores a term that ended before this month', () => {
    expect(earliestStart(retainer('2025-01-01'), [term('completed', '2026-06-01')])).toBe(
      '2026-10-01',
    );
  });
});
