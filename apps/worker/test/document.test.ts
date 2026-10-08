import type { QuoteSnapshot } from '@vertex-hub/contracts';
import { describe, expect, it } from 'vitest';
import { metaItem, textLines } from '../src/pdf/document.js';
import { quoteHtml } from '../src/pdf/quote-template.js';

describe('PDF text helpers', () => {
  it('prints a line without Arabic letters (a phone) left to right', () => {
    expect(textLines('فيرتكس ميديا\n+963 11 222 3333')).toBe(
      '<bdi dir="rtl">فيرتكس ميديا</bdi><br><bdi dir="ltr">+963 11 222 3333</bdi>',
    );
  });

  it('isolates a number inside an Arabic line, its groups in order', () => {
    expect(textLines('هاتف: 0944-123 456 فقط')).toBe(
      '<bdi dir="rtl">هاتف: <bdi dir="ltr">0944-123 456</bdi> فقط</bdi>',
    );
    // A lone digit is no group; text is escaped.
    expect(textLines('بند 5 <b>')).toBe('<bdi dir="rtl">بند 5 &lt;b&gt;</bdi>');
  });

  it('prints a billing address with a phone line by line', () => {
    expect(metaItem('العنوان', 'دمشق، المزة\n+963 944 000 111')).toBe(
      '<div><dt>العنوان</dt><dd><bdi dir="rtl">دمشق، المزة</bdi><br><bdi dir="ltr">+963 944 000 111</bdi></dd></div>',
    );
  });

  it('prints a reference of digits left to right, and a `num` value as is', () => {
    expect(metaItem('المرجع', '00123 456')).toBe(
      '<div><dt>المرجع</dt><dd><bdi dir="ltr">00123 456</bdi></dd></div>',
    );
    expect(metaItem('التاريخ', '2026-10-08', { num: true })).toBe(
      '<div><dt>التاريخ</dt><dd class="num">2026-10-08</dd></div>',
    );
  });
});

describe('quote term', () => {
  const section = { lines: [], subtotalMinor: 0, discountMinor: 0, netMinor: 0 };
  const snapshot = (termMonths: number): QuoteSnapshot => ({
    displayNumber: 'Q-2026-0001',
    title: 'عرض',
    companyDetails: 'فيرتكس ميديا',
    client: 'عميل',
    addressee: null,
    currency: 'USD',
    sentOn: '2026-10-02',
    validUntil: '2026-10-16',
    oneOff: section,
    monthly: {
      ...section,
      lines: [
        {
          name: 'باقة',
          description: null,
          quantity: 1,
          unitPriceMinor: 1000,
          totalMinor: 1000,
          items: [],
        },
      ],
      subtotalMinor: 1000,
      netMinor: 1000,
      termMonths,
      termTotalMinor: 1000 * termMonths,
    },
    installments: [],
    clientNotes: null,
    terms: null,
  });
  const html = (months: number) =>
    quoteHtml(snapshot(months), { draft: false }, { logo: '', fontFaces: '' });

  it('names the months with the Arabic plural', () => {
    expect(html(1)).toContain('مدة الاشتراك: شهر واحد');
    expect(html(2)).toContain('مدة الاشتراك: شهران');
    expect(html(6)).toContain('مدة الاشتراك: 6 أشهر');
    expect(html(12)).toContain('مدة الاشتراك: 12 شهرًا');
  });
});
