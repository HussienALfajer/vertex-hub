import type { CalendarIssue, CalendarOccasion } from '@vertex-hub/contracts';
import { describe, expect, it } from 'vitest';
import { gapClientsOn, occasionsOn, occasionUncovered, tooClosePostIds } from './calendar-marks';

const occasion = (fields: Partial<CalendarOccasion>): CalendarOccasion => ({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Eid',
  category: 'general',
  clientId: null,
  startDate: '2026-11-10',
  endDate: '2026-11-12',
  leadDays: 7,
  confirmed: false,
  covered: null,
  skipped: null,
  ...fields,
});

const issue = (fields: Partial<CalendarIssue> & Pick<CalendarIssue, 'kind'>): CalendarIssue => ({
  clientId: 'client-a',
  date: '2026-11-01',
  endDate: null,
  postIds: [],
  platform: null,
  occasionId: null,
  commitment: null,
  planned: null,
  committed: null,
  ...fields,
});

describe('content calendar marks', () => {
  it('shows an occasion on each of its days only', () => {
    const occasions = [occasion({})];
    expect(occasionsOn(occasions, '2026-11-09')).toHaveLength(0);
    expect(occasionsOn(occasions, '2026-11-10')).toHaveLength(1);
    expect(occasionsOn(occasions, '2026-11-12')).toHaveLength(1);
    expect(occasionsOn(occasions, '2026-11-13')).toHaveLength(0);
  });

  it('warns of an occasion only on a client calendar, uncovered and not skipped', () => {
    expect(occasionUncovered(occasion({}))).toBe(false);
    expect(occasionUncovered(occasion({ covered: false, skipped: false }))).toBe(true);
    expect(occasionUncovered(occasion({ covered: false, skipped: true }))).toBe(false);
    expect(occasionUncovered(occasion({ covered: true, skipped: false }))).toBe(false);
  });

  it('marks every day of a gap with its client', () => {
    const issues = [
      issue({ kind: 'gap', date: '2026-11-03', endDate: '2026-11-07' }),
      issue({ kind: 'gap', clientId: 'client-b', date: '2026-11-07', endDate: '2026-11-08' }),
      issue({ kind: 'pillar_mix', date: '2026-11-01' }),
    ];
    expect(gapClientsOn(issues, '2026-11-02')).toEqual([]);
    expect(gapClientsOn(issues, '2026-11-03')).toEqual(['client-a']);
    expect(gapClientsOn(issues, '2026-11-07')).toEqual(['client-a', 'client-b']);
    expect(gapClientsOn(issues, '2026-11-01')).toEqual([]);
  });

  it('collects the posts that are too close', () => {
    const issues = [
      issue({ kind: 'too_close', postIds: ['p1', 'p2'] }),
      issue({ kind: 'too_close', postIds: ['p2', 'p3'] }),
      issue({ kind: 'gap', postIds: [] }),
    ];
    expect([...tooClosePostIds(issues)].sort()).toEqual(['p1', 'p2', 'p3']);
  });
});
