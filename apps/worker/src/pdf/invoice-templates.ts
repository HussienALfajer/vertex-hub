import type {
  InvoiceDraftSnapshot,
  InvoiceSnapshot,
  PaymentMethod,
  ReceiptSnapshot,
  StatementSnapshot,
} from '@vertex-hub/contracts';
import {
  documentHtml,
  escapeHtml,
  formatMoney,
  metaItem,
  type TemplateAssets,
  textBlock,
  textLines,
} from './document.js';

/*
 * The invoice, receipt and statement PDFs (spec F13 rules 15, 20 and 29), in the shell of
 * `document.ts`. Each prints its frozen payload only.
 */

const LABELS = {
  invoice: 'فاتورة',
  draft: 'مسودة',
  number: 'رقم الفاتورة',
  issuedOn: 'تاريخ الإصدار',
  dueOn: 'تاريخ الاستحقاق',
  billTo: 'فاتورة إلى',
  description: 'البيان',
  quantity: 'الكمية',
  unitPrice: 'سعر الوحدة',
  total: 'الإجمالي',
  amountDue: 'المبلغ المستحق',
  notes: 'ملاحظات',
  paymentDetails: 'طريقة الدفع',
  receipt: 'إيصال قبض',
  receiptNumber: 'رقم الإيصال',
  paidOn: 'تاريخ الدفع',
  receivedFrom: 'استلمنا من',
  amount: 'المبلغ',
  method: 'طريقة الدفع',
  reference: 'المرجع',
  forInvoice: 'عن الفاتورة',
  applied: 'المبلغ المحتسب من الفاتورة',
  balanceAfter: 'الرصيد المتبقي على الفاتورة',
  statement: 'كشف حساب',
  client: 'العميل',
  currency: 'العملة',
  period: 'الفترة',
  date: 'التاريخ',
  document: 'المستند',
  debit: 'مدين',
  credit: 'دائن',
  balance: 'الرصيد',
  opening: 'الرصيد الافتتاحي',
  closing: 'الرصيد الختامي',
  invoiceRow: 'فاتورة',
  paymentRow: (invoice: string) => `دفعة عن ${invoice}`,
  invoiced: 'إجمالي الفواتير',
  paid: 'إجمالي المدفوع',
  outstanding: 'الرصيد المستحق',
  noRows: 'لا توجد حركات في هذه الفترة.',
} as const;

/** Also printed on the ad deposit receipts (F12). */
export const METHODS: Record<PaymentMethod, string> = {
  cash: 'نقدًا',
  bank_transfer: 'تحويل مصرفي',
  e_wallet: 'محفظة إلكترونية',
};

/** The client block of every document: billing name, then the billing address. */
function billTo(label: string, name: string, address: string | null): string {
  return metaItem(label, address?.trim() ? `${name}\n${address}` : name);
}

function footer(text: string): string {
  return text.trim() ? `<footer class="note">${textLines(text)}</footer>` : '';
}

/** An issued invoice, or a draft preview (no number, a "draft" watermark). */
export function invoiceHtml(
  snapshot: InvoiceSnapshot | InvoiceDraftSnapshot,
  assets: TemplateAssets,
): string {
  const { currency } = snapshot;
  const number = snapshot.displayNumber;
  const rows = snapshot.lines
    .map(
      (line) => `<tr>
        <td><div class="description">${escapeHtml(line.description)}</div></td>
        <td class="num">${line.quantity}</td>
        <td class="num">${formatMoney(line.unitPriceMinor, currency)}</td>
        <td class="num">${formatMoney(line.totalMinor, currency)}</td>
      </tr>`,
    )
    .join('');
  const body = `<div class="title"><h1>${LABELS.invoice}${number ? ` <span class="version num">${escapeHtml(number)}</span>` : ''}</h1></div>
<dl class="meta">
  ${number ? metaItem(LABELS.number, number, { num: true }) : ''}
  ${metaItem(LABELS.issuedOn, snapshot.issuedOn, { num: true })}
  ${metaItem(LABELS.dueOn, snapshot.dueOn, { num: true })}
  ${billTo(LABELS.billTo, snapshot.billingName, snapshot.billingAddress)}
</dl>
<section>
  <table class="lines">
    <thead><tr>
      <th>${LABELS.description}</th><th class="narrow">${LABELS.quantity}</th>
      <th class="money">${LABELS.unitPrice}</th><th class="money">${LABELS.total}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <table class="sums">
    <tr class="net"><th>${LABELS.amountDue}</th><td class="num">${formatMoney(snapshot.totalMinor, currency)}</td></tr>
  </table>
</section>
${textBlock(LABELS.notes, snapshot.notes)}
${textBlock(LABELS.paymentDetails, snapshot.paymentDetails)}
${footer(snapshot.footer)}`;
  return documentHtml({
    title: number ?? LABELS.invoice,
    companyDetails: snapshot.companyDetails,
    body,
    assets,
    watermark: number ? undefined : LABELS.draft,
    styles: '.description { font-size: 10pt; color: inherit; }',
  });
}

/** A payment's receipt (rule 20). */
export function receiptHtml(snapshot: ReceiptSnapshot, assets: TemplateAssets): string {
  const otherCurrency = snapshot.currency !== snapshot.invoiceCurrency;
  const reference = snapshot.reference ? metaItem(LABELS.reference, snapshot.reference) : '';
  const applied = otherCurrency
    ? `<tr><th>${LABELS.applied}</th><td class="num">${formatMoney(snapshot.appliedMinor, snapshot.invoiceCurrency)}</td></tr>`
    : '';
  const body = `<div class="title"><h1>${LABELS.receipt} <span class="version num">${escapeHtml(snapshot.displayNumber)}</span></h1></div>
<dl class="meta">
  ${metaItem(LABELS.receiptNumber, snapshot.displayNumber, { num: true })}
  ${metaItem(LABELS.paidOn, snapshot.paidOn, { num: true })}
  ${billTo(LABELS.receivedFrom, snapshot.billingName, snapshot.billingAddress)}
  ${metaItem(LABELS.method, METHODS[snapshot.method])}
  ${reference}
  ${metaItem(LABELS.forInvoice, snapshot.invoiceNumber, { num: true })}
</dl>
<section>
  <table class="sums receipt">
    <tr class="net"><th>${LABELS.amount}</th><td class="num">${formatMoney(snapshot.amountMinor, snapshot.currency)}</td></tr>
    ${applied}
    <tr><th>${LABELS.balanceAfter}</th><td class="num">${formatMoney(snapshot.balanceAfterMinor, snapshot.invoiceCurrency)}</td></tr>
  </table>
</section>
${footer(snapshot.footer)}`;
  return documentHtml({
    title: snapshot.displayNumber,
    companyDetails: snapshot.companyDetails,
    body,
    assets,
    styles: 'table.sums.receipt { width: 70%; margin-inline-start: 0; }',
  });
}

/** A client statement in one currency over a period (rules 28 and 29). */
export function statementHtml(snapshot: StatementSnapshot, assets: TemplateAssets): string {
  const { currency } = snapshot;
  const money = (minor: number) => formatMoney(minor, currency);
  const rows = snapshot.rows
    .map((row) => {
      const description =
        row.kind === 'invoice' ? LABELS.invoiceRow : LABELS.paymentRow(row.invoiceNumber);
      const original = row.original
        ? `<div class="description num">${formatMoney(row.original.amountMinor, row.original.currency)}</div>`
        : '';
      return `<tr>
        <td class="num">${row.date}</td>
        <td><div class="num">${escapeHtml(row.number)}</div><div class="description">${escapeHtml(description)}</div></td>
        <td class="num">${row.debitMinor ? money(row.debitMinor) : ''}</td>
        <td class="num">${row.creditMinor ? money(row.creditMinor) : ''}${original}</td>
        <td class="num">${money(row.balanceMinor)}</td>
      </tr>`;
    })
    .join('');
  const empty = snapshot.rows.length
    ? ''
    : `<tr><td colspan="5" class="empty">${LABELS.noRows}</td></tr>`;
  const body = `<div class="title"><h1>${LABELS.statement}</h1></div>
<dl class="meta">
  ${billTo(LABELS.client, snapshot.billingName, snapshot.billingAddress)}
  ${metaItem(LABELS.currency, currency, { num: true })}
  ${metaItem(LABELS.period, `${snapshot.from} → ${snapshot.to}`, { num: true })}
</dl>
<section>
  <table class="lines statement">
    <thead><tr>
      <th class="date">${LABELS.date}</th><th>${LABELS.document}</th>
      <th class="money">${LABELS.debit}</th><th class="money">${LABELS.credit}</th>
      <th class="money">${LABELS.balance}</th>
    </tr></thead>
    <tbody>
      <tr class="edge"><td></td><td>${LABELS.opening}</td><td></td><td></td><td class="num">${money(snapshot.openingMinor)}</td></tr>
      ${rows}${empty}
      <tr class="edge"><td></td><td>${LABELS.closing}</td><td></td><td></td><td class="num">${money(snapshot.closingMinor)}</td></tr>
    </tbody>
  </table>
  <table class="sums">
    <tr><th>${LABELS.invoiced}</th><td class="num">${money(snapshot.invoicedMinor)}</td></tr>
    <tr><th>${LABELS.paid}</th><td class="num">${money(snapshot.paidMinor)}</td></tr>
    <tr class="net"><th>${LABELS.outstanding}</th><td class="num">${money(snapshot.outstandingMinor)}</td></tr>
  </table>
</section>`;
  return documentHtml({
    title: `${LABELS.statement} ${snapshot.billingName}`,
    companyDetails: snapshot.companyDetails,
    body,
    assets,
    styles: `
th.date { width: 14%; }
table.statement tr.edge td { font-weight: 700; color: #004139; background: #F4F8F7; }
td.empty { color: #616866; text-align: center; }
`,
  });
}
