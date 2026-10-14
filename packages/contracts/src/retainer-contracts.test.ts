import { describe, expect, it } from 'vitest';
import {
  absentContractBlocks,
  contractBodyParts,
  createContractSchema,
  fillContractValues,
  formatContractNumber,
  issueAnnexSchema,
  signedContractSchema,
  updateContractSchema,
  voidContractSchema,
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

describe('fillContractValues (K7)', () => {
  const values = {
    agency_name: 'فيرتكس ميديا',
    client_name: 'مطعم الياسمين',
    retainer_name: 'إدارة الحسابات',
    payment_terms_days: '7',
  };

  it('fills value placeholders and keeps the blocks', () => {
    expect(
      fillContractValues('تلتزم {agency_name} تجاه {client_name} خلال {payment_terms_days} أيام.\n{fees}', values),
    ).toBe('تلتزم فيرتكس ميديا تجاه مطعم الياسمين خلال 7 أيام.\n{fees}');
  });

  it('fills every occurrence', () => {
    expect(fillContractValues('{client_name} و{client_name}', values)).toBe(
      'مطعم الياسمين ومطعم الياسمين',
    );
  });
});

describe('contractBodyParts (K7)', () => {
  it('splits paragraphs by line and skips empty lines', () => {
    expect(contractBodyParts('أولاً\n\n  ثانياً  ')).toEqual([{ text: 'أولاً' }, { text: 'ثانياً' }]);
  });

  it('puts each block on its own, wherever it stands', () => {
    expect(contractBodyParts('الخدمات:\n{services}\nقبل {fees} بعد\n{term}{term}')).toEqual([
      { text: 'الخدمات:' },
      { block: 'services' },
      { text: 'قبل' },
      { block: 'fees' },
      { text: 'بعد' },
      { block: 'term' },
      { block: 'term' },
    ]);
  });
});

describe('absentContractBlocks (K7)', () => {
  it('names the blocks no article prints', () => {
    expect(absentContractBlocks(['{services}', 'نص {fees}'])).toEqual(['term']);
    expect(absentContractBlocks([])).toEqual(['services', 'term', 'fees']);
    expect(absentContractBlocks(['{services}{term}', '{fees}'])).toEqual([]);
  });
});

describe('contract inputs', () => {
  const id = '0190a000-0000-7000-8000-000000000001';

  it('needs a term for a term contract and none for an open-ended one (K1)', () => {
    expect(createContractSchema.safeParse({ kind: 'term', termId: id }).success).toBe(true);
    expect(createContractSchema.safeParse({ kind: 'term' }).success).toBe(false);
    expect(createContractSchema.parse({ kind: 'open_ended', termId: id })).toEqual({
      kind: 'open_ended',
    });
  });

  it('edits a draft partially, articles within their limits (K2)', () => {
    expect(updateContractSchema.parse({ contractDate: '2026-10-14' })).toEqual({
      contractDate: '2026-10-14',
    });
    expect(updateContractSchema.safeParse({ signatoryContactId: null }).success).toBe(true);
    expect(
      updateContractSchema.safeParse({ articles: [{ title: ' ', body: 'نص' }] }).success,
    ).toBe(false);
    expect(
      updateContractSchema.safeParse({ articles: [{ title: 'م', body: 'x'.repeat(6001) }] })
        .success,
    ).toBe(false);
  });

  it('voids with a reason of at most 500 characters (K8)', () => {
    expect(voidContractSchema.safeParse({ reason: '  ' }).success).toBe(false);
    expect(voidContractSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
    expect(voidContractSchema.parse({ reason: ' خطأ ' })).toEqual({ reason: 'خطأ' });
  });

  it('takes the signed copy with its date (K5) and an annex date (K10)', () => {
    expect(signedContractSchema.safeParse({ signedOn: '2026-10-14', uploadId: id }).success).toBe(
      true,
    );
    expect(signedContractSchema.safeParse({ signedOn: '14/10/2026', uploadId: id }).success).toBe(
      false,
    );
    expect(issueAnnexSchema.safeParse({}).success).toBe(false);
  });
});
