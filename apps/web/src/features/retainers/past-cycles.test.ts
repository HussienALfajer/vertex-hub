import { describe, expect, it, vi } from 'vitest';
import { type PastCycleDraft, parsePastCycles, pastCycleDrafts } from './past-cycles';

// The auth client reads the page's origin when its module loads.
vi.hoisted(() => vi.stubGlobal('window', { location: { origin: 'http://localhost' } }));

const entered = (delivered: (number | null)[]): PastCycleDraft => ({
  billing: 'draft_now',
  delivery: 'entered',
  delivered,
});

describe('past cycles (F05C B2–B4)', () => {
  it('fills missing cycles with the defaults and keeps the choices made', () => {
    const drafts = pastCycleDrafts([entered([1, 2])], 2);
    expect(drafts).toEqual([
      entered([1, 2]),
      { billing: 'billed_externally', delivery: 'untracked', delivered: [] },
    ]);
    expect(pastCycleDrafts(drafts, 1)).toEqual([entered([1, 2])]);
  });

  it('builds one entry per past cycle, with a count per line when entered', () => {
    expect(parsePastCycles([entered([10, 4])], 2, 2)).toEqual({
      entries: [
        { cycle: 1, billing: 'draft_now', delivery: 'entered', delivered: [10, 4] },
        { cycle: 2, billing: 'billed_externally', delivery: 'untracked' },
      ],
    });
    expect(parsePastCycles([], 0, 2)).toEqual({ entries: [] });
  });

  it('names the cycles whose counts are missing or out of range', () => {
    expect(parsePastCycles([entered([10]), entered([1, 1000])], 2, 2)).toEqual({
      invalid: [1, 2],
    });
  });
});
