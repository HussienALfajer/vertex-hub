import type { Currency, QuoteSnapshot } from '@vertex-hub/contracts';
import { fill, plural } from '@vertex-hub/messages';
import {
  documentHtml,
  escapeHtml,
  formatMoney,
  metaItem,
  type TemplateAssets,
  textBlock,
} from './document.js';

/*
 * The quote PDF (spec F04 rules 12–14), in the shell of `document.ts`. It prints the frozen
 * snapshot only: no list prices, no effective discounts.
 */

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
  perMonth: 'شهريًا',
  term: (months: number) =>
    `مدة الاشتراك: ${fill(
      plural(
        {
          zero: '{{n}} شهر',
          one: 'شهر واحد',
          two: 'شهران',
          few: '{{n}} أشهر',
          many: '{{n}} شهرًا',
          other: '{{n}} شهر',
        },
        months,
      ),
      { n: months },
    )}`,
  termTotal: 'إجمالي المدة',
  installments: 'الدفعات',
  installment: 'الدفعة',
  percent: 'النسبة',
  amount: 'المبلغ',
  notes: 'ملاحظات',
  terms: 'الشروط والأحكام',
} as const;

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

/** The whole document; `draft` adds the watermark of a preview (rule 13). */
export function quoteHtml(
  snapshot: QuoteSnapshot,
  options: { draft: boolean },
  assets: TemplateAssets,
): string {
  const addressee = snapshot.addressee ? metaItem(LABELS.addressee, snapshot.addressee) : '';
  const body = `<div class="title"><h1>${LABELS.quote} <span class="version num">${escapeHtml(snapshot.displayNumber)}</span></h1></div>
<p class="subject">${escapeHtml(snapshot.title)}</p>
<dl class="meta">
  ${metaItem(LABELS.number, snapshot.displayNumber, { num: true })}
  ${metaItem(LABELS.date, snapshot.sentOn, { num: true })}
  ${metaItem(LABELS.validUntil, snapshot.validUntil, { num: true })}
  ${metaItem(LABELS.client, snapshot.client)}
  ${addressee}
</dl>
${oneOffSection(snapshot)}
${monthlySection(snapshot)}
${textBlock(LABELS.notes, snapshot.clientNotes)}
${textBlock(LABELS.terms, snapshot.terms)}`;
  return documentHtml({
    title: snapshot.displayNumber,
    companyDetails: snapshot.companyDetails,
    body,
    assets,
    watermark: options.draft ? LABELS.draft : undefined,
    styles: QUOTE_STYLES,
  });
}

const QUOTE_STYLES = `
.subject { margin: 0 0 14px; font-size: 12pt; font-weight: 500; }
ul.items { margin: 2px 0 0; padding-inline-start: 16px; font-size: 8.5pt; color: #4B5150; }
table.installments { width: 70%; }
`;
