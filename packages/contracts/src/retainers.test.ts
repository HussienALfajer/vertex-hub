import { describe, expect, it } from 'vitest';
import { addDays, daysInclusive, firstOfMonth, lastOfMonth } from './dates.js';
import {
  billingNeedsNote,
  createExtraWorkSchema,
  extraWorkBillingChangeSchema,
  extraWorkListQuerySchema,
} from './extra-work.js';
import {
  amendmentMoneyDelta,
  amendmentNeedsApproval,
  approveAmendmentSchema,
  behindAlert,
  canChangeRetainerStatus,
  cancelRetainerTermSchema,
  createAmendmentSchema,
  createCycleAdjustmentSchema,
  createCycleLineSchema,
  createRetainerSchema,
  createRetainerTermSchema,
  dayAfterTerm,
  deliveryRate,
  duplicateDeliverables,
  isLineBehind,
  type MonthChargeState,
  planMonthChange,
  RETAINER_STATUSES,
  rejectAmendmentSchema,
  renewalState,
  rescheduleTermSchema,
  retainerDeliverablesSchema,
  retainerListQuerySchema,
  retainerStatusChangeSchema,
  scheduleMatches,
  splitEvenly,
  takeCredits,
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

describe('amendments (F05B A1–A6)', () => {
  const amendment = {
    scope: 'month',
    effectiveMonth: '2026-11-01',
    lines: [{ kind: 'reel', quantityDelta: 2 }],
    amountDeltaMinor: 10000,
    reason: ' extra reels ',
  };

  it('parses an amendment with defaults and a trimmed reason', () => {
    const parsed = createAmendmentSchema.parse({
      ...amendment,
      lines: undefined,
      amountDeltaMinor: undefined,
    });
    expect(parsed.lines).toEqual([]);
    expect(parsed.amountDeltaMinor).toBe(0);
    expect(createAmendmentSchema.parse(amendment).reason).toBe('extra reels');
    expect(
      createAmendmentSchema.parse({ ...amendment, amountDeltaMinor: -8000 }).amountDeltaMinor,
    ).toBe(-8000);
  });

  it('refuses a month that is not a first day, a zero line delta, an other line without label', () => {
    const bad = (patch: object) =>
      createAmendmentSchema.safeParse({ ...amendment, ...patch }).success;
    expect(bad({ effectiveMonth: '2026-11-02' })).toBe(false);
    expect(bad({ lines: [{ kind: 'reel', quantityDelta: 0 }] })).toBe(false);
    expect(bad({ lines: [{ kind: 'reel', quantityDelta: 1000 }] })).toBe(false);
    expect(bad({ lines: [{ kind: 'other', quantityDelta: 1 }] })).toBe(false);
    expect(bad({ reason: ' ' })).toBe(false);
    expect(bad({ scope: 'all' })).toBe(false);
    const many = Array.from({ length: 21 }, (_, index) => ({
      kind: 'other',
      label: `line ${index}`,
      quantityDelta: 1,
    }));
    expect(bad({ lines: many })).toBe(false);
  });

  it('needs a note to reject, not to approve', () => {
    expect(approveAmendmentSchema.safeParse({}).success).toBe(true);
    expect(rejectAmendmentSchema.safeParse({}).success).toBe(false);
    expect(rejectAmendmentSchema.safeParse({ note: ' ' }).success).toBe(false);
    expect(rejectAmendmentSchema.parse({ note: ' no ' }).note).toBe('no');
  });

  it('takes a reschedule of first-day months with amounts ≥ 0', () => {
    const schedule = [
      { month: '2026-11-01', amountMinor: 40000 },
      { month: '2026-12-01', amountMinor: 40000 },
    ];
    expect(rescheduleTermSchema.safeParse({ schedule, reason: 'x' }).success).toBe(true);
    expect(
      rescheduleTermSchema.safeParse({
        schedule: [{ month: '2026-11-01', amountMinor: -1 }],
        reason: 'x',
      }).success,
    ).toBe(false);
    expect(rescheduleTermSchema.safeParse({ schedule: [], reason: 'x' }).success).toBe(false);
  });

  describe('planMonthChange (C6, A3)', () => {
    const month = (patch: Partial<MonthChargeState> = {}): MonthChargeState => ({
      month: '2026-11-01',
      amountMinor: 30000,
      invoice: null,
      extrasMinor: 0,
      ...patch,
    });
    const draft = {
      id: '01a0e97d-0028-7d46-8479-9fa1ea9ffcd7',
      displayNumber: null,
      issued: false,
    };
    const issued = { ...draft, displayNumber: 'INV-2026-0012', issued: true };

    it('changes an amount no invoice bills', () => {
      expect(planMonthChange(month(), 10000)).toEqual({
        month: '2026-11-01',
        effect: 'charge_changed',
        beforeMinor: 30000,
        afterMinor: 40000,
        invoice: null,
      });
    });

    it('syncs a draft', () => {
      expect(planMonthChange(month({ invoice: draft }), -5000)).toMatchObject({
        effect: 'draft_synced',
        afterMinor: 25000,
        invoice: { id: draft.id, displayNumber: null },
      });
    });

    it('adds to or credits an issued month, paid or not', () => {
      expect(planMonthChange(month({ invoice: issued }), 10000)).toMatchObject({
        effect: 'addition',
        beforeMinor: 30000,
        afterMinor: 40000,
        invoice: { displayNumber: 'INV-2026-0012' },
      });
      expect(planMonthChange(month({ invoice: issued, extrasMinor: 10000 }), -8000)).toMatchObject({
        effect: 'credit',
        beforeMinor: 40000,
        afterMinor: 32000,
      });
    });

    it('refuses a month total or a changed charge below 0', () => {
      expect(planMonthChange(month({ invoice: issued }), -30001)).toBe('negative');
      expect(planMonthChange(month({ invoice: issued }), -30000)).toMatchObject({ afterMinor: 0 });
      // The month's addition keeps the total ≥ 0, but the charge itself cannot go negative.
      expect(planMonthChange(month({ extrasMinor: 10000 }), -35000)).toBe('negative');
      expect(planMonthChange(month({ amountMinor: 0 }), -1)).toBe('negative');
    });

    it('does nothing without an amount change', () => {
      expect(planMonthChange(month(), 0)).toBeNull();
    });
  });

  it('sums the change over its months; an open-ended fee counts once (A4)', () => {
    expect(amendmentMoneyDelta({ amountDeltaMinor: 5000, months: 2, changesFee: false })).toBe(
      10000,
    );
    expect(amendmentMoneyDelta({ amountDeltaMinor: -8000, months: 1, changesFee: false })).toBe(
      -8000,
    );
    expect(amendmentMoneyDelta({ amountDeltaMinor: -1000, months: 0, changesFee: true })).toBe(
      -1000,
    );
    expect(amendmentMoneyDelta({ amountDeltaMinor: 0, months: 3, changesFee: true })).toBe(0);
  });

  it('sends reductions to the General Manager unless the creator may approve (A4)', () => {
    expect(amendmentNeedsApproval(-1, false)).toBe(true);
    expect(amendmentNeedsApproval(-1, true)).toBe(false);
    expect(amendmentNeedsApproval(0, false)).toBe(false);
    expect(amendmentNeedsApproval(500, false)).toBe(false);
  });

  describe('takeCredits (C5)', () => {
    it('takes credits oldest first while the total stays ≥ 0', () => {
      expect(
        takeCredits(30000, [
          { id: 'a', amountMinor: -8000 },
          { id: 'b', amountMinor: -2000 },
        ]),
      ).toEqual({
        taken: [
          { id: 'a', amountMinor: -8000 },
          { id: 'b', amountMinor: -2000 },
        ],
        split: null,
      });
    });

    it('splits a credit larger than what is left', () => {
      expect(
        takeCredits(10000, [
          { id: 'a', amountMinor: -8000 },
          { id: 'b', amountMinor: -5000 },
          { id: 'c', amountMinor: -1000 },
        ]),
      ).toEqual({
        taken: [
          { id: 'a', amountMinor: -8000 },
          { id: 'b', amountMinor: -2000 },
        ],
        split: { id: 'b', appliedMinor: -2000, remainderMinor: -3000 },
      });
    });

    it('takes a credit equal to the total whole, and none from a total of 0', () => {
      expect(takeCredits(5000, [{ id: 'a', amountMinor: -5000 }]).split).toBeNull();
      expect(takeCredits(0, [{ id: 'a', amountMinor: -5000 }])).toEqual({ taken: [], split: null });
    });
  });
});
