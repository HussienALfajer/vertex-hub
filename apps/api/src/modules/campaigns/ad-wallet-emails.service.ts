import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  adDepositDisplayNumber,
  CAMPAIGN_LIMITS,
  type ClientEmail,
  type EmailHistory,
  type EmailSummary,
  isLowBalance,
} from '@vertex-hub/contracts';
import { adWalletEntries, type Database, type Transaction } from '@vertex-hub/db';
import { eq } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientDirectory, ClientEmails, type ClientSummary } from '../clients/index.js';
import { GeneratedFiles } from '../files/index.js';
import { AdWalletBalances } from './ad-wallet-balances.js';
import { actorOf, covers } from './campaign-access.js';

/**
 * F14 email: an ad deposit's receipt and the low-balance notice emailed to the client's contacts
 * (rule 18), and their history. Sending needs `campaigns.fund`, or `campaigns.manage` over the
 * client; reading the history `campaigns.read`.
 */
@Injectable()
export class AdWalletEmailsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly clientEmails: ClientEmails,
    private readonly files: GeneratedFiles,
    private readonly balances: AdWalletBalances,
  ) {}

  /** `ENTRY_VOIDED`, `PDF_NOT_READY`, then the client email checks; a refund is a 404. */
  async sendReceipt(
    actor: CurrentUserInfo,
    entryId: string,
    input: ClientEmail,
  ): Promise<EmailSummary> {
    const emailId = await this.db.transaction(async (tx) => {
      const [entry] = await tx
        .select()
        .from(adWalletEntries)
        .where(eq(adWalletEntries.id, entryId));
      if (entry?.kind !== 'deposit' || entry.year === null || entry.number === null) {
        throw new NotFoundException();
      }
      const client = await this.sendable(tx, actor, entry.clientId);
      if (entry.voidedAt) {
        throw new CodedException(409, 'ENTRY_VOIDED', 'The deposit is void');
      }
      const file =
        entry.receiptPdfStatus === 'ready' && entry.receiptFileItemId
          ? await this.files.latest(entry.receiptFileItemId)
          : null;
      if (!file) throw new CodedException(409, 'PDF_NOT_READY', 'The PDF is not ready yet');
      const number = adDepositDisplayNumber({ year: entry.year, number: entry.number });
      const queued = await this.clientEmails.queue(tx, actor, {
        kind: 'client_ad_receipt',
        clientId: client.id,
        recipients: input,
        subject: input.subject,
        message: input.message,
        data: {
          receipt: {
            number,
            occurredOn: entry.occurredOn,
            amount: { amountMinor: entry.amountMinor, currency: entry.currency },
          },
        },
        attachments: [
          {
            fileName: `${number}.pdf`,
            storageKey: file.storageKey,
            sizeBytes: file.sizeBytes,
            sha256: file.sha256,
          },
        ],
        record: { type: 'ad_wallet_entry', id: entryId },
      });
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'ad_wallet_entry.emailed',
        entityType: 'ad_wallet_entry',
        entityId: entryId,
        after: { clientId: client.id, number, email: queued.audit },
      });
      return queued.id;
    });
    return this.clientEmails.summary(emailId);
  }

  /** F12 rule 20: only while the wallet is below its threshold (`BUDGET_NOT_LOW`). */
  async sendBudgetLow(
    actor: CurrentUserInfo,
    clientId: string,
    input: ClientEmail,
  ): Promise<EmailSummary> {
    const emailId = await this.db.transaction(async (tx) => {
      const client = await this.sendable(tx, actor, clientId);
      const [totals, wallet] = await Promise.all([
        this.balances.totalsOf(tx, clientId),
        this.balances.row(tx, clientId),
      ]);
      const thresholdMinor = wallet
        ? wallet.lowBalanceThresholdMinor
        : CAMPAIGN_LIMITS.lowBalanceThresholdMinor;
      if (
        thresholdMinor === null ||
        !isLowBalance(totals.balanceMinor, thresholdMinor, totals.usesWallet)
      ) {
        throw new CodedException(409, 'BUDGET_NOT_LOW', 'The wallet is not below its threshold');
      }
      const queued = await this.clientEmails.queue(tx, actor, {
        kind: 'client_ad_budget_low',
        clientId,
        recipients: input,
        subject: input.subject,
        message: input.message,
        data: { balanceMinor: totals.balanceMinor, thresholdMinor },
        record: { type: 'client', id: clientId },
      });
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'client.emailed',
        entityType: 'client',
        entityId: client.id,
        after: { balanceMinor: totals.balanceMinor, thresholdMinor, email: queued.audit },
      });
      return queued.id;
    });
    return this.clientEmails.summary(emailId);
  }

  /** Screens 5: the client's ad receipts and budget notices, newest first. */
  async history(actor: CurrentUserInfo, clientId: string): Promise<EmailHistory> {
    await this.readable(this.db, actor, clientId);
    return this.clientEmails.history({
      clientId,
      kinds: ['client_ad_receipt', 'client_ad_budget_low'],
    });
  }

  /** 404 outside `campaigns.read` (F12 rule 25). */
  private async readable(
    executor: Database | Transaction,
    actor: CurrentUserInfo,
    clientId: string,
  ): Promise<ClientSummary> {
    const client = await this.clients.summary(clientId, executor);
    if (!client || !covers(actor, 'campaigns.read', client)) throw new NotFoundException();
    return client;
  }

  /** Then 403 without `campaigns.fund` or `campaigns.manage` over the client. */
  private async sendable(
    tx: Transaction,
    actor: CurrentUserInfo,
    clientId: string,
  ): Promise<ClientSummary> {
    const client = await this.readable(tx, actor, clientId);
    if (!covers(actor, 'campaigns.fund', client) && !covers(actor, 'campaigns.manage', client)) {
      throw new ForbiddenException();
    }
    return client;
  }
}
