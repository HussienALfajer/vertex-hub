import type { IncomingMessage, ServerResponse } from 'node:http';
import { Inject, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import {
  type AdDepositReceiptSnapshot,
  adDepositDisplayNumber,
  adDepositReceiptSnapshotSchema,
  CAMPAIGNS_PDF_JOB,
  CAMPAIGNS_PDF_READY_JOB,
  type CampaignPdfJob,
  type CampaignPdfReadyJob,
  campaignPdfReadyJobSchema,
  type QuotePdfRender,
} from '@vertex-hub/contracts';
import { adWalletEntries, type Database, type Transaction } from '@vertex-hub/db';
import { eq } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { JobQueue, payloadHash } from '../../core/jobs/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientDirectory, type ClientSummary } from '../clients/index.js';
import { GeneratedFiles } from '../files/index.js';
import { QuoteDirectory } from '../quotes/index.js';
import { covers } from './campaign-access.js';

const PDF_MIME_TYPE = 'application/pdf';

const KIND = 'ad_deposit_receipt' as const;

type EntryRow = typeof adWalletEntries.$inferSelect;

const receiptHash = (snapshot: AdDepositReceiptSnapshot) => payloadHash({ kind: KIND, snapshot });

/** A deposit with its number: the only entries that have a receipt. */
type NumberedDeposit = EntryRow & { year: number; number: number };

const isNumberedDeposit = (entry: EntryRow): entry is NumberedDeposit =>
  entry.kind === 'deposit' && entry.year !== null && entry.number !== null;

/**
 * Ad budget deposit receipts (spec F12 rule 19), as F13's payment receipts: the frozen payload
 * taken when the deposit is recorded, the render queued for the worker (`campaigns.pdf`), its
 * result attached once as a document of the entry (`campaigns.pdf-ready`), "Render again", and
 * the PDF served to the client's campaign readers. The handler writes no audit entry (rule 24).
 */
@Injectable()
export class AdReceiptsService implements OnModuleInit {
  private readonly logger = new Logger(AdReceiptsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly quotes: QuoteDirectory,
    private readonly files: GeneratedFiles,
    private readonly jobs: JobQueue,
  ) {}

  onModuleInit(): void {
    this.jobs.work(CAMPAIGNS_PDF_READY_JOB.queue, (data) =>
      this.ready(campaignPdfReadyJobSchema.parse(data)),
    );
  }

  /** Rule 19: freezes the receipt of a deposit just recorded, with the balance right after it. */
  async freeze(
    tx: Transaction,
    entry: EntryRow,
    client: ClientSummary,
    balanceAfterMinor: number,
  ): Promise<EntryRow> {
    if (!isNumberedDeposit(entry)) return entry;
    const billing = await this.clients.billingDetails(client.id, tx);
    const snapshot: AdDepositReceiptSnapshot = {
      displayNumber: adDepositDisplayNumber(entry),
      companyDetails: await this.quotes.companyDetails(tx),
      billingName: billing?.name ?? client.name,
      receivedOn: entry.occurredOn,
      amountMinor: entry.amountMinor,
      currency: entry.currency,
      conversion:
        entry.currency === 'USD' ? null : { sypPerUsd: entry.sypPerUsd, usdMinor: entry.usdMinor },
      method: entry.method,
      reference: entry.reference,
      balanceAfterMinor,
    };
    const [frozen] = await tx
      .update(adWalletEntries)
      .set({ receiptSnapshot: snapshot, receiptPdfStatus: 'pending' })
      .where(eq(adWalletEntries.id, entry.id))
      .returning();
    if (!frozen) throw new Error('The receipt was not recorded');
    return frozen;
  }

  /** Queues the receipt of a deposit just recorded, once committed. */
  async queue(entry: EntryRow): Promise<void> {
    const job = receiptJob(entry);
    if (job) await this.send(job);
  }

  /** Rule 18: a voided deposit's receipt document is archived, as the void's actor. */
  async archive(tx: Transaction, entry: EntryRow, actor: { id: string; name: string }) {
    if (entry.receiptFileItemId) {
      await this.files.archiveDocument(tx, entry.receiptFileItemId, actor);
    }
  }

  /**
   * "Render again" on a receipt whose PDF is not ready (any campaign reader of the client). A
   * refund has no receipt, and a void deposit's receipt is archived: both `INVALID_TRANSITION`.
   */
  async render(actor: CurrentUserInfo, entryId: string): Promise<QuotePdfRender> {
    const { state, job } = await this.db.transaction(async (tx) => {
      const [entry] = await tx
        .select()
        .from(adWalletEntries)
        .where(eq(adWalletEntries.id, entryId))
        .for('update');
      if (!entry) throw new NotFoundException();
      await this.readableClient(tx, actor, entry.clientId);
      if (entry.kind !== 'deposit' || entry.voidedAt) {
        throw new CodedException(409, 'INVALID_TRANSITION', 'Only a live deposit has a receipt');
      }
      const pending = receiptJob(entry);
      // A deposit recorded before receipts were rendered has none.
      if (!pending) throw new NotFoundException();
      if (entry.receiptPdfStatus === 'ready') return { state: 'ready' as const, job: null };
      await tx
        .update(adWalletEntries)
        .set({ receiptPdfStatus: 'pending' })
        .where(eq(adWalletEntries.id, entryId));
      return { state: 'pending' as const, job: pending };
    });
    if (job) await this.send(job);
    return { state };
  }

  /**
   * `campaigns.pdf-ready`: attaches the receipt once as a document of the entry, or records a
   * failure. A result that is not the entry's current payload is deleted unless a document holds
   * it. Safe to run twice.
   */
  async ready(result: CampaignPdfReadyJob): Promise<void> {
    const removals: string[] = [];
    await this.db.transaction(async (tx) => {
      const [entry] = await tx
        .select()
        .from(adWalletEntries)
        .where(eq(adWalletEntries.id, result.id))
        .for('update');
      const current = entry ? receiptJob(entry)?.hash : null;
      if (!entry || !isNumberedDeposit(entry) || current !== result.hash) {
        const key = result.file?.storageKey;
        if (key && !(await this.files.holdsObject(tx, key))) removals.push(key);
        return;
      }
      // Attached once.
      if (entry.receiptFileItemId) return;
      if (!result.file) {
        await tx
          .update(adWalletEntries)
          .set({ receiptPdfStatus: 'failed' })
          .where(eq(adWalletEntries.id, entry.id));
        return;
      }
      const receiptFileItemId = await this.files.attachDocument(tx, {
        ...result.file,
        mimeType: PDF_MIME_TYPE,
        ownerType: 'ad_wallet_entry',
        ownerId: entry.id,
        clientId: entry.clientId,
        name: `${adDepositDisplayNumber(entry)}.pdf`,
        createdById: entry.recordedById,
      });
      await tx
        .update(adWalletEntries)
        .set({ receiptPdfStatus: 'ready', receiptFileItemId })
        .where(eq(adWalletEntries.id, entry.id));
      // Rule 18: voided while it rendered; its receipt is archived as if it had been there.
      if (entry.voidedAt) await this.files.archiveDocument(tx, receiptFileItemId, null);
    });
    for (const key of removals) await this.removeObject(key);
  }

  /** The receipt PDF; 404 for a refund, until it is ready, and once the deposit is void. */
  async serve(
    actor: CurrentUserInfo,
    entryId: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const [entry] = await this.db
      .select()
      .from(adWalletEntries)
      .where(eq(adWalletEntries.id, entryId));
    if (!entry) throw new NotFoundException();
    const client = await this.readableClient(this.db, actor, entry.clientId);
    const file = entry.receiptFileItemId ? await this.files.latest(entry.receiptFileItemId) : null;
    if (!file || !isNumberedDeposit(entry)) throw new NotFoundException();
    const name = `${client.name} - ${adDepositDisplayNumber(entry)}.pdf`;
    await this.files.serve(file.storageKey, name, file.mimeType, request, response);
  }

  /** 404 when the client is missing or outside the caller's `campaigns.read` (rule 25). */
  private async readableClient(
    executor: Database | Transaction,
    actor: CurrentUserInfo,
    clientId: string,
  ): Promise<ClientSummary> {
    const client = await this.clients.summary(clientId, executor);
    if (!client || !covers(actor, 'campaigns.read', client)) throw new NotFoundException();
    return client;
  }

  private async send(job: CampaignPdfJob): Promise<void> {
    await this.jobs.send(CAMPAIGNS_PDF_JOB.queue, job, {
      retryLimit: CAMPAIGNS_PDF_JOB.retryLimit,
    });
  }

  private async removeObject(key: string): Promise<void> {
    try {
      await this.files.remove(key);
    } catch (error) {
      this.logger.warn(`Could not delete ${key}: ${String(error)}`);
    }
  }
}

/** The render of a deposit's receipt: its frozen snapshot; null when it has none. */
function receiptJob(entry: EntryRow): CampaignPdfJob | null {
  if (!entry.receiptSnapshot) return null;
  const snapshot = adDepositReceiptSnapshotSchema.parse(entry.receiptSnapshot);
  return { kind: KIND, id: entry.id, hash: receiptHash(snapshot), snapshot };
}
