import { describe, expect, it } from 'vitest';
import {
  formatContractNumber,
  unknownPlaceholders,
  updateContractArticlesSchema,
  updateContractSettingsSchema,
} from './retainer-contracts.js';

describe('unknownPlaceholders (K7)', () => {
  it('accepts the value and block placeholders', () => {
    const body =
      'بين {agency_name} و{client_name} لـ{retainer_name} خلال {payment_terms_days} يوماً.\n{services}\n{term}\n{fees}';
    expect(unknownPlaceholders(body)).toEqual([]);
  });

  it('names every other placeholder once', () => {
    expect(unknownPlaceholders('{client} و{Services} و{client} و{} و{ fees }')).toEqual([
      'client',
      'Services',
      '',
      ' fees ',
    ]);
  });

  it('ignores braces that hold no name on one line', () => {
    expect(unknownPlaceholders('نص { بلا إغلاق\n} وأقواس عادية (1)')).toEqual([]);
  });
});

describe('formatContractNumber', () => {
  it('pads to three digits and grows past them', () => {
    expect(formatContractNumber('VM-CCS', 2026, 1)).toBe('VM-CCS-2026-001');
    expect(formatContractNumber('VM-CCS', 2026, 42)).toBe('VM-CCS-2026-042');
    expect(formatContractNumber('VM', 2027, 1234)).toBe('VM-2027-1234');
  });
});

describe('updateContractSettingsSchema', () => {
  it('upper-cases the prefix and refuses other characters or lengths', () => {
    expect(updateContractSettingsSchema.parse({ numberPrefix: ' vm-ccs ' }).numberPrefix).toBe(
      'VM-CCS',
    );
    for (const numberPrefix of ['V', 'VM CCS', 'VM_CCS', 'عقد', 'A'.repeat(21)]) {
      expect(updateContractSettingsSchema.safeParse({ numberPrefix }).success, numberPrefix).toBe(
        false,
      );
    }
  });

  it('applies the field limits', () => {
    expect(updateContractSettingsSchema.safeParse({ legalName: 'ش'.repeat(120) }).success).toBe(
      true,
    );
    expect(updateContractSettingsSchema.safeParse({ legalName: 'ش'.repeat(121) }).success).toBe(
      false,
    );
    expect(updateContractSettingsSchema.safeParse({ phone: '1'.repeat(31) }).success).toBe(false);
    expect(updateContractSettingsSchema.safeParse({ slogan: 'ن'.repeat(201) }).success).toBe(false);
  });

  it('keeps empty texts, which print as empty lines', () => {
    expect(updateContractSettingsSchema.parse({ address: '  ' })).toEqual({ address: '' });
  });
});

describe('updateContractArticlesSchema', () => {
  it('needs a title and limits the body', () => {
    expect(
      updateContractArticlesSchema.safeParse({ articles: [{ title: ' ', body: '' }] }).success,
    ).toBe(false);
    expect(
      updateContractArticlesSchema.safeParse({ articles: [{ title: 'م', body: 'ن'.repeat(6001) }] })
        .success,
    ).toBe(false);
    expect(
      updateContractArticlesSchema.parse({ articles: [{ title: ' موضوع العقد ', body: '' }] }),
    ).toEqual({ articles: [{ title: 'موضوع العقد', body: '' }] });
  });

  it('accepts an empty template (no article is required)', () => {
    expect(updateContractArticlesSchema.safeParse({ articles: [] }).success).toBe(true);
  });
});
