import { Inject, Injectable } from '@nestjs/common';
import {
  CURRENCIES,
  type Currency,
  invoiceDisplayNumber,
  type ReportClients,
  type ReportPeriod,
  type RevenueLine,
  type RevenueTarget,
  splitRevenue,
  toUsdMinor,
} from '@vertex-hub/contracts';
import { type Database, invoiceLines, invoices, payments } from '@vertex-hub/db';
import { and, asc, between, eq, inArray, isNull, lte, notInArray, or, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { type AcceptedQuoteLine, QuoteDirectory } from '../quotes/index.js';

/** Balances per currency and in USD at each invoice's rate. */
export interface BalanceTotals {
  byCurrency: { currency: Currency; amountMinor: number }[];
  usdMinor: number;
}

/** Issued, non-void invoices with a balance, now (F15 rules 2 and 4). */
export interface OutstandingInvoices {
  outstanding: BalanceTotals;
  overdue: BalanceTotals & { count: number };
  /** Per client: the outstanding balance in USD and the overdue count. */
  byClient: Map<string, { outstandingUsdMinor: number; overdue: number }>;
}

/** Invoiced and collected in USD. */
interface RevenueAmounts {
  invoicedUsdMinor: number;
  collectedUsdMinor: number;
}

/** An invoice of the revenue report's Invoices sheet (F15 rule 15). */
export interface RevenueInvoice {
  id: string;
  number: string;
  clientId: string;
  issuedOn: string;
  currency: Currency;
  totalMinor: number;
  sypPerUsd: string | null;
  totalUsdMinor: number;
  collectedUsdMinor: number;
}

/** F15 rules 12–15 over a period. */
export interface RevenueFigures extends RevenueAmounts {
  /** Per client; outstanding at the end of the period. */
  byClient: Map<string, RevenueAmounts & { outstandingUsdMinor: number }>;
  /** Per `service:<id>` or `package:<id>`; null is "Unclassified". */
  byTarget: Map<string | null, RevenueAmounts>;
  /** Issued in the period or paid in it, by issue date then number. */
  invoices: RevenueInvoice[];
}

/** An overdue invoice now (F15 rule 16). */
export interface OverdueInvoice {
  id: string;
  number: string;
  clientId: string;
  currency: Currency;
  totalMinor: number;
  paidMinor: number;
  balanceMinor: number;
  balanceUsdMinor: number;
  dueOn: string;
}

/** Issued and not void: what every revenue figure counts (F13: void leaves every total). */
const issued = and(notInArray(invoices.status, ['draft', 'void']), isNull(invoices.archivedAt));

/**
 * Read-only invoice and payment figures for dashboards and reports (F15, ADR 0027), converted to
 * USD with each record's stored rate (ADR 0006). Callers check the scope.
 */
@Injectable()
export class InvoiceReports {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly quotes: QuoteDirectory,
  ) {}

  /** Rule 2: Σ issued, non-void invoices with `issued_on` in the period, in USD. */
  async invoicedUsd(period: ReportPeriod): Promise<number> {
    const rows = await this.db
      .select({
        totalMinor: invoices.totalMinor,
        currency: invoices.currency,
        sypPerUsd: invoices.sypPerUsd,
      })
      .from(invoices)
      .where(and(issued, between(invoices.issuedOn, period.from, period.to)));
    return rows.reduce((sum, row) => sum + inUsd(row.totalMinor, row.currency, row.sypPerUsd), 0);
  }

  /** Rule 2: Σ non-void payments with `paid_on` in the period, in USD at each payment's rate. */
  async collectedUsd(period: ReportPeriod): Promise<number> {
    const rows = await this.db
      .select({
        amountMinor: payments.amountMinor,
        currency: payments.currency,
        sypPerUsd: payments.sypPerUsd,
      })
      .from(payments)
      .where(and(isNull(payments.voidedAt), between(payments.paidOn, period.from, period.to)));
    return rows.reduce(
      (sum, row) => sum + toUsdMinor(row.amountMinor, row.currency, row.sypPerUsd),
      0,
    );
  }

  /** Rules 2 and 4: balances of issued, non-void invoices now, overdue ones apart. */
  async outstanding(clients: ReportClients): Promise<OutstandingInvoices> {
    const result: OutstandingInvoices = {
      outstanding: { byCurrency: [], usdMinor: 0 },
      overdue: { count: 0, byCurrency: [], usdMinor: 0 },
      byClient: new Map(),
    };
    if (clients !== 'all' && clients.length === 0) return result;
    const rows = await this.db
      .select({
        clientId: invoices.clientId,
        status: invoices.status,
        currency: invoices.currency,
        sypPerUsd: invoices.sypPerUsd,
        balanceMinor: sql<number>`${invoices.totalMinor} - ${invoices.paidMinor}`.mapWith(Number),
      })
      .from(invoices)
      .where(
        and(
          issued,
          sql`${invoices.totalMinor} > ${invoices.paidMinor}`,
          clients === 'all' ? undefined : inArray(invoices.clientId, [...clients]),
        ),
      );
    const outstanding = new Map<Currency, number>();
    const overdue = new Map<Currency, number>();
    for (const row of rows) {
      const usd = inUsd(row.balanceMinor, row.currency, row.sypPerUsd);
      const isOverdue = row.status === 'overdue';
      outstanding.set(row.currency, (outstanding.get(row.currency) ?? 0) + row.balanceMinor);
      result.outstanding.usdMinor += usd;
      if (isOverdue) {
        overdue.set(row.currency, (overdue.get(row.currency) ?? 0) + row.balanceMinor);
        result.overdue.usdMinor += usd;
        result.overdue.count += 1;
      }
      const client = result.byClient.get(row.clientId) ?? { outstandingUsdMinor: 0, overdue: 0 };
      client.outstandingUsdMinor += usd;
      if (isOverdue) client.overdue += 1;
      result.byClient.set(row.clientId, client);
    }
    result.outstanding.byCurrency = byCurrency(outstanding);
    result.overdue.byCurrency = byCurrency(overdue);
    return result;
  }

  /**
   * F15 rules 12–15: invoiced (issued in the period) and collected (paid in the period) in USD,
   * by client with the outstanding balance at the period's end, and split by service (rule 14).
   * Voided invoices and payments count nowhere (edge cases 6 and 7).
   */
  async revenue(period: ReportPeriod): Promise<RevenueFigures> {
    const paid = await this.db
      .select({
        invoiceId: payments.invoiceId,
        amountMinor: payments.amountMinor,
        currency: payments.currency,
        sypPerUsd: payments.sypPerUsd,
      })
      .from(payments)
      .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
      .where(
        and(issued, isNull(payments.voidedAt), between(payments.paidOn, period.from, period.to)),
      );
    const paidIds = [...new Set(paid.map((row) => row.invoiceId))];
    const inPeriod = between(invoices.issuedOn, period.from, period.to);
    const rows = await this.db
      .select({
        id: invoices.id,
        clientId: invoices.clientId,
        projectId: invoices.projectId,
        retainerId: invoices.retainerId,
        year: invoices.year,
        number: invoices.number,
        issuedOn: invoices.issuedOn,
        currency: invoices.currency,
        totalMinor: invoices.totalMinor,
        sypPerUsd: invoices.sypPerUsd,
      })
      .from(invoices)
      .where(and(issued, paidIds.length ? or(inPeriod, inArray(invoices.id, paidIds)) : inPeriod))
      .orderBy(asc(invoices.issuedOn), asc(invoices.year), asc(invoices.number));
    const splits = await this.revenueLines(rows);
    const result: RevenueFigures = {
      invoicedUsdMinor: 0,
      collectedUsdMinor: 0,
      byClient: new Map(),
      byTarget: new Map(),
      invoices: [],
    };
    const client = (id: string) => {
      const entry = result.byClient.get(id) ?? {
        invoicedUsdMinor: 0,
        collectedUsdMinor: 0,
        outstandingUsdMinor: 0,
      };
      result.byClient.set(id, entry);
      return entry;
    };
    const target = (key: string | null) => {
      const entry = result.byTarget.get(key) ?? { invoicedUsdMinor: 0, collectedUsdMinor: 0 };
      result.byTarget.set(key, entry);
      return entry;
    };
    const collected = new Map<string, number>();
    for (const payment of paid) {
      const usd = toUsdMinor(payment.amountMinor, payment.currency, payment.sypPerUsd);
      collected.set(payment.invoiceId, (collected.get(payment.invoiceId) ?? 0) + usd);
      for (const [key, amount] of splitRevenue(usd, splits.get(payment.invoiceId) ?? [])) {
        target(key).collectedUsdMinor += amount;
      }
    }
    for (const row of rows) {
      const totalUsdMinor = inUsd(row.totalMinor, row.currency, row.sypPerUsd);
      const collectedUsdMinor = collected.get(row.id) ?? 0;
      if (row.issuedOn && row.issuedOn >= period.from && row.issuedOn <= period.to) {
        result.invoicedUsdMinor += totalUsdMinor;
        client(row.clientId).invoicedUsdMinor += totalUsdMinor;
        for (const [key, amount] of splitRevenue(totalUsdMinor, splits.get(row.id) ?? [])) {
          target(key).invoicedUsdMinor += amount;
        }
      }
      result.collectedUsdMinor += collectedUsdMinor;
      if (collectedUsdMinor) client(row.clientId).collectedUsdMinor += collectedUsdMinor;
      if (row.issuedOn && row.year && row.number) {
        result.invoices.push({
          id: row.id,
          number: invoiceDisplayNumber({ year: row.year, number: row.number }),
          clientId: row.clientId,
          issuedOn: row.issuedOn,
          currency: row.currency,
          totalMinor: row.totalMinor,
          sypPerUsd: row.sypPerUsd,
          totalUsdMinor,
          collectedUsdMinor,
        });
      }
    }
    for (const [clientId, usd] of await this.outstandingOn(period.to)) {
      client(clientId).outstandingUsdMinor = usd;
    }
    return result;
  }

  /** F15 rule 16: invoices `overdue` now, of the clients, in a currency when given. */
  async overdueInvoices(clients: ReportClients, currency?: Currency): Promise<OverdueInvoice[]> {
    if (clients !== 'all' && clients.length === 0) return [];
    const rows = await this.db
      .select({
        id: invoices.id,
        year: invoices.year,
        number: invoices.number,
        clientId: invoices.clientId,
        currency: invoices.currency,
        totalMinor: invoices.totalMinor,
        paidMinor: invoices.paidMinor,
        sypPerUsd: invoices.sypPerUsd,
        dueOn: invoices.dueOn,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.status, 'overdue'),
          isNull(invoices.archivedAt),
          currency ? eq(invoices.currency, currency) : undefined,
          clients === 'all' ? undefined : inArray(invoices.clientId, [...clients]),
        ),
      )
      .orderBy(asc(invoices.dueOn), asc(invoices.year), asc(invoices.number));
    return rows.flatMap(({ year, number, dueOn, sypPerUsd, ...row }) => {
      if (!year || !number || !dueOn) return [];
      const balanceMinor = row.totalMinor - row.paidMinor;
      return [
        {
          ...row,
          number: invoiceDisplayNumber({ year, number }),
          dueOn,
          balanceMinor,
          balanceUsdMinor: inUsd(balanceMinor, row.currency, sypPerUsd),
        },
      ];
    });
  }

  /** Rule 13: per client, issued on or before `day` less payments on or before it, in USD. */
  private async outstandingOn(day: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({
        clientId: invoices.clientId,
        currency: invoices.currency,
        sypPerUsd: invoices.sypPerUsd,
        totalMinor: invoices.totalMinor,
        // Qualified by hand: Drizzle leaves columns unqualified in a single-table select.
        paidMinor: sql<number>`coalesce((select sum(p.applied_minor) from ${payments} as p
          where p.invoice_id = "invoices"."id" and p.voided_at is null
            and p.paid_on <= ${day}), 0)`.mapWith(Number),
      })
      .from(invoices)
      .where(and(issued, lte(invoices.issuedOn, day)));
    const result = new Map<string, number>();
    for (const row of rows) {
      const balance = Math.max(0, row.totalMinor - row.paidMinor);
      if (balance === 0) continue;
      const usd = inUsd(balance, row.currency, row.sypPerUsd);
      result.set(row.clientId, (result.get(row.clientId) ?? 0) + usd);
    }
    return result;
  }

  /**
   * Rule 14: each invoice's lines with where their share goes — the line's service; else, for a
   * milestone line, the project's accepted quote's one-off lines and, for a retainer charge line,
   * the retainer's accepted quote's monthly lines (packages as themselves); else "Unclassified".
   */
  private async revenueLines(
    rows: { id: string; projectId: string | null; retainerId: string | null }[],
  ): Promise<Map<string, RevenueLine[]>> {
    const result = new Map<string, RevenueLine[]>();
    if (rows.length === 0) return result;
    const lines = await this.db
      .select({
        invoiceId: invoiceLines.invoiceId,
        quantity: invoiceLines.quantity,
        unitPriceMinor: invoiceLines.unitPriceMinor,
        serviceId: invoiceLines.serviceId,
        milestoneId: invoiceLines.milestoneId,
        retainerChargeId: invoiceLines.retainerChargeId,
      })
      .from(invoiceLines)
      .where(
        inArray(
          invoiceLines.invoiceId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(invoiceLines.invoiceId), asc(invoiceLines.position));
    const engagements = new Map(rows.map((row) => [row.id, row]));
    const ids = (pick: (row: (typeof rows)[number]) => string | null) => [
      ...new Set(rows.flatMap((row) => pick(row) ?? [])),
    ];
    const quoted = await this.quotes.acceptedLines({
      projectIds: ids((row) => row.projectId),
      retainerIds: ids((row) => row.retainerId),
    });
    const fromQuote = (key: string, section: AcceptedQuoteLine['section']): RevenueTarget[] =>
      (quoted.get(key) ?? [])
        .filter((line) => line.section === section)
        .map((line) => ({
          key: line.packageId
            ? `package:${line.packageId}`
            : line.serviceId
              ? `service:${line.serviceId}`
              : null,
          weight: line.totalMinor,
        }));
    for (const line of lines) {
      const invoice = engagements.get(line.invoiceId);
      let targets: RevenueTarget[] = [];
      if (line.serviceId) {
        targets = [{ key: `service:${line.serviceId}`, weight: 1 }];
      } else if (line.milestoneId && invoice?.projectId) {
        targets = fromQuote(`project:${invoice.projectId}`, 'one_off');
      } else if (line.retainerChargeId && invoice?.retainerId) {
        targets = fromQuote(`retainer:${invoice.retainerId}`, 'monthly');
      }
      const list = result.get(line.invoiceId) ?? [];
      list.push({ totalMinor: line.quantity * line.unitPriceMinor, targets });
      result.set(line.invoiceId, list);
    }
    return result;
  }
}

/** An issued invoice always carries its rate; a USD amount needs none. */
function inUsd(amount: number, currency: Currency, rate: string | null): number {
  if (currency === 'USD') return amount;
  return rate ? toUsdMinor(amount, currency, rate) : 0;
}

const byCurrency = (amounts: Map<Currency, number>) =>
  CURRENCIES.flatMap((currency) =>
    amounts.has(currency) ? [{ currency, amountMinor: amounts.get(currency) ?? 0 }] : [],
  );
