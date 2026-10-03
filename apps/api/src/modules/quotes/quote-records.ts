import {
  businessDate,
  type QuoteSnapshot,
  type QuoteTotals,
  quoteDisplayNumber,
  quoteTotals,
  quoteValidUntil,
} from '@vertex-hub/contracts';
import {
  type Database,
  quoteInstallments,
  quoteLineItems,
  quoteLines,
  quotes,
  type Transaction,
} from '@vertex-hub/db';
import { asc, inArray } from 'drizzle-orm';
import { payloadHash } from '../../core/jobs/index.js';

/*
 * The rows of a quote version and the amounts computed from them, shared by the quote services.
 */

export type QuoteRow = typeof quotes.$inferSelect;
export type LineRow = typeof quoteLines.$inferSelect;
export type ItemRow = typeof quoteLineItems.$inferSelect;
export type InstallmentRow = typeof quoteInstallments.$inferSelect;

export type LineWithItems = LineRow & { items: ItemRow[] };

export interface QuoteChildren {
  lines: LineWithItems[];
  installments: InstallmentRow[];
}

const SECTION_ORDER = { one_off: 0, monthly: 1 } as const;

/** The lines (by section, then position) and installments of the quotes. */
export async function quoteChildren(
  executor: Database | Transaction,
  quoteIds: string[],
): Promise<Map<string, QuoteChildren>> {
  const result = new Map<string, QuoteChildren>(
    quoteIds.map((id) => [id, { lines: [], installments: [] }]),
  );
  if (quoteIds.length === 0) return result;
  const lines = await executor
    .select()
    .from(quoteLines)
    .where(inArray(quoteLines.quoteId, quoteIds))
    .orderBy(asc(quoteLines.position));
  const items = lines.length
    ? await executor
        .select()
        .from(quoteLineItems)
        .where(
          inArray(
            quoteLineItems.lineId,
            lines.map((line) => line.id),
          ),
        )
        .orderBy(asc(quoteLineItems.position))
    : [];
  const installments = await executor
    .select()
    .from(quoteInstallments)
    .where(inArray(quoteInstallments.quoteId, quoteIds))
    .orderBy(asc(quoteInstallments.position));
  const sorted = [...lines].sort(
    (a, b) => SECTION_ORDER[a.section] - SECTION_ORDER[b.section] || a.position - b.position,
  );
  for (const line of sorted) {
    result.get(line.quoteId)?.lines.push({
      ...line,
      items: items.filter((item) => item.lineId === line.id),
    });
  }
  for (const installment of installments) {
    result.get(installment.quoteId)?.installments.push(installment);
  }
  return result;
}

/** Rule 5 over stored rows. */
export function totalsOf(
  quote: Pick<QuoteRow, 'oneOffDiscountMinor' | 'monthlyDiscountMinor' | 'monthlyTermMonths'>,
  children: QuoteChildren,
): QuoteTotals {
  return quoteTotals({
    lines: children.lines,
    oneOffDiscountMinor: quote.oneOffDiscountMinor,
    monthlyDiscountMinor: quote.monthlyDiscountMinor,
    installments: children.installments,
    monthlyTermMonths: quote.monthlyTermMonths,
  });
}

/** The effective discount as a percentage with two decimals, as the audit log records it. */
export const percentOf = (basisPoints: number) => basisPoints / 100;

/** What every quote audit entry carries: the client, the number and the version. */
export const identity = (quote: QuoteRow) => ({
  clientId: quote.clientId,
  displayNumber: quoteDisplayNumber(quote),
});

/** The amounts of a version as `quote.updated` compares them. */
export function amounts(totals: QuoteTotals) {
  return {
    oneOffNetMinor: totals.oneOff.netMinor,
    monthlyNetMinor: totals.monthly.netMinor,
    oneOffEffectiveDiscount: percentOf(totals.oneOff.effectiveDiscountBasisPoints),
    monthlyEffectiveDiscount: percentOf(totals.monthly.effectiveDiscountBasisPoints),
  };
}

/** Rule 12: what the PDF prints, frozen at send; no list prices or effective discounts (rule 14). */
export function buildSnapshot(
  quote: QuoteRow,
  children: QuoteChildren,
  context: Pick<QuoteSnapshot, 'companyDetails' | 'client' | 'addressee' | 'sentOn' | 'validUntil'>,
): QuoteSnapshot {
  const totals = totalsOf(quote, children);
  const section = (name: 'one_off' | 'monthly') =>
    children.lines.flatMap((line, index) =>
      line.section === name
        ? [
            {
              name: line.name,
              description: line.description,
              quantity: line.quantity,
              unitPriceMinor: line.unitPriceMinor,
              totalMinor: totals.lineTotalsMinor[index] ?? 0,
              items: line.items.map((item) => ({ name: item.name, quantity: item.quantity })),
            },
          ]
        : [],
    );
  const sums = (name: 'oneOff' | 'monthly') => ({
    subtotalMinor: totals[name].subtotalMinor,
    discountMinor: totals[name].discountMinor,
    netMinor: totals[name].netMinor,
  });
  return {
    ...context,
    displayNumber: quoteDisplayNumber(quote),
    title: quote.title,
    currency: quote.currency,
    oneOff: { lines: section('one_off'), ...sums('oneOff') },
    monthly: {
      lines: section('monthly'),
      ...sums('monthly'),
      termMonths: quote.monthlyTermMonths,
      termTotalMinor: totals.monthlyTermTotalMinor,
    },
    installments: children.installments.map((installment, index) => ({
      name: installment.name,
      percent: installment.percent,
      amountMinor: totals.installmentAmountsMinor[index] ?? 0,
    })),
    clientNotes: quote.clientNotes,
    terms: quote.terms,
  };
}

/** Names a render (rules 12 and 13): the same payload, the same PDF. */
export function renderHash(snapshot: QuoteSnapshot, draft: boolean): string {
  return payloadHash({ draft, snapshot });
}

/** A quote without a draft preview: before the first, and once the draft is sent or discarded. */
export const NO_DRAFT_PDF = {
  draftPdfStatus: null,
  draftPdfRequestedHash: null,
  draftPdfObjectKey: null,
  draftPdfAt: null,
  draftPdfHash: null,
} as const;

/** The file name of a version's PDF: `Q-2026-0007 v1.pdf`, the version always shown. */
export const pdfFileName = (quote: Pick<QuoteRow, 'year' | 'number' | 'version'>) =>
  `${quoteDisplayNumber({ ...quote, version: 1 })} v${quote.version}.pdf`;

/** Rule 13: the payload of a draft preview, dated as if sent today. */
export function draftSnapshot(
  quote: QuoteRow,
  children: QuoteChildren,
  context: Pick<QuoteSnapshot, 'companyDetails' | 'client' | 'addressee'>,
): QuoteSnapshot {
  const sentOn = businessDate();
  return buildSnapshot(quote, children, {
    ...context,
    sentOn,
    validUntil: quoteValidUntil(sentOn, quote.validityDays),
  });
}
