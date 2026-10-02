import type { Currency, QuoteSnapshot } from '@vertex-hub/contracts';

/*
 * The quote PDF (spec F04 rules 12–14): an Arabic RTL A4 document in the brand
 * (brand/identity.md: green full logo on white, Vertex Green structure, sand accents, 1 px
 * borders). It prints the frozen snapshot only: no list prices, no effective discounts.
 * The PDF is Arabic only (owner decision), so its labels live here rather than in i18next.
 */

/** Both V1 currencies use 2 decimal places (ADR 0006); the web app formats them the same way. */
const MINOR_PER_UNIT = 100;
const LOCALE = 'ar-SY-u-nu-latn';

const LABELS = {
  quote: 'عرض سعر',
  draft: 'مسودة',
  number: 'رقم العرض',
  date: 'التاريخ',
  validUntil: 'صالح حتى',
  client: 'العميل',
  addressee: 'إلى عناية',
  oneOff: 'خدمات لمرة واحدة',
  monthly: 'خدمات شهرية',
  service: 'الخدمة',
  quantity: 'الكمية',
  unitPrice: 'سعر الوحدة',
  total: 'الإجمالي',
  subtotal: 'المجموع',
  discount: 'الخصم',
  net: 'الصافي',
  monthlyNet: 'الصافي الشهري',
  perMonth: 'شهرياً',
  term: (months: number) => `مدة الاشتراك: ${months} شهراً`,
  termTotal: 'إجمالي المدة',
  installments: 'الدفعات',
  installment: 'الدفعة',
  percent: 'النسبة',
  amount: 'المبلغ',
  notes: 'ملاحظات',
  terms: 'الشروط والأحكام',
} as const;

export interface QuoteTemplateAssets {
  /** The green full logo, an SVG data URL. */
  logo: string;
  /** `@font-face` rules with embedded fonts. */
  fontFaces: string;
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

export function formatMoney(minor: number, currency: Currency): string {
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / MINOR_PER_UNIT);
}

type Section = QuoteSnapshot['oneOff'];

function linesTable(section: Section, currency: Currency): string {
  const rows = section.lines
    .map((line) => {
      const items = line.items.length
        ? `<ul class="items">${line.items
            .map(
              (item) =>
                `<li><span class="num">${item.quantity}</span> × ${escapeHtml(item.name)}</li>`,
            )
            .join('')}</ul>`
        : '';
      const description = line.description
        ? `<div class="description">${escapeHtml(line.description)}</div>`
        : '';
      return `<tr>
        <td><div class="line-name">${escapeHtml(line.name)}</div>${description}${items}</td>
        <td class="num">${line.quantity}</td>
        <td class="num">${formatMoney(line.unitPriceMinor, currency)}</td>
        <td class="num">${formatMoney(line.totalMinor, currency)}</td>
      </tr>`;
    })
    .join('');
  return `<table class="lines">
    <thead><tr>
      <th>${LABELS.service}</th><th class="narrow">${LABELS.quantity}</th>
      <th class="money">${LABELS.unitPrice}</th><th class="money">${LABELS.total}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function sums(section: Section, currency: Currency, netLabel: string, suffix = ''): string {
  const discount =
    section.discountMinor > 0
      ? `<tr><th>${LABELS.discount}</th><td class="num">− ${formatMoney(section.discountMinor, currency)}</td></tr>`
      : '';
  return `<table class="sums">
    <tr><th>${LABELS.subtotal}</th><td class="num">${formatMoney(section.subtotalMinor, currency)}</td></tr>
    ${discount}
    <tr class="net"><th>${netLabel}</th><td class="amount"><span class="num">${formatMoney(section.netMinor, currency)}</span>${suffix}</td></tr>
  </table>`;
}

function oneOffSection(snapshot: QuoteSnapshot): string {
  const { oneOff, currency } = snapshot;
  if (oneOff.lines.length === 0) return '';
  const installments = snapshot.installments.length
    ? `<h3>${LABELS.installments}</h3>
      <table class="lines installments">
        <thead><tr>
          <th>${LABELS.installment}</th><th class="narrow">${LABELS.percent}</th>
          <th class="money">${LABELS.amount}</th>
        </tr></thead>
        <tbody>${snapshot.installments
          .map(
            (installment) => `<tr>
              <td>${escapeHtml(installment.name)}</td>
              <td class="num">${installment.percent}%</td>
              <td class="num">${formatMoney(installment.amountMinor, currency)}</td>
            </tr>`,
          )
          .join('')}</tbody>
      </table>`
    : '';
  return `<section>
    <h2>${LABELS.oneOff}</h2>
    ${linesTable(oneOff, currency)}
    ${sums(oneOff, currency, LABELS.net)}
    ${installments}
  </section>`;
}

function monthlySection(snapshot: QuoteSnapshot): string {
  const { monthly, currency } = snapshot;
  if (monthly.lines.length === 0) return '';
  const term =
    monthly.termMonths !== null && monthly.termTotalMinor !== null
      ? `<table class="sums term">
          <tr><th>${LABELS.term(monthly.termMonths)}</th><td></td></tr>
          <tr class="net"><th>${LABELS.termTotal}</th><td class="num">${formatMoney(monthly.termTotalMinor, currency)}</td></tr>
        </table>`
      : '';
  return `<section>
    <h2>${LABELS.monthly}</h2>
    ${linesTable(monthly, currency)}
    ${sums(monthly, currency, LABELS.monthlyNet, ` / ${LABELS.perMonth}`)}
    ${term}
  </section>`;
}

function textBlock(title: string, text: string | null): string {
  if (!text?.trim()) return '';
  return `<section class="text"><h3>${title}</h3><p>${escapeHtml(text)}</p></section>`;
}

/** The whole document; `draft` adds the watermark of a preview (rule 13). */
export function quoteHtml(
  snapshot: QuoteSnapshot,
  options: { draft: boolean },
  assets: QuoteTemplateAssets,
): string {
  const addressee = snapshot.addressee
    ? `<div><dt>${LABELS.addressee}</dt><dd>${escapeHtml(snapshot.addressee)}</dd></div>`
    : '';
  const company = snapshot.companyDetails.trim()
    ? `<p class="company">${escapeHtml(snapshot.companyDetails)}</p>`
    : '';
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>${escapeHtml(snapshot.displayNumber)}</title>
<style>
${assets.fontFaces}
@page { size: A4; margin: 18mm 16mm 20mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: 'Montserrat', 'Noto Kufi Arabic', sans-serif;
  font-size: 10pt; line-height: 1.7; color: #222827; background: #FFFFFF;
}
/* Numbers read left to right, aligned with their (right-aligned) Arabic headers. */
.num { font-variant-numeric: tabular-nums; direction: ltr; unicode-bidi: isolate; text-align: end; white-space: nowrap; }
header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px;
  padding-bottom: 12px; border-bottom: 2px solid #004139; }
header img { width: auto; height: 72px; }
.company { margin: 0; font-size: 8.5pt; color: #616866; white-space: pre-line; text-align: end; }
.title { display: flex; align-items: center; gap: 10px; margin: 20px 0 4px; }
.title::before { content: ''; width: 5px; height: 26px; background: #B9A87A; transform: skewX(-30deg); }
h1 { margin: 0; font-size: 18pt; font-weight: 700; color: #004139; }
h1 .version { font-size: 11pt; font-weight: 500; color: #616866; }
.subject { margin: 0 0 14px; font-size: 12pt; font-weight: 500; }
dl.meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 24px; margin: 0 0 18px;
  padding: 10px 14px; border: 1px solid #D4DBD9; border-radius: 8px; }
dl.meta dt { font-size: 8pt; color: #616866; }
dl.meta dd { margin: 0; font-weight: 500; }
section { margin-bottom: 18px; break-inside: auto; }
h2 { margin: 0 0 8px; font-size: 12pt; font-weight: 700; color: #004139; }
h3 { margin: 12px 0 6px; font-size: 10pt; font-weight: 700; color: #004139; }
table { width: 100%; border-collapse: collapse; }
table.lines th { background: #F4F8F7; color: #353B39; font-size: 8.5pt; font-weight: 500;
  text-align: start; padding: 6px 8px; border-bottom: 1px solid #D4DBD9; }
table.lines td { padding: 7px 8px; border-bottom: 1px solid #E7EFED; vertical-align: top; }
table.lines tr { break-inside: avoid; }
th.narrow { width: 12%; }
th.money { width: 20%; }
.line-name { font-weight: 500; }
.description { font-size: 8.5pt; color: #616866; white-space: pre-line; }
ul.items { margin: 2px 0 0; padding-inline-start: 16px; font-size: 8.5pt; color: #4B5150; }
table.sums { width: 45%; margin-inline-start: auto; margin-top: 6px; break-inside: avoid; }
table.sums th { text-align: start; font-weight: 400; color: #616866; padding: 3px 8px; }
table.sums td { padding: 3px 8px; }
table.sums td.amount { text-align: start; white-space: nowrap; }
table.sums tr.net th, table.sums tr.net td { font-weight: 700; color: #004139;
  border-top: 1px solid #D4DBD9; padding-top: 6px; }
table.installments { width: 70%; }
.text p { margin: 0; white-space: pre-line; font-size: 9pt; }
.watermark { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
  pointer-events: none; z-index: 10; }
.watermark span { font-size: 120pt; font-weight: 700; color: rgba(185, 168, 122, 0.22);
  transform: rotate(-30deg); }
</style>
</head>
<body>
${options.draft ? `<div class="watermark"><span>${LABELS.draft}</span></div>` : ''}
<header>
  <img src="${assets.logo}" alt="Vertex Media">
  ${company}
</header>
<div class="title"><h1>${LABELS.quote} <span class="version num">${escapeHtml(snapshot.displayNumber)}</span></h1></div>
<p class="subject">${escapeHtml(snapshot.title)}</p>
<dl class="meta">
  <div><dt>${LABELS.number}</dt><dd class="num">${escapeHtml(snapshot.displayNumber)}</dd></div>
  <div><dt>${LABELS.date}</dt><dd class="num">${snapshot.sentOn}</dd></div>
  <div><dt>${LABELS.validUntil}</dt><dd class="num">${snapshot.validUntil}</dd></div>
  <div><dt>${LABELS.client}</dt><dd>${escapeHtml(snapshot.client)}</dd></div>
  ${addressee}
</dl>
${oneOffSection(snapshot)}
${monthlySection(snapshot)}
${textBlock(LABELS.notes, snapshot.clientNotes)}
${textBlock(LABELS.terms, snapshot.terms)}
</body>
</html>`;
}
