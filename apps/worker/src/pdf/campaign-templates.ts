import type { AdDepositReceiptSnapshot } from '@vertex-hub/contracts';
import {
  documentHtml,
  escapeHtml,
  formatMoney,
  metaItem,
  type TemplateAssets,
} from './document.js';
import { METHODS } from './invoice-templates.js';

/*
 * The ad budget deposit receipt (spec F12 rule 19), in the shell of `document.ts`. It prints its
 * frozen payload only.
 */

const LABELS = {
  receipt: 'إيصال إيداع ميزانية إعلانية',
  receiptNumber: 'رقم الإيصال',
  receivedOn: 'تاريخ الإيداع',
  receivedFrom: 'استلمنا من',
  method: 'طريقة الدفع',
  reference: 'المرجع',
  amount: 'المبلغ',
  rate: 'سعر الصرف (ليرة سورية لكل دولار)',
  usdAmount: 'المبلغ بالدولار',
  balanceAfter: 'رصيد الميزانية الإعلانية بعد الإيداع',
  purpose:
    'إيداع ميزانية إعلانية: مبلغ محفوظ لحساب العميل لصرفه على إعلاناته، وليس أتعابًا للوكالة.',
} as const;

export function adDepositReceiptHtml(
  snapshot: AdDepositReceiptSnapshot,
  assets: TemplateAssets,
): string {
  const reference = snapshot.reference ? metaItem(LABELS.reference, snapshot.reference) : '';
  const conversion = snapshot.conversion
    ? `<tr><th>${LABELS.rate}</th><td class="num">${escapeHtml(snapshot.conversion.sypPerUsd)}</td></tr>
    <tr><th>${LABELS.usdAmount}</th><td class="num">${formatMoney(snapshot.conversion.usdMinor, 'USD')}</td></tr>`
    : '';
  const body = `<div class="title"><h1>${LABELS.receipt} <span class="version num">${escapeHtml(snapshot.displayNumber)}</span></h1></div>
<dl class="meta">
  ${metaItem(LABELS.receiptNumber, snapshot.displayNumber, { num: true })}
  ${metaItem(LABELS.receivedOn, snapshot.receivedOn, { num: true })}
  ${metaItem(LABELS.receivedFrom, snapshot.billingName)}
  ${metaItem(LABELS.method, METHODS[snapshot.method])}
  ${reference}
</dl>
<section>
  <table class="sums receipt">
    <tr class="net"><th>${LABELS.amount}</th><td class="num">${formatMoney(snapshot.amountMinor, snapshot.currency)}</td></tr>
    ${conversion}
    <tr><th>${LABELS.balanceAfter}</th><td class="num">${formatMoney(snapshot.balanceAfterMinor, 'USD')}</td></tr>
  </table>
</section>
<footer class="note">${LABELS.purpose}</footer>`;
  return documentHtml({
    title: snapshot.displayNumber,
    companyDetails: snapshot.companyDetails,
    body,
    assets,
    styles: 'table.sums.receipt { width: 70%; margin-inline-start: 0; }',
  });
}
