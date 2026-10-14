import { describe, expect, it } from 'vitest';
import {
  annexAmendmentLines,
  contractArticleHeading,
  contractFeesCaption,
  contractTermLines,
} from './retainer-contracts.js';

describe('contract texts (K11)', () => {
  it('numbers article headings', () => {
    expect(contractArticleHeading({ number: 3, title: 'مدة العقد' })).toBe('المادة 3 — مدة العقد');
  });

  it('prints a term with its cycles, end date and end action', () => {
    const lines = contractTermLines({
      kind: 'term',
      retainerName: 'إدارة الحسابات',
      startDate: '2026-10-20',
      cycleDay: 20,
      cycles: 3,
      endDate: '2027-01-19',
      endAction: 'renew',
    });
    expect(lines).toHaveLength(5);
    expect(lines[1]).toBe('عدد الدورات: 3');
    expect(lines[3]).toBe('تبدأ كل دورة في اليوم 20 من الشهر.');
    expect(lines[4]).toContain('يتجدد');
  });

  it('notes the month-end clamp and prints an open-ended retainer', () => {
    const lines = contractTermLines({
      kind: 'open_ended',
      retainerName: 'إدارة الحسابات',
      startDate: '2026-01-31',
      cycleDay: 31,
      cycles: null,
      endDate: null,
      endAction: null,
    });
    expect(lines[1]).toContain('آخر يوم');
    expect(lines[2]).toContain('دون مدة محددة');
  });

  it('captions the fees by total or per cycle', () => {
    const base = { currency: 'USD' as const, schedule: [] };
    expect(contractFeesCaption({ ...base, agreedTotalMinor: 120000, feeMinor: null })).toContain(
      '1,200.00',
    );
    expect(contractFeesCaption({ ...base, agreedTotalMinor: null, feeMinor: 50000 })).toContain(
      'أتعاب كل دورة',
    );
  });

  it('describes an amendment by scope, lines, amount and reason (K10)', () => {
    const amendment = {
      number: 2,
      kind: 'change' as const,
      scope: 'onward' as const,
      effectiveCycle: 5,
      periodStart: '2027-02-20',
      periodEnd: '2027-03-19',
      lines: [{ kind: 'reel' as const, label: null, quantityDelta: 2, revisionLimit: null }],
      currency: 'USD' as const,
      amountDeltaMinor: -5000,
      schedule: null,
      reason: 'تخفيض',
    };
    const lines = annexAmendmentLines(amendment);
    expect(lines[0]).toMatch(/^ابتداءً من الدورة 5/);
    expect(lines[1]).toBe('+2 ريلز');
    expect(lines[2]).toContain('50.00');
    expect(lines.at(-1)).toBe('السبب: تخفيض');
    expect(annexAmendmentLines({ ...amendment, kind: 'reschedule', scope: null })[0]).toMatch(
      /^إعادة جدولة/,
    );
  });
});
