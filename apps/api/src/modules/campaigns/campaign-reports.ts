import { Inject, Injectable } from '@nestjs/common';
import {
  type AdObjective,
  type AdPlatform,
  costPerResult,
  type ReportClients,
  type ReportPeriod,
} from '@vertex-hub/contracts';
import {
  adCampaigns,
  adCampaignUpdates,
  adWalletEntries,
  adWallets,
  type Database,
} from '@vertex-hub/db';
import { and, asc, between, eq, inArray, isNotNull, isNull, lte, type SQL, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { ClientDirectory } from '../clients/index.js';
import { AdWalletBalances } from './ad-wallet-balances.js';

/** Spend and results of updates in a month (F15 rule 18.8), USD. */
export interface CampaignMetrics {
  spendMinor: number;
  reach: number;
  clicks: number;
  results: number;
  costPerResultMinor: number | null;
}

/** A campaign with updates in a month. */
export interface CampaignMonthRow extends CampaignMetrics {
  id: string;
  platform: AdPlatform;
  name: string;
  objective: AdObjective;
}

/** The wallet over a month (F15 rule 18.9), USD; the balances may be negative. */
export interface WalletMonth {
  openingMinor: number;
  depositsMinor: number;
  refundsMinor: number;
  spendMinor: number;
  closingMinor: number;
}

/** `sum(value)` over the rows matching `where`, 0 without rows. */
const sumWhere = (value: SQL | typeof adWalletEntries.usdMinor, where: SQL) =>
  sql<number>`coalesce(sum(${value}) filter (where ${where}), 0)`.mapWith(Number);

/**
 * Read-only ad figures for dashboards and reports (F15, ADR 0027): wallets of non-archived
 * clients, in USD. Callers check the scope.
 */
@Injectable()
export class CampaignReports {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly balances: AdWalletBalances,
  ) {}

  /** Rules 1 and 4: wallets in low state (`low_since` set), with their balance. */
  async lowWallets(
    clients: ReportClients,
  ): Promise<{ clientId: string; balanceUsdMinor: number }[]> {
    if (clients !== 'all' && clients.length === 0) return [];
    const rows = await this.db
      .select({ clientId: adWallets.clientId })
      .from(adWallets)
      .where(
        and(
          isNotNull(adWallets.lowSince),
          this.clients.isLive(adWallets.clientId),
          clients === 'all' ? undefined : inArray(adWallets.clientId, [...clients]),
        ),
      );
    const ids = rows.map((row) => row.clientId);
    const totals = await this.balances.totals(this.db, ids);
    return ids.map((clientId) => ({
      clientId,
      balanceUsdMinor: totals.get(clientId)?.balanceMinor ?? 0,
    }));
  }

  /**
   * Rule 18.8: the client's non-archived campaigns with non-archived updates in the period (an
   * update lies within one month, so its start dates it), by name, and their totals.
   */
  async monthCampaigns(
    clientId: string,
    period: ReportPeriod,
  ): Promise<{ rows: CampaignMonthRow[]; totals: CampaignMetrics }> {
    const rows = await this.db
      .select({
        id: adCampaigns.id,
        platform: adCampaigns.platform,
        name: adCampaigns.name,
        objective: adCampaigns.objective,
        spendMinor: sql<number>`sum(${adCampaignUpdates.spendMinor})`.mapWith(Number),
        reach: sql<number>`sum(${adCampaignUpdates.reach})`.mapWith(Number),
        clicks: sql<number>`sum(${adCampaignUpdates.clicks})`.mapWith(Number),
        results: sql<number>`sum(${adCampaignUpdates.results})`.mapWith(Number),
      })
      .from(adCampaignUpdates)
      .innerJoin(adCampaigns, eq(adCampaigns.id, adCampaignUpdates.campaignId))
      .where(
        and(
          eq(adCampaigns.clientId, clientId),
          isNull(adCampaigns.archivedAt),
          isNull(adCampaignUpdates.archivedAt),
          between(adCampaignUpdates.periodStart, period.from, period.to),
        ),
      )
      .groupBy(adCampaigns.id)
      .orderBy(asc(adCampaigns.name), asc(adCampaigns.id));
    const totals = { spendMinor: 0, reach: 0, clicks: 0, results: 0 };
    for (const row of rows) {
      totals.spendMinor += row.spendMinor;
      totals.reach += row.reach;
      totals.clicks += row.clicks;
      totals.results += row.results;
    }
    return {
      rows: rows.map((row) => ({
        ...row,
        costPerResultMinor: costPerResult(row.spendMinor, row.results),
      })),
      totals: { ...totals, costPerResultMinor: costPerResult(totals.spendMinor, totals.results) },
    };
  }

  /**
   * Rule 18.9: the wallet's opening balance at the period's start, its non-void deposits and
   * refunds and its counted spend in the period, and the closing balance; null when the client
   * has no wallet activity up to the period's end.
   */
  async walletMonth(clientId: string, period: ReportPeriod): Promise<WalletMonth | null> {
    const live = (kind: 'deposit' | 'refund') =>
      sql`${adWalletEntries.kind} = ${kind} and ${isNull(adWalletEntries.voidedAt)}`;
    const before = sql`${adWalletEntries.occurredOn} < ${period.from}`;
    const during = sql`${adWalletEntries.occurredOn} between ${period.from} and ${period.to}`;
    const spendBefore = sql`${adCampaignUpdates.periodStart} < ${period.from}`;
    const spendDuring = sql`${adCampaignUpdates.periodStart} between ${period.from} and ${period.to}`;
    const [[entries], [spend]] = await Promise.all([
      this.db
        .select({
          count: sql<number>`count(*) filter (where ${isNull(adWalletEntries.voidedAt)})`.mapWith(
            Number,
          ),
          depositsBefore: sumWhere(adWalletEntries.usdMinor, sql`${live('deposit')} and ${before}`),
          refundsBefore: sumWhere(adWalletEntries.usdMinor, sql`${live('refund')} and ${before}`),
          deposits: sumWhere(adWalletEntries.usdMinor, sql`${live('deposit')} and ${during}`),
          refunds: sumWhere(adWalletEntries.usdMinor, sql`${live('refund')} and ${during}`),
        })
        .from(adWalletEntries)
        .where(
          and(eq(adWalletEntries.clientId, clientId), lte(adWalletEntries.occurredOn, period.to)),
        ),
      this.db
        .select({
          count: sql<number>`count(*)`.mapWith(Number),
          before: sumWhere(sql`${adCampaignUpdates.spendMinor}`, spendBefore),
          during: sumWhere(sql`${adCampaignUpdates.spendMinor}`, spendDuring),
        })
        .from(adCampaignUpdates)
        .innerJoin(adCampaigns, eq(adCampaigns.id, adCampaignUpdates.campaignId))
        .where(
          and(
            eq(adCampaigns.clientId, clientId),
            // `spendCountsInWallet`: non-archived updates of non-archived wallet campaigns.
            eq(adCampaigns.funding, 'wallet'),
            isNull(adCampaigns.archivedAt),
            isNull(adCampaignUpdates.archivedAt),
            lte(adCampaignUpdates.periodStart, period.to),
          ),
        ),
    ]);
    if (!entries?.count && !spend?.count) return null;
    const opening =
      (entries?.depositsBefore ?? 0) - (entries?.refundsBefore ?? 0) - (spend?.before ?? 0);
    const depositsMinor = entries?.deposits ?? 0;
    const refundsMinor = entries?.refunds ?? 0;
    const spendMinor = spend?.during ?? 0;
    return {
      openingMinor: opening,
      depositsMinor,
      refundsMinor,
      spendMinor,
      closingMinor: opening + depositsMinor - refundsMinor - spendMinor,
    };
  }
}
