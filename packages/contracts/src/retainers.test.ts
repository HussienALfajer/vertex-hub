import { describe, expect, it } from 'vitest';
import { addDays, daysInclusive, firstOfMonth, lastOfMonth } from './dates.js';
import {
  billingNeedsNote,
  createExtraWorkSchema,
  extraWorkBillingChangeSchema,
  extraWorkListQuerySchema,
} from './extra-work.js';
import {
  behindAlert,
  canChangeRetainerStatus,
  cancelRetainerTermSchema,
  createCycleAdjustmentSchema,
  createCycleLineSchema,
  createRetainerSchema,
  createRetainerTermSchema,
  dayAfterTerm,
  deliveryRate,
  duplicateDeliverables,
  isLineBehind,
  RETAINER_STATUSES,
  renewalState,
  retainerDeliverablesSchema,
  retainerListQuerySchema,
  retainerStatusChangeSchema,
  scheduleMatches,
  splitEvenly,
  termEndMonth,
  termMonths,
  updateCycleLineSchema,
  updateRetainerSchema,
  updateRetainerTermSchema,
} from './retainers.js';

const retainer = {
  clientId: '01a0e97d-0028-7d46-8479-9fa1ea9ffcd7',
  name: ' Social media management ',
  departments: ['content_management', 'design'],
  startDate: '2026-10-01',
};

describe('calendar helpers', () => {
  it('counts days with both ends included', () => {
    expect(daysInclusive('2026-10-01', '2026-10-31')).toBe(31);
    expect(daysInclusive('2026-10-31', '2026-10-31')).toBe(1);
    expect(daysInclusive('2026-10-02', '2026-10-01')).toBe(0);
  });

  it('finds month edges, including February of a leap year', () => {
    expect(firstOfMonth('2026-10-17')).toBe('2026-10-01');
    expect(lastOfMonth('2026-10-17')).toBe('2026-10-31');
    expect(lastOfMonth('2028-02-03')).toBe('2028-02-29');
    expect(lastOfMonth('2026-12-31')).toBe('2026-12-31');
  });

  it('moves across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('createRetainerSchema', () => {
  it('fills the defaults and leaves money out unless sent', () => {
    expect(createRetainerSchema.parse(retainer)).toEqual({
      ...retainer,
      name: 'Social media management',
      deliverables: [],
    });
  });

  it('requires a label for "other" only, and trims labels', () => {
    const parse = (line: object) =>
      createRetainerSchema.safeParse({ ...retainer, deliverables: [line] });
    expect(parse({ kind: 'design', monthlyQuantity: 12 }).success).toBe(true);
    expect(parse({ kind: 'other', monthlyQuantity: 1 }).success).toBe(false);
    expect(parse({ kind: 'other', label: '  ', monthlyQuantity: 1 }).success).toBe(false);
    const parsed = parse({ kind: 'other', label: ' Podcast ', monthlyQuantity: 1 });
    expect(parsed.data?.deliverables[0]?.label).toBe('Podcast');
  });

  it('keeps monthly quantities between 1 and 999', () => {
    const parse = (monthlyQuantity: number) =>
      createRetainerSchema.safeParse({
        ...retainer,
        deliverables: [{ kind: 'reel', monthlyQuantity }],
      }).success;
    expect(parse(1)).toBe(true);
    expect(parse(999)).toBe(true);
    expect(parse(0)).toBe(false);
    expect(parse(1000)).toBe(false);
    expect(parse(1.5)).toBe(false);
  });

  it('takes money as non-negative integer minor units', () => {
    expect(
      createRetainerSchema.parse({ ...retainer, monthlyFeeMinor: 150000 }).monthlyFeeMinor,
    ).toBe(150000);
    expect(createRetainerSchema.safeParse({ ...retainer, monthlyFeeMinor: -1 }).success).toBe(
      false,
    );
    expect(createRetainerSchema.safeParse({ ...retainer, monthlyFeeMinor: 10.5 }).success).toBe(
      false,
    );
    expect(createRetainerSchema.safeParse({ ...retainer, currency: 'EUR' }).success).toBe(false);
  });

  it('refuses malformed dates', () => {
    expect(createRetainerSchema.safeParse({ ...retainer, startDate: '2026-02-30' }).success).toBe(
      false,
    );
    expect(createRetainerSchema.safeParse({ ...retainer, renewalDate: '01/10/2027' }).success).toBe(
      false,
    );
  });
});

describe('updateRetainerSchema and retainerDeliverablesSchema', () => {
  it('accepts any subset and a cleared renewal date or fee', () => {
    expect(updateRetainerSchema.parse({})).toEqual({});
    expect(updateRetainerSchema.parse({ renewalDate: null, monthlyFeeMinor: null })).toEqual({
      renewalDate: null,
      monthlyFeeMinor: null,
    });
  });

  it('refuses an existing line listed twice', () => {
    const id = '01a0e97d-0028-7d46-8479-9fa1ea9ffcd9';
    expect(
      retainerDeliverablesSchema.safeParse({
        lines: [
          { id, kind: 'design', monthlyQuantity: 1 },
          { id, kind: 'reel', monthlyQuantity: 1 },
        ],
      }).success,
    ).toBe(false);
  });

  it('takes existing lines by id and new lines without one', () => {
    const parsed = retainerDeliverablesSchema.parse({
      lines: [
        { id: '01a0e97d-0028-7d46-8479-9fa1ea9ffcd9', kind: 'design', monthlyQuantity: 12 },
        { kind: 'monthly_report', monthlyQuantity: 1 },
      ],
    });
    expect(parsed.lines.map((line) => line.id)).toEqual([
      '01a0e97d-0028-7d46-8479-9fa1ea9ffcd9',
      undefined,
    ]);
  });
});

describe('duplicateDeliverables', () => {
  it('finds lines of the same kind and label, case-insensitively', () => {
    const lines = [
      { kind: 'design' as const, label: null },
      { kind: 'design' as const, label: 'Print' },
      { kind: 'other' as const, label: 'Podcast' },
      { kind: 'other' as const, label: 'podcast' },
      { kind: 'design' as const },
    ];
    expect(duplicateDeliverables(lines)).toEqual([lines[3], lines[4]]);
  });
});

describe('cycle inputs', () => {
  it('needs a reason for every change', () => {
    expect(updateCycleLineSchema.safeParse({ committedQuantity: 5 }).success).toBe(false);
    expect(updateCycleLineSchema.safeParse({ committedQuantity: 5, reason: ' ' }).success).toBe(
      false,
    );
    expect(updateCycleLineSchema.parse({ committedQuantity: 0, reason: ' Agreed ' })).toEqual({
      committedQuantity: 0,
      reason: 'Agreed',
    });
  });

  it('refuses a zero or out-of-range adjustment', () => {
    const parse = (delta: number) =>
      createCycleAdjustmentSchema.safeParse({ delta, reason: 'Posted by hand' }).success;
    expect(parse(3)).toBe(true);
    expect(parse(-999)).toBe(true);
    expect(parse(0)).toBe(false);
    expect(parse(1000)).toBe(false);
  });

  it('requires a label for an added "other" line', () => {
    expect(
      createCycleLineSchema.safeParse({ kind: 'other', committedQuantity: 1, reason: 'Extra' })
        .success,
    ).toBe(false);
  });
});

describe('retainer status transitions', () => {
  it('allows only the transitions of the diagram', () => {
    const allowed = RETAINER_STATUSES.flatMap((from) =>
      RETAINER_STATUSES.filter((to) => canChangeRetainerStatus(from, to)).map(
        (to) => `${from}→${to}`,
      ),
    );
    expect(allowed).toEqual([
      'active→paused',
      'active→ended',
      'paused→active',
      'paused→ended',
      'ended→active',
    ]);
  });
});

describe('isLineBehind (R11)', () => {
  const october = { periodStart: '2026-10-01', periodEnd: '2026-10-31' };

  it('is behind when completion trails the elapsed share by more than 25 points', () => {
    // 16 Oct: 16/31 elapsed ≈ 0.516; the threshold is ≈ 0.266.
    expect(isLineBehind({ committed: 12, delivered: 3 }, october, '2026-10-16')).toBe(true);
    expect(isLineBehind({ committed: 12, delivered: 4 }, october, '2026-10-16')).toBe(false);
  });

  it('is never behind at the start of the period or when complete', () => {
    expect(isLineBehind({ committed: 12, delivered: 0 }, october, '2026-10-01')).toBe(false);
    expect(isLineBehind({ committed: 12, delivered: 12 }, october, '2026-10-30')).toBe(false);
    expect(isLineBehind({ committed: 4, delivered: 6 }, october, '2026-10-30')).toBe(false);
  });

  it('is behind in the last 7 days (today included) while incomplete', () => {
    expect(isLineBehind({ committed: 12, delivered: 11 }, october, '2026-10-25')).toBe(true);
    expect(isLineBehind({ committed: 12, delivered: 11 }, october, '2026-10-24')).toBe(false);
  });

  it('never counts a line with nothing committed', () => {
    expect(isLineBehind({ committed: 0, delivered: 0 }, october, '2026-10-31')).toBe(false);
  });

  it('measures a partial first month from its own start (edge case 4)', () => {
    const lastDay = { periodStart: '2026-10-31', periodEnd: '2026-10-31' };
    expect(isLineBehind({ committed: 12, delivered: 0 }, lastDay, '2026-10-31')).toBe(true);
    const rest = { periodStart: '2026-10-20', periodEnd: '2026-10-31' };
    // 12 days: on the first, 12 remain and 1/12 has elapsed.
    expect(isLineBehind({ committed: 12, delivered: 0 }, rest, '2026-10-20')).toBe(false);
    expect(isLineBehind({ committed: 12, delivered: 0 }, rest, '2026-10-25')).toBe(true);
  });
});

describe('behindAlert (P2A rules 1–3)', () => {
  const october = { periodStart: '2026-10-01', periodEnd: '2026-10-31' };

  it('sends the first alert at 7 days or fewer and the final one at 3 or fewer', () => {
    expect(behindAlert(october, '2026-10-24')).toBeNull(); // 8 days left
    expect(behindAlert(october, '2026-10-25')).toBe('first'); // 7
    expect(behindAlert(october, '2026-10-28')).toBe('first'); // 4
    expect(behindAlert(october, '2026-10-29')).toBe('final'); // 3
    expect(behindAlert(october, '2026-10-31')).toBe('final'); // 1
    expect(behindAlert(october, '2026-11-01')).toBeNull();
  });

  it('skips a cycle whose period is 7 days or shorter', () => {
    const sevenDays = { periodStart: '2026-10-25', periodEnd: '2026-10-31' };
    expect(behindAlert(sevenDays, '2026-10-25')).toBeNull();
    expect(behindAlert(sevenDays, '2026-10-31')).toBeNull();
    const eightDays = { periodStart: '2026-10-24', periodEnd: '2026-10-31' };
    expect(behindAlert(eightDays, '2026-10-24')).toBeNull();
    expect(behindAlert(eightDays, '2026-10-25')).toBe('first');
    expect(behindAlert(eightDays, '2026-10-30')).toBe('final');
  });

  it('follows the length of the month', () => {
    const february = { periodStart: '2027-02-01', periodEnd: '2027-02-28' };
    expect(behindAlert(february, '2027-02-21')).toBeNull();
    expect(behindAlert(february, '2027-02-22')).toBe('first');
    expect(behindAlert(february, '2027-02-26')).toBe('final');
  });
});

describe('deliveryRate (R13)', () => {
  it('caps each line at its commitment, so over-delivery hides no shortfall', () => {
    expect(
      deliveryRate([
        { committed: 12, delivered: 20 },
        { committed: 4, delivered: 0 },
      ]),
    ).toBe(75);
  });

  it('rounds down and is null when nothing is committed', () => {
    expect(deliveryRate([{ committed: 3, delivered: 2 }])).toBe(66);
    expect(deliveryRate([{ committed: 0, delivered: 2 }])).toBeNull();
    expect(deliveryRate([])).toBeNull();
  });
});

describe('renewalState (R6)', () => {
  it('is due from 30 days before, overdue after, and never once ended', () => {
    expect(renewalState('2026-12-31', 'active', '2026-12-01')).toBe('due');
    expect(renewalState('2026-12-31', 'active', '2026-11-30')).toBeNull();
    expect(renewalState('2026-12-31', 'paused', '2026-12-31')).toBe('due');
    expect(renewalState('2026-12-31', 'active', '2027-01-01')).toBe('overdue');
    expect(renewalState('2026-12-31', 'ended', '2027-01-01')).toBeNull();
    expect(renewalState(null, 'active', '2027-01-01')).toBeNull();
  });
});

describe('retainerListQuerySchema', () => {
  it('lists active and paused retainers by client name by default', () => {
    expect(retainerListQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 50,
      status: ['active', 'paused'],
      archived: false,
      sort: 'clientName',
      order: 'asc',
    });
  });
});

describe('extra work', () => {
  it('needs a note for billed and waived only', () => {
    expect(billingNeedsNote('unbilled')).toBe(false);
    expect(billingNeedsNote('billed')).toBe(true);
    expect(billingNeedsNote('waived')).toBe(true);
    expect(
      extraWorkBillingChangeSchema.parse({ billingStatus: 'waived', billingNote: ' ' }),
    ).toEqual({ billingStatus: 'waived', billingNote: null });
  });

  it('takes a title and optional fields; estimates are non-negative integers', () => {
    expect(createExtraWorkSchema.parse({ title: ' Extra reel ' })).toEqual({ title: 'Extra reel' });
    expect(createExtraWorkSchema.safeParse({ title: 'x', estimateMinor: -5 }).success).toBe(false);
    expect(createExtraWorkSchema.safeParse({ title: '' }).success).toBe(false);
  });

  it('lists every billing status by default', () => {
    expect(extraWorkListQuerySchema.parse({}).billingStatus).toEqual([
      'unbilled',
      'billed',
      'waived',
    ]);
  });
});

describe('terms (F05B T1–T11)', () => {
  it('splits a total evenly with the remainder on the last month (T3)', () => {
    expect(splitEvenly(100000, 3)).toEqual([33333, 33333, 33334]);
    expect(splitEvenly(100000, 1)).toEqual([100000]);
    expect(splitEvenly(0, 4)).toEqual([0, 0, 0, 0]);
    const long = splitEvenly(100001, 36);
    expect(long).toHaveLength(36);
    expect(long.reduce((sum, amount) => sum + amount, 0)).toBe(100001);
    expect(long[0]).toBe(2777);
    expect(long[35]).toBe(2806);
    expect(splitEvenly(2, 3)).toEqual([0, 0, 2]);
  });

  it('checks the schedule against the months and the total', () => {
    const term = { months: 3, agreedTotalMinor: 100000, schedule: [30000, 30000, 40000] };
    expect(scheduleMatches(term)).toBe(true);
    expect(scheduleMatches({ ...term, schedule: [30000, 30000, 39999] })).toBe(false);
    expect(scheduleMatches({ ...term, schedule: [30000, 70000] })).toBe(false);
    expect(scheduleMatches({ months: 3, agreedTotalMinor: 100000, schedule: [100000, 0, 0] })).toBe(
      true,
    );
  });

  it('places the months of a term across years', () => {
    expect(termMonths('2026-11-01', 3)).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
    expect(termEndMonth('2026-11-01', 3)).toBe('2027-01-01');
    expect(termEndMonth('2026-11-01', 1)).toBe('2026-11-01');
    expect(dayAfterTerm('2027-01-01')).toBe('2027-02-01');
  });

  it('takes a term from the first of a month, 1 to 36 months, renewing by default', () => {
    const input = { startMonth: '2026-11-01', months: 3, agreedTotalMinor: 0, schedule: [0, 0, 0] };
    expect(createRetainerTermSchema.parse(input).endAction).toBe('renew');
    expect(createRetainerTermSchema.safeParse({ ...input, startMonth: '2026-11-02' }).success).toBe(
      false,
    );
    expect(createRetainerTermSchema.safeParse({ ...input, months: 0 }).success).toBe(false);
    expect(createRetainerTermSchema.safeParse({ ...input, months: 37 }).success).toBe(false);
    expect(createRetainerTermSchema.safeParse({ ...input, schedule: [-1, 0, 1] }).success).toBe(
      false,
    );
    expect(updateRetainerTermSchema.parse({ endAction: 'end' })).toEqual({ endAction: 'end' });
    expect(cancelRetainerTermSchema.safeParse({ reason: '  ' }).success).toBe(false);
  });

  it('takes a term on a new retainer and a fee when it ends (E2)', () => {
    const parsed = createRetainerSchema.parse({
      ...retainer,
      term: { months: 2, agreedTotalMinor: 1000, schedule: [500, 500] },
    });
    expect(parsed.term?.endAction).toBe('renew');
    const ended = { status: 'ended', termination: { feeMinor: 20000, reason: ' early end ' } };
    expect(retainerStatusChangeSchema.parse(ended).termination?.reason).toBe('early end');
    const free = { status: 'ended', termination: { feeMinor: 0, reason: 'x' } };
    expect(retainerStatusChangeSchema.safeParse(free).success).toBe(false);
  });
});
