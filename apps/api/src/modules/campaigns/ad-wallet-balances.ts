import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  addDays,
  businessDate,
  CAMPAIGN_LIMITS,
  type CalendarDate,
  daysInclusive,
  isLowBalance,
} from '@vertex-hub/contracts';
import {
  adCampaigns,
  adCampaignUpdates,
  adWalletEntries,
  adWallets,
  type Database,
  type Transaction,
} from '@vertex-hub/db';
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  type SQL,
  type SQLWrapper,
  sql,
} from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { runEach } from '../../core/jobs/index.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { ClientDirectory, type ClientSummary } from '../clients/index.js';
import { DailyReminders, type Notice, NotificationCenter } from '../notifications/index.js';

export type WalletRow = typeof adWallets.$inferSelect;

type Executor = Database | Transaction;

/** Rule 15's totals of one client, over non-void entries and counted spend. */
export interface WalletTotals {
  depositedMinor: number;
  refundedMinor: number;
  spentMinor: number;
  balanceMinor: number;
  /** Has a non-void deposit (rule 20). */
  usesWallet: boolean;
  lastDepositOn: string | null;
}

const NO_TOTALS: WalletTotals = {
  depositedMinor: 0,
  refundedMinor: 0,
  spentMinor: 0,
  balanceMinor: 0,
  usesWallet: false,
  lastDepositOn: null,
};

/** `sum(value)`, over the rows matching `where` when given; 0 without rows. */
const sumOf = (value: SQLWrapper, where?: SQL) =>
  sql<number>`coalesce(sum(${value})${where ? sql` filter (where ${where})` : sql``}, 0)`.mapWith(
    Number,
  );

/**
 * The clients' ad wallets (spec F12, rules 15, 17 and 20–22): the row lock every balance change
 * takes, the balance computed on read, and A11 — the `ad_budget_low` alert when the balance
 * crosses below the threshold, repeated weekly by the `ad-budget-low` source of
 * `notifications.daily` while it stays below.
 */
@Injectable()
export class AdWalletBalances implements OnModuleInit {
  private readonly logger = new Logger(AdWalletBalances.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly reminders: DailyReminders,
    private readonly center: NotificationCenter,
  ) {}

  onModuleInit(): void {
    this.reminders.register('ad-budget-low', (today) => this.remind(today));
  }

  /** Rule 17: creates the client's wallet row on first use, then locks it. */
  async lock(tx: Transaction, clientId: string): Promise<WalletRow> {
    await tx.insert(adWallets).values({ clientId }).onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(adWallets)
      .where(eq(adWallets.clientId, clientId))
      .for('update');
    if (!row) throw new Error('The wallet row is missing');
    return row;
  }

  /** The wallet row, or null before first use. */
  async row(executor: Executor, clientId: string): Promise<WalletRow | null> {
    const [row] = await executor.select().from(adWallets).where(eq(adWallets.clientId, clientId));
    return row ?? null;
  }

  /** Rule 15's totals by client; clients without entries or spend get zeros. */
  async totals(
    executor: Executor,
    clientIds: readonly string[],
  ): Promise<Map<string, WalletTotals>> {
    const ids = [...new Set(clientIds)];
    if (ids.length === 0) return new Map();
    const live = (kind: 'deposit' | 'refund') =>
      sql`${adWalletEntries.kind} = ${kind} and ${isNull(adWalletEntries.voidedAt)}`;
    const entries = await executor
      .select({
        clientId: adWalletEntries.clientId,
        depositedMinor: sumOf(adWalletEntries.usdMinor, live('deposit')),
        refundedMinor: sumOf(adWalletEntries.usdMinor, live('refund')),
        deposits: sql<number>`count(*) filter (where ${live('deposit')})`.mapWith(Number),
        lastDepositOn: sql<
          string | null
        >`max(${adWalletEntries.occurredOn}) filter (where ${live('deposit')})`,
      })
      .from(adWalletEntries)
      .where(inArray(adWalletEntries.clientId, ids))
      .groupBy(adWalletEntries.clientId);
    const spend = await executor
      .select({
        clientId: adCampaigns.clientId,
        spentMinor: sumOf(adCampaignUpdates.spendMinor),
      })
      .from(adCampaignUpdates)
      .innerJoin(adCampaigns, eq(adCampaigns.id, adCampaignUpdates.campaignId))
      .where(
        and(
          inArray(adCampaigns.clientId, ids),
          // `spendCountsInWallet`: non-archived updates of non-archived wallet campaigns.
          eq(adCampaigns.funding, 'wallet'),
          isNull(adCampaigns.archivedAt),
          isNull(adCampaignUpdates.archivedAt),
        ),
      )
      .groupBy(adCampaigns.clientId);
    const spentBy = new Map(spend.map((row) => [row.clientId, row.spentMinor]));
    const entriesBy = new Map(entries.map((row) => [row.clientId, row]));
    return new Map(
      ids.map((id) => {
        const entry = entriesBy.get(id);
        const spentMinor = spentBy.get(id) ?? 0;
        if (!entry) return [id, { ...NO_TOTALS, spentMinor, balanceMinor: -spentMinor }];
        return [
          id,
          {
            depositedMinor: entry.depositedMinor,
            refundedMinor: entry.refundedMinor,
            spentMinor,
            balanceMinor: entry.depositedMinor - entry.refundedMinor - spentMinor,
            usesWallet: entry.deposits > 0,
            lastDepositOn: entry.lastDepositOn,
          },
        ];
      }),
    );
  }

  async totalsOf(executor: Executor, clientId: string): Promise<WalletTotals> {
    return (await this.totals(executor, [clientId])).get(clientId) ?? NO_TOTALS;
  }

  /**
   * Rule 20, at the end of a change under the wallet lock: crossing below the threshold sets
   * `low_since` and alerts once; being back at or above it (or without a threshold) clears it.
   * Both are audited with the change's actor (rule 24). Returns the totals after the change.
   */
  async settle(
    tx: Transaction,
    actor: AuditActor,
    wallet: WalletRow,
    client: ClientSummary,
  ): Promise<WalletTotals> {
    const totals = await this.totalsOf(tx, client.id);
    const threshold = wallet.lowBalanceThresholdMinor;
    const low = isLowBalance(totals.balanceMinor, threshold, totals.usesWallet);
    if (low === (wallet.lowSince !== null)) return totals;
    await tx
      .update(adWallets)
      .set({ lowSince: low ? new Date() : null })
      .where(eq(adWallets.clientId, client.id));
    await recordAudit(tx, {
      actor,
      action: low ? 'ad_wallet.low_balance' : 'ad_wallet.low_balance_cleared',
      entityType: 'ad_wallet',
      entityId: client.id,
      before: { clientId: client.id, low: !low },
      after: {
        clientId: client.id,
        low,
        balanceMinor: totals.balanceMinor,
        thresholdMinor: threshold,
      },
    });
    if (low && threshold !== null) {
      await this.center.notify(tx, await this.notice(tx, client, totals.balanceMinor, threshold));
    }
    return totals;
  }

  /**
   * Rule 21: every 7 days from `low_since` while it stays set, keyed by the client and the week
   * mark so a rerun sends it once (the `invoices-overdue` pattern).
   */
  async remind(today: CalendarDate): Promise<number> {
    const candidates = await this.db
      .select({ clientId: adWallets.clientId })
      .from(adWallets)
      .where(isNotNull(adWallets.lowSince))
      .orderBy(asc(adWallets.clientId));
    let sent = 0;
    await runEach(
      candidates,
      this.logger,
      ({ clientId }) => `Ad budget reminder ${clientId}`,
      async ({ clientId }) => {
        const recorded = await this.db.transaction(async (tx) => {
          const wallet = await this.lock(tx, clientId);
          const threshold = wallet.lowBalanceThresholdMinor;
          if (!wallet.lowSince || threshold === null) return false;
          const since = businessDate(wallet.lowSince);
          const days = daysInclusive(since, today) - 1;
          const every = CAMPAIGN_LIMITS.lowBalanceReminderDays;
          const weeks = Math.floor(days / every);
          if (weeks < 1) return false;
          const client = await this.clients.summary(clientId, tx);
          if (!client) return false;
          const { balanceMinor } = await this.totalsOf(tx, clientId);
          return this.reminders.remindOnce(
            tx,
            {
              kind: 'ad_budget_low',
              subjectId: clientId,
              occurrence: addDays(since, weeks * every),
            },
            today,
            await this.notice(tx, client, balanceMinor, threshold),
          );
        });
        if (recorded) sent += 1;
      },
    );
    return sent;
  }

  /**
   * Rules 20 and 22: the client's account manager and the owners of its `active` wallet
   * campaigns, resolved when sent; the actor of the change is not left out.
   */
  private async notice(
    tx: Transaction,
    client: ClientSummary,
    balanceMinor: number,
    thresholdMinor: number,
  ): Promise<Notice> {
    const owners = await tx
      .selectDistinct({ ownerId: adCampaigns.ownerId })
      .from(adCampaigns)
      .where(
        and(
          eq(adCampaigns.clientId, client.id),
          eq(adCampaigns.status, 'active'),
          eq(adCampaigns.funding, 'wallet'),
          isNull(adCampaigns.archivedAt),
        ),
      );
    return {
      type: 'ad_budget_low',
      recipients: [client.accountManagerId, ...owners.map((row) => row.ownerId)],
      actorId: null,
      subjectId: client.id,
      data: { client: client.name, balanceMinor, thresholdMinor },
    };
  }
}
