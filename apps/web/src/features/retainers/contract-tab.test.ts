import type { RetainerDetail, RetainerTerm } from '@vertex-hub/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { earliestStart } from './contract-tab';

// The auth client reads the page's origin when its module loads.
vi.hoisted(() => vi.stubGlobal('window', { location: { origin: 'http://localhost' } }));

const retainer = (startDate: string) => ({ startDate }) as RetainerDetail;
const term = (status: RetainerTerm['status'], startCycle: number, cycles: number) =>
  ({ status, startCycle, cycles }) as RetainerTerm;

describe("earliestStart (F05C T2')", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T09:00:00Z'));
  });
  afterAll(() => vi.useRealTimers());

  it('is the current cycle of a retainer that started before it', () => {
    // From 10 March, 15 October is in cycle 8 (10 October – 9 November).
    expect(earliestStart(retainer('2026-03-10'), [])).toBe(8);
  });

  it('is the first cycle of a retainer that has not started', () => {
    expect(earliestStart(retainer('2027-01-20'), [])).toBe(1);
  });

  it('follows every term that is not cancelled, in any order', () => {
    const others = [term('scheduled', 11, 3), term('active', 8, 3), term('cancelled', 14, 6)];
    expect(earliestStart(retainer('2026-03-10'), others)).toBe(14);
  });

  it('ignores a term that ended before the current cycle', () => {
    expect(earliestStart(retainer('2025-01-01'), [term('completed', 1, 6)])).toBe(22);
  });
});
