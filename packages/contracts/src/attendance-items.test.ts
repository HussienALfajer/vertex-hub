import { describe, expect, it } from 'vitest';
import {
  attendanceDateSubjectId,
  createHrOpinionSchema,
  createHrRequestSchema,
  dayItems,
  type ItemsInput,
  itemOutcome,
  overtimeCreditDays,
  proposedFraction,
  requestsOverlap,
  tierFraction,
} from './index.js';

const TIERS = [
  { upToMinutes: 30, fraction: 0.25 },
  { upToMinutes: 60, fraction: 0.5 },
  { upToMinutes: null, fraction: 1 },
] as const;

const day = (rest: Partial<ItemsInput> = {}): ItemsInput => ({
  phase: 'during',
  trial: false,
  status: 'in_progress',
  lateMinutes: 0,
  earlyMinutes: 0,
  overtimeMinutes: 0,
  missingOut: false,
  ...rest,
});

describe('the items a day raises (rules C14 and C17)', () => {
  it('raises lateness and early leave while the day runs', () => {
    expect(dayItems(day({ lateMinutes: 25, earlyMinutes: 40 }))).toEqual([
      { kind: 'lateness', minutes: 25 },
      { kind: 'early_leave', minutes: 40 },
    ]);
  });

  it('raises absence, missing out and overtime only once the day has ended', () => {
    const ended = { status: 'absent', missingOut: true, overtimeMinutes: 45 } as const;
    expect(dayItems(day(ended))).toEqual([]);
    expect(dayItems(day({ ...ended, phase: 'after' }))).toEqual([
      { kind: 'absence', minutes: 0 },
      { kind: 'missing_out', minutes: 0 },
      { kind: 'overtime', minutes: 45 },
    ]);
  });

  it('raises nothing in trial or before the day', () => {
    expect(dayItems(day({ trial: true, lateMinutes: 90 }))).toEqual([]);
    expect(dayItems(day({ phase: 'before', lateMinutes: 90 }))).toEqual([]);
  });
});

describe('the proposal (rule C17)', () => {
  const context = {
    tiers: TIERS,
    firstLatenessWarning: true,
    firstLatenessOfMonth: false,
    halfDayLeave: false,
  };

  it('takes the first tier covering the minutes, the open one last', () => {
    expect(tierFraction(30, TIERS)).toBe(0.25);
    expect(tierFraction(31, TIERS)).toBe(0.5);
    expect(tierFraction(500, TIERS)).toBe(1);
  });

  it('proposes a warning for the first lateness of the month when the setting says so', () => {
    const late = { kind: 'lateness', minutes: 45 } as const;
    expect(proposedFraction(late, context)).toBe(0.5);
    expect(proposedFraction(late, { ...context, firstLatenessOfMonth: true })).toBe(0);
    expect(
      proposedFraction(late, {
        ...context,
        firstLatenessOfMonth: true,
        firstLatenessWarning: false,
      }),
    ).toBe(0.5);
    expect(
      proposedFraction(
        { kind: 'early_leave', minutes: 45 },
        { ...context, firstLatenessOfMonth: true },
      ),
    ).toBe(0.5);
  });

  it('proposes a whole day of absence, half beside a half-day leave, and nothing otherwise', () => {
    const absence = { kind: 'absence', minutes: 0 } as const;
    expect(proposedFraction(absence, context)).toBe(1);
    expect(proposedFraction(absence, { ...context, halfDayLeave: true })).toBe(0.5);
    expect(proposedFraction({ kind: 'missing_out', minutes: 0 }, context)).toBe(0);
    expect(proposedFraction({ kind: 'overtime', minutes: 90 }, context)).toBe(0);
  });
});

describe('deciding an item (rule C18)', () => {
  const late = { kind: 'lateness', minutes: 45, proposedFraction: 0.5 } as const;
  const overtime = { kind: 'overtime', minutes: 120, proposedFraction: 0 } as const;

  it('deducts the proposal or the chosen fraction', () => {
    expect(itemOutcome(late, { decision: 'deducted' })).toEqual({
      status: 'deducted',
      decidedFraction: 0.5,
      decidedMinutes: null,
    });
    expect(itemOutcome(late, { decision: 'deducted', fraction: 0.25 })?.decidedFraction).toBe(0.25);
    expect(itemOutcome({ ...late, proposedFraction: 0 }, { decision: 'deducted' })).toBeNull();
    expect(itemOutcome(late, { decision: 'warned' })?.status).toBe('warned');
  });

  it('pays or credits at most the overtime minutes', () => {
    expect(itemOutcome(overtime, { decision: 'time_off' })?.decidedMinutes).toBe(120);
    expect(itemOutcome(overtime, { decision: 'paid', minutes: 60 })?.decidedMinutes).toBe(60);
    expect(itemOutcome(overtime, { decision: 'paid', minutes: 121 })).toBeNull();
  });

  it('refuses a decision the kind does not take, or a value it does not take', () => {
    expect(itemOutcome(late, { decision: 'paid' })).toBeNull();
    expect(itemOutcome(overtime, { decision: 'deducted', fraction: 1 })).toBeNull();
    expect(
      itemOutcome({ kind: 'missing_out', minutes: 0, proposedFraction: 0 }, { decision: 'warned' }),
    ).toBeNull();
    expect(itemOutcome(late, { decision: 'waived', fraction: 0.25 })).toBeNull();
    expect(itemOutcome(late, { decision: 'deducted', minutes: 10 })).toBeNull();
  });

  it('credits overtime in annual days, rounded down to a half day', () => {
    expect(overtimeCreditDays(480, 480)).toBe(1);
    expect(overtimeCreditDays(470, 480)).toBe(0.5);
    expect(overtimeCreditDays(200, 480)).toBe(0);
  });
});

describe('remote days and corrections (rule C19)', () => {
  it('need a reason; remote days run forward and at most 31 days', () => {
    const remote = { kind: 'remote_day', startsOn: '2026-11-01', endsOn: '2026-11-02' } as const;
    expect(createHrRequestSchema.safeParse({ ...remote, reason: 'Repairs' }).success).toBe(true);
    expect(createHrRequestSchema.safeParse(remote).success).toBe(false);
    expect(
      createHrRequestSchema.safeParse({ ...remote, endsOn: '2026-10-31', reason: 'x' }).success,
    ).toBe(false);
    expect(
      createHrRequestSchema.safeParse({ ...remote, endsOn: '2026-12-02', reason: 'x' }).success,
    ).toBe(false);
    const correction = { kind: 'correction', date: '2026-10-21', direction: 'out', time: '17:05' };
    expect(createHrRequestSchema.safeParse({ ...correction, reason: 'Forgot' }).success).toBe(true);
    expect(createHrRequestSchema.safeParse(correction).success).toBe(false);
  });

  it('lets a remote day meet only another remote day', () => {
    const span = {
      startsOn: '2026-11-01',
      endsOn: '2026-11-01',
      half: null,
      fromTime: null,
      toTime: null,
    };
    const remote = { ...span, kind: 'remote_day' } as const;
    expect(requestsOverlap(remote, remote)).toBe(true);
    expect(requestsOverlap(remote, { ...span, kind: 'leave' })).toBe(false);
    expect(
      requestsOverlap({ ...span, kind: 'permission', fromTime: '09:00', toTime: '10:00' }, remote),
    ).toBe(false);
  });
});

describe('opinions (rule B14)', () => {
  it('are on a request or an item, not both', () => {
    const id = '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
    expect(createHrOpinionSchema.safeParse({ itemId: id, body: 'ok' }).success).toBe(true);
    expect(createHrOpinionSchema.safeParse({ requestId: id, body: 'ok' }).success).toBe(true);
    expect(createHrOpinionSchema.safeParse({ body: 'ok' }).success).toBe(false);
    expect(createHrOpinionSchema.safeParse({ requestId: id, itemId: id, body: 'ok' }).success).toBe(
      false,
    );
  });
});

it('gives each date one subject id', () => {
  expect(attendanceDateSubjectId('2026-10-22')).toBe('00000000-0000-7000-8000-000020261022');
});
