import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  type ClientStatementQuery,
  INVOICES_PDF_JOB,
  INVOICES_PDF_READY_JOB,
  type InvoicePdfJob,
  type InvoicePdfReadyJob,
  invoiceDisplayNumber,
  invoicePdfReadyJobSchema,
  invoiceSnapshotSchema,
  type QuotePdfRender,
  receiptDisplayNumber,
  receiptSnapshotSchema,
} from '@vertex-hub/contracts';
import {
  type Database,
  invoiceLines,
  invoices,
  payments,
  statementPdfs,
  type Transaction,
} from '@vertex-hub/db';
import { and, asc, eq, isNull, lt, ne } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { JobQueue } from '../../core/jobs/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientDirectory, type ClientSummary } from '../clients/index.js';
import { FilePurges, GeneratedFiles } from '../files/index.js';
import { QuoteDirectory } from '../quotes/index.js';
import { canManage, covers } from './invoice-access.js';
import { InvoiceBillingService } from './invoice-billing.service.js';
import { InvoiceSnapshots, invoicePdfHash } from './invoice-snapshots.js';

const PDF_MIME_TYPE = 'application/pdf';

/** Rule 29: a statement PDF can be downloaded for this long after it was asked for. */
const STATEMENT_HOURS = 24;

type InvoiceRow = typeof invoices.$inferSelect;
type PaymentRow = typeof payments.$inferSelect;

// PDF state is not an edit: every update keeps `updated_at`, so the editor's next save is not
// refused as stale.

/**
 * Invoice PDFs (spec F13 rules 15, 20 and 29), as F04's quote PDFs: queues renders for the worker
 * (`invoices.pdf`), takes their results (`invoices.pdf-ready`), and serves the PDF of an issued
 * invoice, the draft preview, a payment's receipt and a client statement.
 */
@Injectable()
export class InvoicePdfService implements OnModuleInit {
  private readonly logger = new Logger(InvoicePdfService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly snapshots: InvoiceSnapshots,
    private readonly billing: InvoiceBillingService,
    private readonly clients: ClientDirectory,
    private readonly quotes: QuoteDirectory,
    private readonly files: GeneratedFiles,
    private readonly purges: FilePurges,
    private readonly jobs: JobQueue,
  ) {}

  onModuleInit(): void {
    this.jobs.work(INVOICES_PDF_READY_JOB.queue, (data) =>
      this.ready(invoicePdfReadyJobSchema.parse(data)),
    );
    this.purges.register('statement PDFs', (now) => this.purgeStatements(now));
  }

  /**
   * "Preview PDF" on a draft (managers), or "Render again" on an issued invoice whose PDF is not
   * ready (any reader). A preview of an unchanged draft is not rendered twice.
   */
  async render(actor: CurrentUserInfo, id: string): Promise<QuotePdfRender> {
    const { state, job } = await this.db.transaction(async (tx) => {
      const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, id)).for('update');
      const client = invoice ? await this.clients.summary(invoice.clientId, tx) : null;
      if (!invoice || !client || !covers(actor, 'invoices.read', client)) {
        throw new NotFoundException();
      }
      if (invoice.status === 'draft') return this.requestPreview(tx, actor, invoice, client);
      if (invoice.pdfStatus === 'ready') return { state: 'ready' as const, job: null };
      await tx
        .update(invoices)
        .set({ pdfStatus: 'pending', updatedAt: invoice.updatedAt })
        .where(eq(invoices.id, id));
      return { state: 'pending' as const, job: issuedJob(invoice) };
    });
    if (job) await this.queue(job);
    return { state };
  }

  /** Rules 9 and 13: queues the PDF of an invoice just issued or re-dated, once committed. */
  async queueIssued(invoice: InvoiceRow): Promise<void> {
    await this.queue(issuedJob(invoice));
  }

  /** Deletes the preview object of a draft that was just issued or discarded. */
  async discardPreview(objectKey: string | null): Promise<void> {
    if (objectKey) await this.removeObject(objectKey);
  }

  /** Rule 20: queues the receipt of a payment just recorded, once committed. */
  async queueReceipt(payment: PaymentRow): Promise<void> {
    await this.queue(receiptJob(payment));
  }

  /** "Render again" on a receipt whose PDF is not ready (any reader of the invoice). */
  async renderReceipt(actor: CurrentUserInfo, paymentId: string): Promise<QuotePdfRender> {
    const { state, job } = await this.db.transaction(async (tx) => {
      const [payment] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, paymentId))
        .for('update');
      if (!payment) throw new NotFoundException();
      await this.readableInvoice(actor, payment.invoiceId, tx);
      if (!payment.receiptSnapshot) throw new NotFoundException();
      if (payment.receiptPdfStatus === 'ready') return { state: 'ready' as const, job: null };
      await tx
        .update(payments)
        .set({ receiptPdfStatus: 'pending' })
        .where(eq(payments.id, paymentId));
      return { state: 'pending' as const, job: receiptJob(payment) };
    });
    if (job) await this.queue(job);
    return { state };
  }

  /**
   * Edge case 12: issued invoices and receipts of non-void payments whose render never came back
   * (the worker or the queue was down) are queued again by the daily run.
   */
  async requeuePending(): Promise<number> {
    const pendingInvoices = await this.db
      .select()
      .from(invoices)
      .where(and(eq(invoices.pdfStatus, 'pending'), ne(invoices.status, 'draft')));
    for (const invoice of pendingInvoices) await this.queueIssued(invoice);
    const pendingReceipts = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.receiptPdfStatus, 'pending'), isNull(payments.voidedAt)));
    for (const payment of pendingReceipts) await this.queueReceipt(payment);
    return pendingInvoices.length + pendingReceipts.length;
  }

  /**
   * Rule 29: a statement PDF of the statement as it is now. A render of the same statement asked
   * for within 24 hours is reused, and its 24 hours start again.
   */
  async requestStatement(
    actor: CurrentUserInfo,
    clientId: string,
    query: ClientStatementQuery,
  ): Promise<QuotePdfRender> {
    const { snapshot, hash } = await this.statementPayload(actor, clientId, query);
    const now = new Date();
    const job = await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(statementPdfs)
        .where(eq(statementPdfs.hash, hash))
        .for('update');
      if (existing?.status === 'ready') {
        await tx
          .update(statementPdfs)
          .set({ requestedAt: now })
          .where(eq(statementPdfs.id, existing.id));
        return null;
      }
      const [row] = await tx
        .insert(statementPdfs)
        .values({ clientId: snapshot.client.id, hash, status: 'pending', requestedAt: now })
        .onConflictDoUpdate({
          target: statementPdfs.hash,
          set: { status: 'pending', requestedAt: now },
        })
        .returning();
      if (!row) throw new Error('The statement render was not recorded');
      return { kind: 'statement' as const, id: row.id, hash, snapshot };
    });
    if (!job) return { state: 'ready' };
    await this.queue(job);
    return { state: 'pending' };
  }

  /**
   * `invoices.pdf-ready`: attaches an invoice's PDF and a receipt once as documents of the
   * invoice (a re-dated invoice's new PDF as the next version of the same document), keeps the
   * latest asked-for draft preview, records a statement render, or records a failure. Results
   * nobody waits for any more are deleted. Safe to run twice.
   */
  async ready(result: InvoicePdfReadyJob): Promise<void> {
    const removals: string[] = [];
    await this.db.transaction(async (tx) => {
      switch (result.kind) {
        case 'invoice_draft':
          return this.previewReady(tx, result, removals);
        case 'invoice':
          return this.invoiceReady(tx, result, removals);
        case 'receipt':
          return this.receiptReady(tx, result, removals);
        case 'statement':
          return this.statementReady(tx, result, removals);
      }
    });
    for (const key of removals) await this.removeObject(key);
  }

  /** The PDF of an issued invoice, or the draft preview with `draft`; 404 until it exists. */
  async serve(
    actor: CurrentUserInfo,
    id: string,
    draft: boolean,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const { invoice, client } = await this.readableInvoice(actor, id);
    if (draft) {
      if (
        invoice.status !== 'draft' ||
        invoice.draftPdfStatus !== 'ready' ||
        !invoice.draftPdfObjectKey
      ) {
        throw new NotFoundException();
      }
      const name = `${client.name} - DRAFT.pdf`;
      await this.files.serve(invoice.draftPdfObjectKey, name, PDF_MIME_TYPE, request, response);
      return;
    }
    const file = invoice.pdfFileItemId ? await this.files.latest(invoice.pdfFileItemId) : null;
    if (!file || !invoice.year || !invoice.number) throw new NotFoundException();
    const name = `${client.name} - ${invoiceDisplayNumber({ year: invoice.year, number: invoice.number })}.pdf`;
    await this.files.serve(file.storageKey, name, file.mimeType, request, response);
  }

  /** A payment's receipt PDF; 404 until it exists, and once the payment is void. */
  async serveReceipt(
    actor: CurrentUserInfo,
    paymentId: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const [payment] = await this.db.select().from(payments).where(eq(payments.id, paymentId));
    if (!payment) throw new NotFoundException();
    const { client } = await this.readableInvoice(actor, payment.invoiceId);
    const file = payment.receiptFileItemId
      ? await this.files.latest(payment.receiptFileItemId)
      : null;
    if (!file) throw new NotFoundException();
    const name = `${client.name} - ${receiptDisplayNumber(payment)}.pdf`;
    await this.files.serve(file.storageKey, name, file.mimeType, request, response);
  }

  /** Rule 29: the statement PDF of the statement as it is now, while it is downloadable. */
  async serveStatement(
    actor: CurrentUserInfo,
    clientId: string,
    query: ClientStatementQuery,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const { snapshot, hash } = await this.statementPayload(actor, clientId, query);
    const [row] = await this.db.select().from(statementPdfs).where(eq(statementPdfs.hash, hash));
    if (
      row?.status !== 'ready' ||
      !row.storageKey ||
      row.requestedAt < statementCutoff(new Date())
    ) {
      throw new NotFoundException();
    }
    const name = `${snapshot.client.name} - Statement ${snapshot.currency} ${snapshot.from} ${snapshot.to}.pdf`;
    await this.files.serve(row.storageKey, name, PDF_MIME_TYPE, request, response);
  }

  /** Rule 29: statement renders older than 24 hours go, with their objects. */
  async purgeStatements(now: Date): Promise<number> {
    const stale = await this.db
      .delete(statementPdfs)
      .where(lt(statementPdfs.requestedAt, statementCutoff(now)))
      .returning({ key: statementPdfs.storageKey });
    for (const { key } of stale) if (key) await this.removeObject(key);
    return stale.length;
  }

  private async requestPreview(
    tx: Transaction,
    actor: CurrentUserInfo,
    invoice: InvoiceRow,
    client: ClientSummary,
  ): Promise<{ state: QuotePdfRender['state']; job: InvoicePdfJob | null }> {
    if (!canManage(actor, client)) throw new ForbiddenException();
    if (invoice.archivedAt) {
      throw new CodedException(409, 'INVALID_TRANSITION', 'A discarded draft is not previewed');
    }
    const lines = await tx
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoice.id))
      .orderBy(asc(invoiceLines.position));
    const snapshot = await this.snapshots.draft(tx, invoice, lines, client);
    const hash = invoicePdfHash('invoice_draft', snapshot);
    if (invoice.draftPdfStatus === 'ready' && invoice.draftPdfHash === hash) {
      return { state: 'ready', job: null };
    }
    // The previous preview stays until the new one replaces it.
    await tx
      .update(invoices)
      .set({
        draftPdfStatus: 'pending',
        draftPdfRequestedHash: hash,
        updatedAt: invoice.updatedAt,
      })
      .where(eq(invoices.id, invoice.id));
    return { state: 'pending', job: { kind: 'invoice_draft', id: invoice.id, hash, snapshot } };
  }

  private async previewReady(
    tx: Transaction,
    result: InvoicePdfReadyJob,
    removals: string[],
  ): Promise<void> {
    const key = result.file?.storageKey ?? null;
    const invoice = await this.lockInvoice(tx, result.id);
    const awaited =
      invoice?.status === 'draft' &&
      !invoice.archivedAt &&
      invoice.draftPdfRequestedHash === result.hash;
    if (!invoice || !awaited) {
      if (key && key !== invoice?.draftPdfObjectKey) removals.push(key);
      return;
    }
    if (!result.file) {
      await tx
        .update(invoices)
        .set({ draftPdfStatus: 'failed', updatedAt: invoice.updatedAt })
        .where(eq(invoices.id, invoice.id));
      return;
    }
    if (invoice.draftPdfObjectKey && invoice.draftPdfObjectKey !== result.file.storageKey) {
      removals.push(invoice.draftPdfObjectKey);
    }
    await tx
      .update(invoices)
      .set({
        draftPdfStatus: 'ready',
        draftPdfObjectKey: result.file.storageKey,
        draftPdfAt: new Date(),
        draftPdfHash: result.hash,
        updatedAt: invoice.updatedAt,
      })
      .where(eq(invoices.id, invoice.id));
  }

  private async invoiceReady(
    tx: Transaction,
    result: InvoicePdfReadyJob,
    removals: string[],
  ): Promise<void> {
    const invoice = await this.lockInvoice(tx, result.id);
    const current =
      invoice?.snapshot && invoice.status !== 'draft'
        ? invoicePdfHash('invoice', invoiceSnapshotSchema.parse(invoice.snapshot))
        : null;
    // A result of an earlier payload (the due date changed since) is not this invoice's PDF.
    if (!invoice || current !== result.hash) {
      await this.dropUnheld(tx, result, removals);
      return;
    }
    if (!result.file) {
      await tx
        .update(invoices)
        .set({ pdfStatus: 'failed', updatedAt: invoice.updatedAt })
        .where(eq(invoices.id, invoice.id));
      return;
    }
    const document = {
      ...result.file,
      mimeType: PDF_MIME_TYPE,
      createdById: invoice.issuedById ?? invoice.createdById ?? '',
    };
    let pdfFileItemId = invoice.pdfFileItemId;
    if (pdfFileItemId) {
      // Rule 13: the PDF rendered again after a due date change is the document's next version.
      await this.files.addDocumentVersion(tx, pdfFileItemId, document);
    } else if (invoice.year && invoice.number) {
      pdfFileItemId = await this.files.attachDocument(tx, {
        ...document,
        ownerType: 'invoice',
        ownerId: invoice.id,
        clientId: invoice.clientId,
        name: `${invoiceDisplayNumber({ year: invoice.year, number: invoice.number })}.pdf`,
      });
    }
    await tx
      .update(invoices)
      .set({ pdfStatus: 'ready', pdfFileItemId, updatedAt: invoice.updatedAt })
      .where(eq(invoices.id, invoice.id));
  }

  private async receiptReady(
    tx: Transaction,
    result: InvoicePdfReadyJob,
    removals: string[],
  ): Promise<void> {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, result.id))
      .for('update');
    const current = payment?.receiptSnapshot
      ? invoicePdfHash('receipt', receiptSnapshotSchema.parse(payment.receiptSnapshot))
      : null;
    if (!payment || current !== result.hash) {
      await this.dropUnheld(tx, result, removals);
      return;
    }
    // Attached once.
    if (payment.receiptFileItemId) return;
    if (!result.file) {
      await tx
        .update(payments)
        .set({ receiptPdfStatus: 'failed' })
        .where(eq(payments.id, payment.id));
      return;
    }
    const [invoice] = await tx
      .select({ clientId: invoices.clientId })
      .from(invoices)
      .where(eq(invoices.id, payment.invoiceId));
    if (!invoice) throw new Error('The invoice of the payment was not found');
    const receiptFileItemId = await this.files.attachDocument(tx, {
      ...result.file,
      mimeType: PDF_MIME_TYPE,
      ownerType: 'invoice',
      ownerId: payment.invoiceId,
      clientId: invoice.clientId,
      name: `${receiptDisplayNumber(payment)}.pdf`,
      createdById: payment.recordedById,
    });
    await tx
      .update(payments)
      .set({ receiptPdfStatus: 'ready', receiptFileItemId })
      .where(eq(payments.id, payment.id));
    // Rule 22: voided while it rendered; its receipt is archived as if it had been there.
    if (payment.voidedAt) await this.files.archiveDocument(tx, receiptFileItemId, null);
  }

  private async statementReady(
    tx: Transaction,
    result: InvoicePdfReadyJob,
    removals: string[],
  ): Promise<void> {
    const [row] = await tx
      .select()
      .from(statementPdfs)
      .where(eq(statementPdfs.id, result.id))
      .for('update');
    const key = result.file?.storageKey ?? null;
    if (!row || row.hash !== result.hash) {
      if (key) removals.push(key);
      return;
    }
    await tx
      .update(statementPdfs)
      .set(
        result.file
          ? {
              status: 'ready',
              storageKey: result.file.storageKey,
              sizeBytes: result.file.sizeBytes,
            }
          : { status: 'failed' },
      )
      .where(eq(statementPdfs.id, row.id));
  }

  /** Deletes a result's object unless a document version already holds it. */
  private async dropUnheld(
    tx: Transaction,
    result: InvoicePdfReadyJob,
    removals: string[],
  ): Promise<void> {
    const key = result.file?.storageKey;
    if (key && !(await this.files.holdsObject(tx, key))) removals.push(key);
  }

  private async lockInvoice(tx: Transaction, id: string): Promise<InvoiceRow | null> {
    const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, id)).for('update');
    return invoice ?? null;
  }

  /** The invoice and its client; 404 outside the caller's read access (rule 32). */
  private async readableInvoice(
    actor: CurrentUserInfo,
    id: string,
    executor: Database | Transaction = this.db,
  ): Promise<{ invoice: InvoiceRow; client: ClientSummary }> {
    const [invoice] = await executor.select().from(invoices).where(eq(invoices.id, id));
    const client = invoice ? await this.clients.summary(invoice.clientId, executor) : null;
    if (!invoice || !client || !covers(actor, 'invoices.read', client)) {
      throw new NotFoundException();
    }
    return { invoice, client };
  }

  /** Rule 28's statement (its access and dates checked there) with the company details. */
  private async statementPayload(
    actor: CurrentUserInfo,
    clientId: string,
    query: ClientStatementQuery,
  ) {
    const statement = await this.billing.statement(actor, clientId, query);
    const snapshot = { ...statement, companyDetails: await this.quotes.companyDetails() };
    return { snapshot, hash: invoicePdfHash('statement', snapshot) };
  }

  private async queue(job: InvoicePdfJob): Promise<void> {
    await this.jobs.send(INVOICES_PDF_JOB.queue, job, { retryLimit: INVOICES_PDF_JOB.retryLimit });
  }

  private async removeObject(key: string): Promise<void> {
    try {
      await this.files.remove(key);
    } catch (error) {
      this.logger.warn(`Could not delete ${key}: ${String(error)}`);
    }
  }
}

/** The render of an issued invoice: its frozen snapshot. */
function issuedJob(invoice: InvoiceRow): InvoicePdfJob {
  const snapshot = invoiceSnapshotSchema.parse(invoice.snapshot);
  return { kind: 'invoice', id: invoice.id, hash: invoicePdfHash('invoice', snapshot), snapshot };
}

/** The render of a payment's receipt: its frozen snapshot. */
function receiptJob(payment: PaymentRow): InvoicePdfJob {
  const snapshot = receiptSnapshotSchema.parse(payment.receiptSnapshot);
  return { kind: 'receipt', id: payment.id, hash: invoicePdfHash('receipt', snapshot), snapshot };
}

const statementCutoff = (now: Date) => new Date(now.getTime() - STATEMENT_HOURS * 3600 * 1000);
