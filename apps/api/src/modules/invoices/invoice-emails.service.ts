import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  businessDate,
  type ClientEmail,
  daysInclusive,
  type EmailHistory,
  type EmailSummary,
  type InvoiceEmail,
  invoiceDisplayNumber,
  receiptDisplayNumber,
  type StatementEmail,
} from '@vertex-hub/contracts';
import { type Database, invoices, newId, payments, type Transaction } from '@vertex-hub/db';
import { eq } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientDirectory, ClientEmails, type ClientSummary } from '../clients/index.js';
import { GeneratedFiles, type StoredObject } from '../files/index.js';
import { actorOf, covers } from './invoice-access.js';
import { InvoicePdfService } from './invoice-pdf.service.js';

const PDF_NOT_READY = () => new CodedException(409, 'PDF_NOT_READY', 'The PDF is not ready yet');

/** The recipients and the text of the dialog, as `ClientEmails` takes them. */
const dialog = (input: ClientEmail) => ({
  recipients: input,
  subject: input.subject,
  message: input.message,
});

const attachment = (fileName: string, file: Omit<StoredObject, 'mimeType'>) => ({
  fileName,
  storageKey: file.storageKey,
  sizeBytes: file.sizeBytes,
  sha256: file.sha256,
});

/**
 * F14 email: an issued invoice, its overdue reminder, a payment's receipt and the client's
 * statement emailed to the client's contacts with their PDFs (rules 18, 20 and 21), and their
 * history. Sending needs `invoices.send` over the client; reading the history `invoices.read`.
 */
@Injectable()
export class InvoiceEmailsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly clientEmails: ClientEmails,
    private readonly files: GeneratedFiles,
    private readonly pdf: InvoicePdfService,
  ) {}

  /** `INVOICE_NOT_ISSUED`, `INVOICE_NOT_OVERDUE`, `PDF_NOT_READY`, then the client email checks. */
  async sendInvoice(
    actor: CurrentUserInfo,
    id: string,
    input: InvoiceEmail,
  ): Promise<EmailSummary> {
    const emailId = await this.db.transaction(async (tx) => {
      const { invoice, client } = await this.sendable(tx, actor, id);
      if (invoice.status === 'draft' || invoice.status === 'void') {
        throw new CodedException(409, 'INVOICE_NOT_ISSUED', 'Only an issued invoice is emailed');
      }
      if (input.kind === 'overdue_reminder' && invoice.status !== 'overdue') {
        throw new CodedException(409, 'INVOICE_NOT_OVERDUE', 'The invoice is not overdue');
      }
      const file =
        invoice.pdfStatus === 'ready' && invoice.pdfFileItemId
          ? await this.files.latest(invoice.pdfFileItemId)
          : null;
      if (!file || !invoice.year || !invoice.number || !invoice.issuedOn || !invoice.dueOn) {
        throw PDF_NOT_READY();
      }
      const number = invoiceDisplayNumber({ year: invoice.year, number: invoice.number });
      const facts = {
        invoice: {
          number,
          issuedOn: invoice.issuedOn,
          dueOn: invoice.dueOn,
          total: { amountMinor: invoice.totalMinor, currency: invoice.currency },
          balance: {
            amountMinor: Math.max(0, invoice.totalMinor - invoice.paidMinor),
            currency: invoice.currency,
          },
        },
      };
      const common = {
        clientId: client.id,
        ...dialog(input),
        attachments: [attachment(`${number}.pdf`, file)],
        record: { type: 'invoice' as const, id },
      };
      const queued =
        input.kind === 'overdue_reminder'
          ? await this.clientEmails.queue(tx, actor, {
              ...common,
              kind: 'client_invoice_reminder',
              data: {
                ...facts,
                daysOverdue: Math.max(1, daysInclusive(invoice.dueOn, businessDate()) - 1),
              },
            })
          : await this.clientEmails.queue(tx, actor, {
              ...common,
              kind: 'client_invoice',
              data: facts,
            });
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'invoice.emailed',
        entityType: 'invoice',
        entityId: id,
        after: { clientId: client.id, number, email: queued.audit },
      });
      return queued.id;
    });
    return this.clientEmails.summary(emailId);
  }

  /** `PAYMENT_VOIDED`, `PDF_NOT_READY`, then the client email checks. */
  async sendReceipt(
    actor: CurrentUserInfo,
    paymentId: string,
    input: ClientEmail,
  ): Promise<EmailSummary> {
    const emailId = await this.db.transaction(async (tx) => {
      const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId));
      if (!payment) throw new NotFoundException();
      const { invoice, client } = await this.sendable(tx, actor, payment.invoiceId);
      if (payment.voidedAt) {
        throw new CodedException(409, 'PAYMENT_VOIDED', 'The payment is void');
      }
      const file =
        payment.receiptPdfStatus === 'ready' && payment.receiptFileItemId
          ? await this.files.latest(payment.receiptFileItemId)
          : null;
      if (!file || !invoice.year || !invoice.number) throw PDF_NOT_READY();
      const number = receiptDisplayNumber(payment);
      const queued = await this.clientEmails.queue(tx, actor, {
        kind: 'client_receipt',
        clientId: client.id,
        ...dialog(input),
        data: {
          invoiceId: invoice.id,
          receipt: {
            number,
            invoiceNumber: invoiceDisplayNumber({ year: invoice.year, number: invoice.number }),
            paidOn: payment.paidOn,
            amount: { amountMinor: payment.amountMinor, currency: payment.currency },
          },
        },
        attachments: [attachment(`${number}.pdf`, file)],
        record: { type: 'payment', id: paymentId },
      });
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'payment.emailed',
        entityType: 'payment',
        entityId: paymentId,
        after: { clientId: client.id, invoiceId: invoice.id, number, email: queued.audit },
      });
      return queued.id;
    });
    return this.clientEmails.summary(emailId);
  }

  /**
   * Rule 21: the statement as it is now, from its ready render (`PDF_NOT_READY` otherwise),
   * copied so the email keeps it after the render is deleted. Audited on the client.
   */
  async sendStatement(
    actor: CurrentUserInfo,
    clientId: string,
    input: StatementEmail,
  ): Promise<EmailSummary> {
    const { statement, storageKey } = await this.pdf.readyStatement(actor, clientId, input);
    const client = await this.clients.summary(clientId);
    if (!client) throw new NotFoundException();
    if (!covers(actor, 'invoices.send', client)) throw new ForbiddenException();
    if (!storageKey) throw PDF_NOT_READY();
    const id = newId();
    const { currency, from, to } = statement;
    const emailId = await this.files.withEmailCopy(storageKey, id, PDF_NOT_READY, (copy) =>
      this.db.transaction(async (tx) => {
        const queued = await this.clientEmails.queue(tx, actor, {
          id,
          kind: 'client_statement',
          clientId,
          ...dialog(input),
          data: {
            statement: { currency, from, to, outstandingMinor: statement.outstandingMinor },
          },
          attachments: [
            attachment(`${client.name} - Statement ${currency} ${from} ${to}.pdf`, copy),
          ],
          record: { type: 'client', id: clientId },
        });
        await recordAudit(tx, {
          actor: actorOf(actor),
          action: 'client.emailed',
          entityType: 'client',
          entityId: clientId,
          after: { statement: { currency, from, to }, email: queued.audit },
        });
        return queued.id;
      }),
    );
    return this.clientEmails.summary(emailId);
  }

  /** Screens 5: the invoice's emails and those of its payments' receipts, newest first. */
  async invoiceHistory(actor: CurrentUserInfo, id: string): Promise<EmailHistory> {
    await this.readable(this.db, actor, id);
    const paid = await this.db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.invoiceId, id));
    return this.clientEmails.history({
      records: [
        { type: 'invoice', id },
        ...paid.map((payment) => ({ type: 'payment' as const, id: payment.id })),
      ],
    });
  }

  /** Screens 5: the client's emailed statements, newest first. */
  async statementHistory(actor: CurrentUserInfo, clientId: string): Promise<EmailHistory> {
    const client = await this.clients.summary(clientId);
    if (!client || !covers(actor, 'invoices.read', client)) throw new NotFoundException();
    return this.clientEmails.history({ clientId, kinds: ['client_statement'] });
  }

  private async readable(executor: Database | Transaction, actor: CurrentUserInfo, id: string) {
    const [invoice] = await executor.select().from(invoices).where(eq(invoices.id, id));
    const client = invoice ? await this.clients.summary(invoice.clientId, executor) : null;
    if (!invoice || !client || !covers(actor, 'invoices.read', client)) {
      throw new NotFoundException();
    }
    return { invoice, client };
  }

  /** 404 outside `invoices.read`, 403 without `invoices.send` over the client. */
  private async sendable(
    tx: Transaction,
    actor: CurrentUserInfo,
    id: string,
  ): Promise<{ invoice: typeof invoices.$inferSelect; client: ClientSummary }> {
    const found = await this.readable(tx, actor, id);
    if (!covers(actor, 'invoices.send', found.client)) throw new ForbiddenException();
    return found;
  }
}
