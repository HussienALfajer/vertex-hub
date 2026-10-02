import { quoteDraftSchema } from '@vertex-hub/contracts';
import { describe, expect, it } from 'vitest';
import { type BuilderLine, type BuilderValues, draftInput, repriced } from './quote-draft';

const serviceId = '0190a000-0000-7000-8000-000000000001';
const packageId = '0190a000-0000-7000-8000-000000000002';
const itemServiceId = '0190a000-0000-7000-8000-000000000003';

const service: BuilderLine = {
  id: '0190a000-0000-7000-8000-000000000010',
  section: 'one_off',
  serviceId,
  packageId: null,
  name: 'Brand identity',
  description: '',
  quantity: 2,
  unitPriceMinor: 80000,
  listUnitPriceMinor: 80000,
  revisionRounds: 3,
  catalogArchived: false,
  items: [],
};

const pkg: BuilderLine = {
  section: 'monthly',
  serviceId: null,
  packageId,
  name: 'Gold social',
  description: 'Twelve designs',
  quantity: 1,
  unitPriceMinor: 45000,
  listUnitPriceMinor: 45000,
  revisionRounds: null,
  catalogArchived: true,
  items: [{ serviceId: itemServiceId, name: 'Design', quantity: 12, revisionRounds: 2 }],
};

const values: BuilderValues = {
  contactId: null,
  title: 'Brand and social',
  currency: 'USD',
  validityDays: 14,
  oneOffDiscountMinor: 0,
  monthlyDiscountMinor: 5000,
  monthlyTermMonths: 6,
  clientNotes: '',
  terms: 'Pay on time',
  lines: [service, pkg],
  installments: [{ name: 'Start', percent: 100 }],
};

describe('draftInput', () => {
  it('sends the whole draft the API validates, without what is only shown', () => {
    const draft = quoteDraftSchema.parse(draftInput(values, '2026-10-02T10:00:00.000Z'));
    expect(draft.lines[0]).toEqual({
      id: service.id,
      section: 'one_off',
      serviceId,
      packageId: null,
      description: null,
      quantity: 2,
      unitPriceMinor: 80000,
      revisionRounds: 3,
      items: [],
    });
    // A line not saved yet has no id; package items keep their quantities and rounds.
    expect(draft.lines[1]).not.toHaveProperty('id');
    expect(draft.lines[1]?.items).toEqual([
      { serviceId: itemServiceId, quantity: 12, revisionRounds: 2 },
    ]);
    expect(draft.clientNotes).toBeNull();
  });
});

describe('repriced', () => {
  it('prices every line from the catalog in the new currency, 0 without a price there', () => {
    const lines = repriced([service, pkg], 'SYP', {
      service: () => ({ priceUsdMinor: 80000, priceSypMinor: 1200000000 }),
      package: () => ({ priceUsdMinor: 45000, priceSypMinor: null }),
    });
    expect(lines.map((line) => [line.unitPriceMinor, line.listUnitPriceMinor])).toEqual([
      [1200000000, 1200000000],
      [0, null],
    ]);
  });

  it('leaves an item the catalog no longer offers unpriced', () => {
    const [line] = repriced([service], 'SYP', {
      service: () => undefined,
      package: () => undefined,
    });
    expect(line).toMatchObject({ unitPriceMinor: 0, listUnitPriceMinor: null });
  });
});
