import { Inject, Injectable } from '@nestjs/common';
import {
  CURRENCIES,
  type Currency,
  type ReportClients,
  type ReportPeriod,
  toUsdMinor,
} from '@vertex-hub/contracts';
import { type Database, invoices, payments } from '@vertex-hub/db';
import { and, between, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';

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

/** Issued and not void: what every revenue figure counts (F13: void leaves every total). */
const issued = and(notInArray(invoices.status, ['draft', 'void']), isNull(invoices.archivedAt));

/**
 * Read-only invoice and payment figures for dashboards and reports (F15, ADR 0027), converted to
 * USD with each record's stored rate (ADR 0006). Callers check the scope.
 */
@Injectable()
export class InvoiceReports {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

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
