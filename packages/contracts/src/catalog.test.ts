import { describe, expect, it } from 'vitest';
import {
  type CreateCatalogPackageInput,
  type CreateCatalogServiceInput,
  catalogServiceListQuerySchema,
  createCatalogPackageSchema,
  createCatalogServiceSchema,
  serviceIssues,
  updateCatalogPackageSchema,
  updateCatalogServiceSchema,
} from './catalog.js';

const design: CreateCatalogServiceInput = {
  name: ' Social media design ',
  department: 'design',
  billing: 'monthly',
  priceUsdMinor: 1500,
  deliverableKind: 'design',
};

const serviceA = '0190a3c2-0000-7000-8000-000000000001';
const serviceB = '0190a3c2-0000-7000-8000-000000000002';

const gold: CreateCatalogPackageInput = {
  name: 'Gold social',
  billing: 'monthly',
  priceUsdMinor: 45000,
  items: [
    { serviceId: serviceA, quantity: 12 },
    { serviceId: serviceB, quantity: 4 },
  ],
};

describe('catalog services', () => {
  it('trims the name and fills the defaults', () => {
    expect(createCatalogServiceSchema.parse(design)).toEqual({
      name: 'Social media design',
      description: null,
      department: 'design',
      billing: 'monthly',
      priceUsdMinor: 1500,
      priceSypMinor: null,
      revisionRounds: 2,
      deliverableKind: 'design',
      deliverableLabel: null,
      templateId: null,
    });
  });

  it('limits the name, description, prices and revision rounds', () => {
    const bad = (patch: Partial<CreateCatalogServiceInput>) =>
      createCatalogServiceSchema.safeParse({ ...design, ...patch }).success;
    expect(bad({ name: '  ' })).toBe(false);
    expect(bad({ name: 'x'.repeat(121) })).toBe(false);
    expect(bad({ description: 'x'.repeat(1001) })).toBe(false);
    expect(bad({ priceUsdMinor: -1 })).toBe(false);
    expect(bad({ priceUsdMinor: 1.5 })).toBe(false);
    expect(bad({ priceSypMinor: -1 })).toBe(false);
    expect(bad({ revisionRounds: 21 })).toBe(false);
    expect(bad({ revisionRounds: 0 })).toBe(true);
  });

  it('counts only monthly services (C4)', () => {
    expect(createCatalogServiceSchema.safeParse({ ...design, billing: 'one_off' }).success).toBe(
      false,
    );
    expect(
      createCatalogServiceSchema.safeParse({ ...design, billing: 'one_off', deliverableKind: null })
        .success,
    ).toBe(true);
  });

  it('needs a label for a counted kind "other" and a kind for a label (C4)', () => {
    const parse = (patch: Partial<CreateCatalogServiceInput>) =>
      createCatalogServiceSchema.safeParse({ ...design, ...patch }).success;
    expect(parse({ deliverableKind: 'other' })).toBe(false);
    expect(parse({ deliverableKind: 'other', deliverableLabel: 'Newsletter' })).toBe(true);
    expect(parse({ deliverableKind: null, deliverableLabel: 'Newsletter' })).toBe(false);
    expect(parse({ deliverableLabel: 'x'.repeat(61) })).toBe(false);
  });

  it('checks a merged service the same way', () => {
    expect(
      serviceIssues({ billing: 'one_off', deliverableKind: 'reel', deliverableLabel: null }),
    ).toHaveLength(1);
    expect(
      serviceIssues({ billing: 'monthly', deliverableKind: 'reel', deliverableLabel: null }),
    ).toEqual([]);
  });

  it('changes only the named fields on update', () => {
    expect(updateCatalogServiceSchema.parse({ priceUsdMinor: 2000 })).toEqual({
      priceUsdMinor: 2000,
    });
    expect(updateCatalogServiceSchema.parse({ description: '  ' })).toEqual({ description: null });
  });

  it('lists active services by default', () => {
    expect(catalogServiceListQuerySchema.parse({})).toMatchObject({ archived: false, page: 1 });
    expect(catalogServiceListQuerySchema.parse({ archived: 'true' }).archived).toBe(true);
  });
});

describe('catalog packages', () => {
  it('accepts a monthly package with a template', () => {
    expect(createCatalogPackageSchema.parse({ ...gold, templateId: serviceA }).templateId).toBe(
      serviceA,
    );
  });

  it('links a template to monthly packages only', () => {
    expect(
      createCatalogPackageSchema.safeParse({ ...gold, billing: 'one_off', templateId: serviceA })
        .success,
    ).toBe(false);
  });

  it('holds 1 to 20 distinct services with quantities 1 to 999', () => {
    const items = (list: CreateCatalogPackageInput['items']) =>
      createCatalogPackageSchema.safeParse({ ...gold, items: list }).success;
    expect(items([])).toBe(false);
    expect(items([{ serviceId: serviceA, quantity: 0 }])).toBe(false);
    expect(items([{ serviceId: serviceA, quantity: 1000 }])).toBe(false);
    expect(
      items([
        { serviceId: serviceA, quantity: 1 },
        { serviceId: serviceA, quantity: 2 },
      ]),
    ).toBe(false);
    const many = Array.from({ length: 21 }, (_, i) => ({
      serviceId: `0190a3c2-0000-7000-8000-${String(i).padStart(12, '0')}`,
      quantity: 1,
    }));
    expect(items(many)).toBe(false);
    expect(items(many.slice(0, 20))).toBe(true);
  });

  it('changes only the named fields on update', () => {
    expect(updateCatalogPackageSchema.parse({ name: 'Silver' })).toEqual({ name: 'Silver' });
  });
});
