import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  applyPayment,
  businessDate,
  type InvoiceDetail,
  type InvoiceStatus,
  invoiceStatus,
  OPEN_INVOICE_STATUSES,
  type RecordPayment,
  receiptDisplayNumber,
  type VoidPayment,
} from '@vertex-hub/contracts';
import { type Database, invoices, payments, type Transaction } from '@vertex-hub/db';
import { eq } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import type { ClientSummary } from '../clients/index.js';
import { GeneratedFiles } from '../files/index.js';
import { NotificationCenter } from '../notifications/index.js';
import { nextDocumentNumber } from './document-numbers.js';
import { actorOf } from './invoice-access.js';
import { InvoiceOverdueService } from './invoice-overdue.service.js';
import { InvoiceSettingsService } from './invoice-settings.service.js';
import { type InvoiceRow, InvoicesService, identity } from './invoices.service.js';

const OPEN: readonly InvoiceStatus[] = OPEN_INVOICE_STATUSES;

type PaymentRow = typeof payments.$inferSelect;

/** Payments on issued invoices (F13 rules 16–23): record with a receipt number, void. */
@Injectable()
export class PaymentsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly invoices: InvoicesService,
    private readonly settings: InvoiceSettingsService,
    private readonly files: GeneratedFiles,
    private readonly center: NotificationCenter,
    private readonly overdue: InvoiceOverdueService,
  ) {}

  /**
   * Rules 16–20 and 23, under the invoice row lock (edge case 2): the applied amount, the next
   * receipt number, the proof as a document of the invoice, the new paid amount and status.
   */
  async record(
    actor: CurrentUserInfo,
    invoiceId: string,
    input: RecordPayment,
  ): Promise<InvoiceDetail> {
    let preview = false;
    const detail = await this.db.transaction(async (tx) => {
      const { invoice, client } = await this.invoices.lockForChange(
        tx,
        actor,
        invoiceId,
        'payments.manage',
      );
      if (invoice.archivedAt || !OPEN.includes(invoice.status)) {
        throw new CodedException(409, 'INVALID_TRANSITION', 'Only an open invoice takes payments');
      }
      const today = businessDate();
      if (input.paidOn > today) {
        throw new CodedException(400, 'INVALID_DATES', 'The payment date is in the future');
      }
      const rate = input.sypPerUsd ?? (await this.settings.row(tx)).sypPerUsd;
      if (!rate) throw new CodedException(409, 'RATE_REQUIRED', 'No exchange rate is set');
      const applied = applyPayment(
        invoice.totalMinor - invoice.paidMinor,
        input.amountMinor,
        input.currency,
        invoice.currency,
        rate,
      );
      if (applied === null) {
        throw new CodedException(409, 'OVERPAYMENT', 'The payment exceeds the balance');
      }
      if (applied === 0) {
        throw new BadRequestException('The amount converts to nothing in the invoice currency');
      }
      const year = Number(today.slice(0, 4));
      const number = await nextDocumentNumber(tx, 'receipt', year);
      const receipt = receiptDisplayNumber({ year, number });
      const proof = input.proofUploadId
        ? await this.files.attachUpload(tx, actor, {
            ownerType: 'invoice',
            ownerId: invoice.id,
            clientId: invoice.clientId,
            uploadId: input.proofUploadId,
            namePrefix: receipt,
          })
        : null;
      preview = proof?.preview ?? false;
      const [payment] = await tx
        .insert(payments)
        .values({
          invoiceId: invoice.id,
          year,
          number,
          paidOn: input.paidOn,
          amountMinor: input.amountMinor,
          currency: input.currency,
          sypPerUsd: rate,
          appliedMinor: applied,
          method: input.method,
          reference: input.reference,
          note: input.note,
          proofFileItemId: proof?.itemId ?? null,
          recordedById: actor.id,
        })
        .returning();
      if (!payment) throw new Error('The payment was not recorded');
      const updated = await this.setPaid(tx, invoice, invoice.paidMinor + applied, today);
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'payment.recorded',
        entityType: 'payment',
        entityId: payment.id,
        before: { ...paymentIdentity(invoice, payment), status: invoice.status },
        after: {
          ...paymentIdentity(invoice, payment),
          paidOn: payment.paidOn,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          sypPerUsd: payment.sypPerUsd,
          appliedMinor: payment.appliedMinor,
          method: payment.method,
          status: updated.status,
        },
      });
      if (updated.status === 'paid') await this.notifyPaid(tx, actor, updated, client);
      // Recorded on a past-due invoice before the daily job marked it: its readers are alerted.
      if (updated.status === 'overdue' && invoice.status !== 'overdue') {
        await this.overdue.alert(tx, updated, client, today);
      }
      return this.invoices.toDetail(actor, updated, client, tx);
    });
    if (preview) await this.files.queuePreviews();
    return detail;
  }

  /**
   * Rule 22: a payment recorded by mistake. The invoice's paid amount and status are recomputed;
   * the receipt number stays used.
   */
  async void(
    actor: CurrentUserInfo,
    paymentId: string,
    input: VoidPayment,
  ): Promise<InvoiceDetail> {
    return this.db.transaction(async (tx) => {
      const [found] = await tx
        .select({ invoiceId: payments.invoiceId })
        .from(payments)
        .where(eq(payments.id, paymentId));
      if (!found) throw new NotFoundException();
      // The invoice first, as recording does, so the two never wait on each other.
      const { invoice, client } = await this.invoices.lockForChange(
        tx,
        actor,
        found.invoiceId,
        'payments.manage',
      );
      const [payment] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, paymentId))
        .for('update');
      if (!payment) throw new NotFoundException();
      if (payment.voidedAt) {
        throw new CodedException(409, 'INVALID_TRANSITION', 'The payment is already void');
      }
      await tx
        .update(payments)
        .set({ voidedAt: new Date(), voidedById: actor.id, voidReason: input.reason })
        .where(eq(payments.id, paymentId));
      const today = businessDate();
      const updated = await this.setPaid(
        tx,
        invoice,
        invoice.paidMinor - payment.appliedMinor,
        today,
      );
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'payment.voided',
        entityType: 'payment',
        entityId: payment.id,
        before: { ...paymentIdentity(invoice, payment), status: invoice.status },
        after: {
          ...paymentIdentity(invoice, payment),
          status: updated.status,
          reason: input.reason,
        },
      });
      // A paid invoice past its due date becomes overdue again: its readers are alerted (A10).
      if (updated.status === 'overdue' && invoice.status !== 'overdue') {
        await this.overdue.alert(tx, updated, client, today);
      }
      return this.invoices.toDetail(actor, updated, client, tx);
    });
  }

  /** The new paid amount and the status that follows from it (rule 21). */
  private async setPaid(
    tx: Transaction,
    invoice: InvoiceRow,
    paidMinor: number,
    today: string,
  ): Promise<InvoiceRow> {
    const status = invoiceStatus({ ...invoice, paidMinor, today });
    const [updated] = await tx
      .update(invoices)
      .set({ paidMinor, status, updatedAt: new Date() })
      .where(eq(invoices.id, invoice.id))
      .returning();
    if (!updated) throw new Error('The invoice was not updated');
    return updated;
  }

  /** Rule 23: the client's account manager, unless they recorded the payment. */
  private async notifyPaid(
    tx: Transaction,
    actor: CurrentUserInfo,
    invoice: InvoiceRow,
    client: ClientSummary,
  ): Promise<void> {
    await this.center.notify(tx, {
      type: 'invoice_paid',
      recipients: [client.accountManagerId],
      actorId: actor.id,
      subjectId: invoice.id,
      data: { invoice: { displayNumber: identity(invoice).number ?? '', client: client.name } },
    });
  }
}

/** What every payment audit entry carries: the client, the receipt and the invoice numbers. */
const paymentIdentity = (invoice: InvoiceRow, payment: PaymentRow) => ({
  clientId: invoice.clientId,
  number: receiptDisplayNumber(payment),
  invoice: identity(invoice).number,
});
