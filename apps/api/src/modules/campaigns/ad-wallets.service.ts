import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type AdWallet,
  type AdWalletQuery,
  adDepositDisplayNumber,
  adWalletBalance,
  businessDate,
  CAMPAIGN_LIMITS,
  isLowBalance,
  type RecordWalletEntry,
  toUsdMinor,
  type UpdateWalletThreshold,
  type VoidWalletEntry,
  type WalletEntry,
  type WalletLedgerItem,
  type WalletLedgerRow,
  type WalletListQuery,
  type WalletPage,
  walletLedger,
} from '@vertex-hub/contracts';
import {
  adCampaigns,
  adCampaignUpdates,
  adWalletEntries,
  adWallets,
  type Database,
  type Transaction,
} from '@vertex-hub/db';
import { and, desc, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { ClientDirectory, type ClientSummary } from '../clients/index.js';
import { GeneratedFiles } from '../files/index.js';
import { DocumentNumbers } from '../invoices/index.js';
import { AdWalletBalances, type WalletRow } from './ad-wallet-balances.js';
import { actorOf, covers, readsAll } from './campaign-access.js';

type EntryRow = typeof adWalletEntries.$inferSelect;

type Executor = Database | Transaction;

const receiptNumberOf = (entry: EntryRow) =>
  entry.year && entry.number
    ? adDepositDisplayNumber({ year: entry.year, number: entry.number })
    : null;

/** What every entry audit entry carries. */
const entryIdentity = (entry: EntryRow) => ({
  clientId: entry.clientId,
  kind: entry.kind,
  receiptNumber: receiptNumberOf(entry),
});

/** A wallet without a row yet has the default threshold (`ad_wallets` default). */
const thresholdOf = (wallet: WalletRow | null | undefined) =>
  wallet ? wallet.lowBalanceThresholdMinor : CAMPAIGN_LIMITS.lowBalanceThresholdMinor;

/**
 * The clients' ad-budget wallets (spec F12, rules 15–20): the Ad budgets list, a client's wallet
 * with its ledger, the low-balance threshold, and deposits and refunds recorded and voided by
 * `campaigns.fund` holders. Every change locks the wallet row (`AdWalletBalances`).
 */
@Injectable()
export class AdWalletsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly users: UserDirectory,
    private readonly balances: AdWalletBalances,
    private readonly numbers: DocumentNumbers,
    private readonly files: GeneratedFiles,
  ) {}

  /**
   * Clients in scope that use the wallet or have a non-archived wallet campaign (edge case 11).
   * Few clients (edge case 15): totals, the low filter and the sort are computed here.
   */
  async list(actor: CurrentUserInfo, query: WalletListQuery): Promise<WalletPage> {
    const clientFilters = (
      column: typeof adWalletEntries.clientId | typeof adCampaigns.clientId,
    ) => {
      const filters: (SQL | undefined)[] = [
        readsAll(actor) ? undefined : this.clients.managedBy(column, actor.id),
      ];
      if (query.search) filters.push(this.clients.nameContains(column, query.search));
      if (query.accountManagerId) {
        filters.push(this.clients.managedBy(column, query.accountManagerId));
      }
      return filters;
    };
    const [depositors, campaigners] = await Promise.all([
      this.db
        .selectDistinct({ clientId: adWalletEntries.clientId })
        .from(adWalletEntries)
        .where(
          and(
            eq(adWalletEntries.kind, 'deposit'),
            isNull(adWalletEntries.voidedAt),
            ...clientFilters(adWalletEntries.clientId),
          ),
        ),
      this.db
        .selectDistinct({ clientId: adCampaigns.clientId })
        .from(adCampaigns)
        .where(
          and(
            eq(adCampaigns.funding, 'wallet'),
            isNull(adCampaigns.archivedAt),
            ...clientFilters(adCampaigns.clientId),
          ),
        ),
    ]);
    const ids = [...new Set([...depositors, ...campaigners].map((row) => row.clientId))];
    if (ids.length === 0)
      return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
    const [clients, totals, wallets] = await Promise.all([
      this.clients.summaries(ids),
      this.balances.totals(this.db, ids),
      this.db.select().from(adWallets).where(inArray(adWallets.clientId, ids)),
    ]);
    const walletOf = new Map(wallets.map((wallet) => [wallet.clientId, wallet]));
    const managers = await this.users.summaries(
      [...clients.values()].map((c) => c.accountManagerId),
    );
    const rows = ids.flatMap((id) => {
      const client = clients.get(id);
      const total = totals.get(id);
      if (!client || !total) return [];
      const threshold = thresholdOf(walletOf.get(id));
      const low = isLowBalance(total.balanceMinor, threshold, total.usesWallet);
      if (query.low && !low) return [];
      return [
        {
          client: { id, name: client.name },
          accountManager: {
            id: client.accountManagerId,
            name: managers.get(client.accountManagerId)?.name ?? '',
          },
          depositedMinor: total.depositedMinor,
          refundedMinor: total.refundedMinor,
          spentMinor: total.spentMinor,
          balanceMinor: total.balanceMinor,
          lowBalanceThresholdMinor: threshold,
          low,
          lastDepositOn: total.lastDepositOn,
        },
      ];
    });
    const direction = query.order === 'desc' ? -1 : 1;
    rows.sort((a, b) => {
      const byClient = a.client.name.localeCompare(b.client.name, 'ar');
      const by = query.sort === 'client' ? byClient : a.balanceMinor - b.balanceMinor || byClient;
      return direction * by || a.client.id.localeCompare(b.client.id);
    });
    const start = (query.page - 1) * query.pageSize;
    return {
      items: rows.slice(start, start + query.pageSize),
      total: rows.length,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Rule 25: 404 outside read access. */
  async get(actor: CurrentUserInfo, clientId: string, query: AdWalletQuery): Promise<AdWallet> {
    if (query.from && query.to && query.from > query.to) {
      throw new CodedException(400, 'INVALID_DATES', 'The period ends before it starts');
    }
    const client = await this.readableClient(this.db, actor, clientId);
    return this.toWallet(this.db, actor, client, query);
  }

  /** Campaign managers covering the client; null turns A11 off (rule 20 clears `low_since`). */
  async setThreshold(
    actor: CurrentUserInfo,
    clientId: string,
    input: UpdateWalletThreshold,
  ): Promise<AdWallet> {
    return this.db.transaction(async (tx) => {
      const client = await this.readableClient(tx, actor, clientId);
      if (!covers(actor, 'campaigns.manage', client)) throw new ForbiddenException();
      const wallet = await this.balances.lock(tx, client.id);
      if (wallet.lowBalanceThresholdMinor !== input.lowBalanceThresholdMinor) {
        const [updated] = await tx
          .update(adWallets)
          .set({
            lowBalanceThresholdMinor: input.lowBalanceThresholdMinor,
            updatedAt: new Date(),
            updatedById: actor.id,
          })
          .where(eq(adWallets.clientId, client.id))
          .returning();
        if (!updated) throw new NotFoundException();
        await recordAudit(tx, {
          actor: actorOf(actor),
          action: 'ad_wallet.threshold_changed',
          entityType: 'ad_wallet',
          entityId: client.id,
          before: {
            clientId: client.id,
            lowBalanceThresholdMinor: wallet.lowBalanceThresholdMinor,
          },
          after: {
            clientId: client.id,
            lowBalanceThresholdMinor: updated.lowBalanceThresholdMinor,
          },
        });
        await this.balances.settle(tx, actorOf(actor), updated, client);
      }
      return this.toWallet(tx, actor, client, {});
    });
  }

  /**
   * Rules 16, 17 and 19 under the wallet lock (edge case 2): the rate, the USD amount, the refund
   * limit, the deposit's receipt number, the proof as a document of the entry, then A11.
   */
  async record(
    actor: CurrentUserInfo,
    clientId: string,
    input: RecordWalletEntry,
  ): Promise<AdWallet> {
    let preview = false;
    const wallet = await this.db.transaction(async (tx) => {
      const client = await this.readableClient(tx, actor, clientId);
      if (!covers(actor, 'campaigns.fund', client)) throw new ForbiddenException();
      // Edge case 9: refunds stay allowed on an archived client, to return what is left.
      if (input.kind === 'deposit' && client.archived) {
        throw new CodedException(409, 'CLIENT_ARCHIVED', 'The client is archived');
      }
      const today = businessDate();
      if (input.occurredOn > today) {
        throw new CodedException(400, 'INVALID_DATES', 'The date is in the future');
      }
      const rate = input.sypPerUsd ?? (await this.numbers.currentRate(tx));
      if (!rate) throw new CodedException(409, 'RATE_REQUIRED', 'No exchange rate is set');
      const usdMinor = toUsdMinor(input.amountMinor, input.currency, rate);
      if (usdMinor === 0) throw new BadRequestException('The amount converts to nothing in USD');
      const locked = await this.balances.lock(tx, client.id);
      if (input.kind === 'refund') {
        const { balanceMinor } = await this.balances.totalsOf(tx, client.id);
        if (usdMinor > balanceMinor) {
          throw new CodedException(409, 'REFUND_EXCEEDS_BALANCE', 'The refund exceeds the balance');
        }
      }
      const year = Number(today.slice(0, 4));
      const number = input.kind === 'deposit' ? await this.numbers.nextAdDeposit(tx, year) : null;
      const [inserted] = await tx
        .insert(adWalletEntries)
        .values({
          clientId: client.id,
          kind: input.kind,
          year: number === null ? null : year,
          number,
          occurredOn: input.occurredOn,
          amountMinor: input.amountMinor,
          currency: input.currency,
          sypPerUsd: rate,
          usdMinor,
          method: input.method,
          reference: input.reference,
          note: input.note,
          recordedById: actor.id,
        })
        .returning();
      if (!inserted) throw new Error('The entry was not recorded');
      let entry = inserted;
      if (input.proofUploadId) {
        const proof = await this.files.attachUpload(tx, actor, {
          ownerType: 'ad_wallet_entry',
          ownerId: entry.id,
          clientId: client.id,
          uploadId: input.proofUploadId,
          namePrefix: receiptNumberOf(entry) ?? undefined,
        });
        preview = proof.preview;
        const [withProof] = await tx
          .update(adWalletEntries)
          .set({ proofFileItemId: proof.itemId })
          .where(eq(adWalletEntries.id, entry.id))
          .returning();
        if (!withProof) throw new Error('The entry was not recorded');
        entry = withProof;
      }
      const after = await this.balances.settle(tx, actorOf(actor), locked, client);
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'ad_wallet_entry.recorded',
        entityType: 'ad_wallet_entry',
        entityId: entry.id,
        after: {
          ...entryIdentity(entry),
          occurredOn: entry.occurredOn,
          amountMinor: entry.amountMinor,
          currency: entry.currency,
          sypPerUsd: entry.sypPerUsd,
          usdMinor: entry.usdMinor,
          method: entry.method,
          balanceAfterMinor: after.balanceMinor,
        },
      });
      return this.toWallet(tx, actor, client, {});
    });
    if (preview) await this.files.queuePreviews();
    return wallet;
  }

  /** Rule 18: an entry recorded by mistake stays visible as void; there is no un-void. */
  async void(actor: CurrentUserInfo, entryId: string, input: VoidWalletEntry): Promise<AdWallet> {
    return this.db.transaction(async (tx) => {
      const [found] = await tx
        .select({ clientId: adWalletEntries.clientId })
        .from(adWalletEntries)
        .where(eq(adWalletEntries.id, entryId));
      if (!found) throw new NotFoundException();
      const client = await this.readableClient(tx, actor, found.clientId);
      if (!covers(actor, 'campaigns.fund', client)) throw new ForbiddenException();
      // The wallet first, as recording does, so the two never wait on each other.
      const locked = await this.balances.lock(tx, client.id);
      const [entry] = await tx
        .select()
        .from(adWalletEntries)
        .where(eq(adWalletEntries.id, entryId))
        .for('update');
      if (!entry) throw new NotFoundException();
      if (entry.voidedAt) {
        throw new CodedException(409, 'INVALID_TRANSITION', 'The entry is already void');
      }
      await tx
        .update(adWalletEntries)
        .set({ voidedAt: new Date(), voidedById: actor.id, voidReason: input.reason })
        .where(eq(adWalletEntries.id, entryId));
      const after = await this.balances.settle(tx, actorOf(actor), locked, client);
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'ad_wallet_entry.voided',
        entityType: 'ad_wallet_entry',
        entityId: entry.id,
        before: { ...entryIdentity(entry), voided: false },
        after: {
          ...entryIdentity(entry),
          voided: true,
          reason: input.reason,
          balanceAfterMinor: after.balanceMinor,
        },
      });
      return this.toWallet(tx, actor, client, {});
    });
  }

  /** 404 when the client is missing or outside the caller's `campaigns.read` (rule 25). */
  private async readableClient(
    executor: Executor,
    actor: CurrentUserInfo,
    clientId: string,
  ): Promise<ClientSummary> {
    const client = await this.clients.summary(clientId, executor);
    if (!client || !covers(actor, 'campaigns.read', client)) throw new NotFoundException();
    return client;
  }

  private async toWallet(
    executor: Executor,
    actor: CurrentUserInfo,
    client: ClientSummary,
    query: AdWalletQuery,
  ): Promise<AdWallet> {
    const wallet = await this.balances.row(executor, client.id);
    const entries = await executor
      .select()
      .from(adWalletEntries)
      .where(eq(adWalletEntries.clientId, client.id))
      .orderBy(desc(adWalletEntries.occurredOn), desc(adWalletEntries.id));
    // Rule 15: the spend of non-archived updates of the client's non-archived wallet campaigns.
    const spends = await executor
      .select({
        id: adCampaignUpdates.id,
        periodStart: adCampaignUpdates.periodStart,
        periodEnd: adCampaignUpdates.periodEnd,
        spendMinor: adCampaignUpdates.spendMinor,
        campaignId: adCampaigns.id,
        campaignName: adCampaigns.name,
      })
      .from(adCampaignUpdates)
      .innerJoin(adCampaigns, eq(adCampaigns.id, adCampaignUpdates.campaignId))
      .where(
        and(
          eq(adCampaigns.clientId, client.id),
          eq(adCampaigns.funding, 'wallet'),
          isNull(adCampaigns.archivedAt),
          isNull(adCampaignUpdates.archivedAt),
        ),
      );
    const people = await this.users.summaries(
      entries.flatMap((entry) => [
        entry.recordedById,
        ...(entry.voidedById ? [entry.voidedById] : []),
      ]),
      executor,
    );
    const proofs = await this.files.names(
      entries.flatMap((entry) => entry.proofFileItemId ?? []),
      executor,
    );
    const person = (id: string) => ({ id, name: people.get(id)?.name ?? '' });
    const live = entries.filter((entry) => !entry.voidedAt);
    const sumOf = (kind: EntryRow['kind']) =>
      live.filter((entry) => entry.kind === kind).reduce((sum, entry) => sum + entry.usdMinor, 0);
    const spentMinor = spends.reduce((sum, spend) => sum + spend.spendMinor, 0);
    const balanceMinor = adWalletBalance(
      entries.map((entry) => ({
        kind: entry.kind,
        usdMinor: entry.usdMinor,
        voided: !!entry.voidedAt,
      })),
      spends.map((spend) => ({
        spendMinor: spend.spendMinor,
        archived: false,
        funding: 'wallet' as const,
        campaignArchived: false,
      })),
    );
    const usesWallet = live.some((entry) => entry.kind === 'deposit');
    const threshold = thresholdOf(wallet);
    const items: (WalletLedgerItem & Omit<WalletLedgerRow, 'balanceMinor'>)[] = [
      ...entries.map((entry) => ({
        kind: entry.kind,
        id: entry.id,
        date: entry.occurredOn,
        usdMinor: entry.usdMinor,
        voided: !!entry.voidedAt,
        entry: {
          receiptNumber: receiptNumberOf(entry),
          amountMinor: entry.amountMinor,
          currency: entry.currency,
        },
        spend: null,
      })),
      ...spends.map((spend) => ({
        kind: 'spend' as const,
        id: spend.id,
        date: spend.periodEnd,
        usdMinor: spend.spendMinor,
        voided: false,
        entry: null,
        spend: {
          campaign: { id: spend.campaignId, name: spend.campaignName },
          periodStart: spend.periodStart,
          periodEnd: spend.periodEnd,
        },
      })),
    ];
    const ledger = walletLedger(items, query);
    const canFund = covers(actor, 'campaigns.fund', client);
    return {
      client: { id: client.id, name: client.name, archived: client.archived },
      depositedMinor: sumOf('deposit'),
      refundedMinor: sumOf('refund'),
      spentMinor,
      balanceMinor,
      lowBalanceThresholdMinor: threshold,
      low: isLowBalance(balanceMinor, threshold, usesWallet),
      usesWallet,
      from: query.from ?? null,
      to: query.to ?? null,
      openingMinor: ledger.openingMinor,
      ledger: ledger.rows,
      entries: entries.map(
        (entry): WalletEntry => ({
          id: entry.id,
          kind: entry.kind,
          receiptNumber: receiptNumberOf(entry),
          occurredOn: entry.occurredOn,
          amountMinor: entry.amountMinor,
          currency: entry.currency,
          sypPerUsd: entry.sypPerUsd,
          usdMinor: entry.usdMinor,
          method: entry.method,
          reference: entry.reference,
          note: entry.note,
          proof: entry.proofFileItemId
            ? { id: entry.proofFileItemId, name: proofs.get(entry.proofFileItemId) ?? '' }
            : null,
          recordedBy: person(entry.recordedById),
          createdAt: entry.createdAt.toISOString(),
          voided:
            entry.voidedAt && entry.voidedById
              ? {
                  at: entry.voidedAt.toISOString(),
                  by: person(entry.voidedById),
                  reason: entry.voidReason ?? '',
                }
              : null,
        }),
      ),
      permissions: {
        canFund,
        canDeposit: canFund && !client.archived,
        canEditThreshold: covers(actor, 'campaigns.manage', client),
      },
    };
  }
}
