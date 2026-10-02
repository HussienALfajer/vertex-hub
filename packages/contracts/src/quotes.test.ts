import { describe, expect, it } from 'vitest';
import {
  acceptPlanQuerySchema,
  acceptQuoteSchema,
  defaultInstallmentMilestones,
  installmentsValid,
  mergeDeliverableLines,
  needsDiscountApproval,
  type QuoteDraftInput,
  type QuoteTotalsInput,
  quoteApprovalDecisionSchema,
  quoteDisplayNumber,
  quoteDraftSchema,
  quoteListQuerySchema,
  quoteTotals,
} from './quotes.js';

const service = '0190a3c2-0000-7000-8000-000000000001';
const pkg = '0190a3c2-0000-7000-8000-000000000002';

const base: QuoteTotalsInput = {
  lines: [],
  oneOffDiscountMinor: 0,
  monthlyDiscountMinor: 0,
  installments: [],
  monthlyTermMonths: null,
};

describe('quoteTotals', () => {
  it('adds line totals into section subtotals and nets', () => {
    const totals = quoteTotals({
      ...base,
      lines: [
        { section: 'one_off', quantity: 2, unitPriceMinor: 40000, listUnitPriceMinor: 40000 },
        { section: 'monthly', quantity: 12, unitPriceMinor: 1500, listUnitPriceMinor: 1500 },
        { section: 'monthly', quantity: 1, unitPriceMinor: 45000, listUnitPriceMinor: 45000 },
      ],
      oneOffDiscountMinor: 10000,
      monthlyTermMonths: 6,
    });
    expect(totals.lineTotalsMinor).toEqual([80000, 18000, 45000]);
    expect(totals.oneOff).toMatchObject({
      subtotalMinor: 80000,
      netMinor: 70000,
      listMinor: 80000,
    });
    expect(totals.oneOff.effectiveDiscountBasisPoints).toBe(1250);
    expect(totals.monthly).toMatchObject({ subtotalMinor: 63000, netMinor: 63000 });
    expect(totals.monthly.effectiveDiscountBasisPoints).toBe(0);
    expect(totals.monthlyTermTotalMinor).toBe(378000);
  });

  it('counts lowered line prices as discount against the list', () => {
    const totals = quoteTotals({
      ...base,
      lines: [
        { section: 'one_off', quantity: 1, unitPriceMinor: 68000, listUnitPriceMinor: 80000 },
      ],
    });
    expect(totals.oneOff.effectiveDiscountBasisPoints).toBe(1500);
  });

  it('uses the line price where the list price is missing (edge case 3)', () => {
    const totals = quoteTotals({
      ...base,
      lines: [
        { section: 'monthly', quantity: 1, unitPriceMinor: 900000, listUnitPriceMinor: null },
      ],
      monthlyDiscountMinor: 90000,
    });
    expect(totals.monthly.listMinor).toBe(900000);
    expect(totals.monthly.effectiveDiscountBasisPoints).toBe(1000);
  });

  it('gives no effective discount above the list or on an empty list', () => {
    const above = quoteTotals({
      ...base,
      lines: [
        { section: 'one_off', quantity: 1, unitPriceMinor: 90000, listUnitPriceMinor: 80000 },
      ],
    });
    expect(above.oneOff.effectiveDiscountBasisPoints).toBe(0);
    const free = quoteTotals({
      ...base,
      lines: [{ section: 'one_off', quantity: 1, unitPriceMinor: 0, listUnitPriceMinor: 0 }],
    });
    expect(free.oneOff.effectiveDiscountBasisPoints).toBe(0);
    expect(quoteTotals(base).monthlyTermTotalMinor).toBeNull();
  });

  it('never nets below zero', () => {
    const totals = quoteTotals({
      ...base,
      lines: [{ section: 'one_off', quantity: 1, unitPriceMinor: 100, listUnitPriceMinor: 100 }],
      oneOffDiscountMinor: 500,
    });
    expect(totals.oneOff.netMinor).toBe(0);
  });

  it('rounds installments down and gives the remainder to the last (edge case 14)', () => {
    const totals = quoteTotals({
      ...base,
      lines: [{ section: 'one_off', quantity: 1, unitPriceMinor: 10001, listUnitPriceMinor: null }],
      installments: [{ percent: 33 }, { percent: 33 }, { percent: 34 }],
    });
    expect(totals.installmentAmountsMinor).toEqual([3300, 3300, 3401]);
    expect(totals.installmentAmountsMinor.reduce((a, b) => a + b, 0)).toBe(10001);
  });
});

describe('needsDiscountApproval', () => {
  const totals = (unitPriceMinor: number) =>
    quoteTotals({
      ...base,
      lines: [{ section: 'monthly', quantity: 1, unitPriceMinor, listUnitPriceMinor: 10000 }],
    });

  it('is needed from the threshold up, in either section', () => {
    expect(needsDiscountApproval(totals(9000), 10)).toBe(true);
    expect(needsDiscountApproval(totals(9001), 10)).toBe(false);
    expect(needsDiscountApproval(totals(8000), 25)).toBe(false);
  });
});

describe('installmentsValid', () => {
  it('needs 100 % with one-off lines and none without', () => {
    expect(installmentsValid([{ percent: 50 }, { percent: 50 }], true, { draft: false })).toBe(
      true,
    );
    expect(installmentsValid([{ percent: 50 }, { percent: 40 }], true, { draft: true })).toBe(
      false,
    );
    expect(installmentsValid([], true, { draft: true })).toBe(true);
    expect(installmentsValid([], true, { draft: false })).toBe(false);
    expect(installmentsValid([{ percent: 100 }], false, { draft: true })).toBe(false);
    expect(installmentsValid([], false, { draft: false })).toBe(true);
  });
});

describe('quoteDisplayNumber', () => {
  it('pads the number and adds the version from v2', () => {
    expect(quoteDisplayNumber({ year: 2026, number: 7, version: 1 })).toBe('Q-2026-0007');
    expect(quoteDisplayNumber({ year: 2026, number: 12345, version: 3 })).toBe('Q-2026-12345 v3');
  });
});

describe('quoteDraftSchema', () => {
  const draft: QuoteDraftInput = {
    updatedAt: '2026-10-02T10:00:00.000Z',
    contactId: null,
    title: 'Brand and social',
    currency: 'USD',
    validityDays: 14,
    oneOffDiscountMinor: 0,
    monthlyDiscountMinor: 0,
    monthlyTermMonths: 6,
    clientNotes: ' ',
    terms: null,
    lines: [
      {
        section: 'one_off',
        serviceId: service,
        quantity: 1,
        unitPriceMinor: 80000,
        revisionRounds: 3,
      },
      {
        section: 'monthly',
        packageId: pkg,
        quantity: 1,
        unitPriceMinor: 45000,
        items: [{ serviceId: service, quantity: 12, revisionRounds: 2 }],
      },
    ],
    installments: [
      { name: 'Start', percent: 50 },
      { name: 'Delivery', percent: 50 },
    ],
  };

  it('accepts service and package lines', () => {
    const parsed = quoteDraftSchema.parse(draft);
    expect(parsed.clientNotes).toBeNull();
    expect(parsed.lines[1]?.revisionRounds).toBeNull();
  });

  it('refuses a line with both or neither catalog item', () => {
    const both = { ...draft.lines[0], packageId: pkg } as QuoteDraftInput['lines'][number];
    expect(quoteDraftSchema.safeParse({ ...draft, lines: [both] }).success).toBe(false);
    const neither = { ...draft.lines[0], serviceId: null } as QuoteDraftInput['lines'][number];
    expect(quoteDraftSchema.safeParse({ ...draft, lines: [neither] }).success).toBe(false);
  });

  it('keeps package lines at quantity 1 with their items', () => {
    const [, packageLine] = draft.lines as [unknown, QuoteDraftInput['lines'][number]];
    for (const line of [
      { ...packageLine, quantity: 2 },
      { ...packageLine, items: [] },
      { ...packageLine, revisionRounds: 2 },
    ])
      expect(quoteDraftSchema.safeParse({ ...draft, lines: [line] }).success).toBe(false);
  });

  it('bounds validity, term and installments', () => {
    expect(quoteDraftSchema.safeParse({ ...draft, validityDays: 91 }).success).toBe(false);
    expect(quoteDraftSchema.safeParse({ ...draft, monthlyTermMonths: 37 }).success).toBe(false);
    const eleven = Array.from({ length: 11 }, () => ({ name: 'Part', percent: 9 }));
    expect(quoteDraftSchema.safeParse({ ...draft, installments: eleven }).success).toBe(false);
  });
});

describe('quoteApprovalDecisionSchema', () => {
  it('needs a note to return', () => {
    expect(quoteApprovalDecisionSchema.safeParse({ decision: 'return' }).success).toBe(false);
    expect(quoteApprovalDecisionSchema.safeParse({ decision: 'approve' }).success).toBe(true);
  });
});

describe('quoteListQuerySchema', () => {
  it('lists the open latest versions by default', () => {
    expect(quoteListQuerySchema.parse({})).toMatchObject({
      status: ['draft', 'sent', 'expired'],
      latestOnly: true,
      archived: false,
      sort: 'updatedAt',
    });
  });
});

describe('mergeDeliverableLines (A6)', () => {
  it('merges by kind and label, sums quantities and keeps the highest rounds', () => {
    expect(
      mergeDeliverableLines([
        { kind: 'design', label: null, quantity: 12, revisionRounds: 2 },
        { kind: 'reel', label: null, quantity: 4, revisionRounds: 1 },
        { kind: 'design', label: null, quantity: 3, revisionRounds: 3 },
        { kind: 'other', label: 'Blog', quantity: 2, revisionRounds: 0 },
        { kind: 'other', label: 'blog', quantity: 1, revisionRounds: 1 },
        { kind: 'other', label: 'Vlog', quantity: 1, revisionRounds: 2 },
      ]),
    ).toEqual([
      { kind: 'design', label: null, monthlyQuantity: 15, revisionLimit: 3 },
      { kind: 'reel', label: null, monthlyQuantity: 4, revisionLimit: 1 },
      { kind: 'other', label: 'Blog', monthlyQuantity: 3, revisionLimit: 1 },
      { kind: 'other', label: 'Vlog', monthlyQuantity: 1, revisionLimit: 2 },
    ]);
  });
});

describe('defaultInstallmentMilestones (A3)', () => {
  it('maps the first to the first, the last to the last and the others in order', () => {
    expect(defaultInstallmentMilestones(2, 4)).toEqual([0, 3]);
    expect(defaultInstallmentMilestones(3, 4)).toEqual([0, 1, 3]);
    expect(defaultInstallmentMilestones(4, 2)).toEqual([0, 1, 1, 1]);
    expect(defaultInstallmentMilestones(1, 3)).toEqual([2]);
    expect(defaultInstallmentMilestones(2, 0)).toEqual([]);
  });
});

describe('acceptQuoteSchema', () => {
  const project = {
    name: 'Brand identity',
    projectManagerId: service,
    departments: ['design'],
    startDate: '2026-10-02',
    dueDate: '2026-11-01',
    templateIds: [pkg],
    installmentMilestones: [0, 0],
  };

  it('takes a response with a project and a new or renewed retainer', () => {
    const parsed = acceptQuoteSchema.parse({
      respondedOn: '2026-10-02',
      project,
      retainer: { mode: 'renew', retainerId: pkg, templateId: null },
    });
    expect(parsed).toMatchObject({ contactId: null, note: null, proofUploadId: null });
    expect(
      acceptQuoteSchema.safeParse({
        respondedOn: '2026-10-02',
        retainer: {
          mode: 'new',
          name: 'Social',
          departments: ['design', 'design'],
          startDate: '2026-10-02',
          renewalDate: null,
          templateId: null,
        },
      }).data?.retainer,
    ).toMatchObject({ departments: ['design'] });
  });

  it('refuses a template twice and a retainer without its mode fields', () => {
    expect(
      acceptQuoteSchema.safeParse({
        respondedOn: '2026-10-02',
        project: { ...project, templateIds: [pkg, pkg] },
      }).success,
    ).toBe(false);
    expect(
      acceptQuoteSchema.safeParse({
        respondedOn: '2026-10-02',
        retainer: { mode: 'renew', templateId: null },
      }).success,
    ).toBe(false);
  });

  it('reads the plan query: defaults unless the templates are chosen', () => {
    expect(acceptPlanQuerySchema.parse({})).toEqual({ chooseTemplates: false, templateIds: [] });
    expect(acceptPlanQuerySchema.parse({ chooseTemplates: 'true', templateIds: pkg })).toEqual({
      chooseTemplates: true,
      templateIds: [pkg],
    });
  });
});
