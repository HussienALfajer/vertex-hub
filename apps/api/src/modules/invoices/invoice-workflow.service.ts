import { Inject, Injectable } from '@nestjs/common';
import {
  addDays,
  businessDate,
  type ChangeInvoiceDueDate,
  type InvoiceDetail,
  type InvoiceSnapshot,
  type IssueInvoice,
  invoiceDisplayNumber,
  invoiceStatus,
  type VoidInvoice,
} from '@vertex-hub/contracts';
import { type Database, invoiceLines, invoices } from '@vertex-hub/db';
import { eq } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { BillingSources } from '../projects/index.js';
import { nextDocumentNumber } from './document-numbers.js';
import { actorOf, assertClientNotArchived } from './invoice-access.js';
import { InvoicePdfService } from './invoice-pdf.service.js';
import { InvoiceSettingsService } from './invoice-settings.service.js';
import { InvoiceSnapshots } from './invoice-snapshots.js';
import { type InvoiceRow, InvoicesService, identity, NO_DRAFT_PDF } from './invoices.service.js';

const OPEN = ['sent', 'partially_paid', 'overdue'];

/** Issued invoices (F13): issue, change the due date, void. */
@Injectable()
export class InvoiceWorkflowService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly invoices: InvoicesService,
    private readonly settings: InvoiceSettingsService,
    private readonly snapshots: InvoiceSnapshots,
    private readonly sources: BillingSources,
    private readonly pdf: InvoicePdfService,
  ) {}

  /**
   * Rules 9–11 and 15: numbers the draft, fixes its rate and due date, freezes what it prints,
   * bills its extra work and queues its PDF; the draft preview goes.
   */
  async issue(actor: CurrentUserInfo, id: string, input: IssueInvoice): Promise<InvoiceDetail> {
    let preview: string | null = null;
    const { detail, row } = await this.db.transaction(async (tx) => {
      const { invoice, client } = await this.invoices.lockForChange(tx, actor, id);
      if (invoice.archivedAt || invoice.status !== 'draft') {
        throw new CodedException(409, 'INVALID_TRANSITION', 'Only a draft is issued');
      }
      if (invoice.updatedAt.getTime() !== new Date(input.updatedAt).getTime()) {
        throw new CodedException(409, 'STALE_INVOICE', 'The draft changed since it was loaded');
      }
      assertClientNotArchived(client);
      const lines = await this.invoices.lines(tx, id);
      if (lines.length === 0 || invoice.totalMinor <= 0) {
        throw new CodedException(409, 'INVOICE_EMPTY', 'An invoice needs lines and a total');
      }
      const settings = await this.settings.row(tx);
      const rate = input.sypPerUsd ?? settings.sypPerUsd;
      if (!rate) throw new CodedException(409, 'RATE_REQUIRED', 'No exchange rate is set');
      const today = businessDate();
      const dueOn = input.dueOn ?? addDays(today, invoice.paymentTermsDays);
      if (dueOn < today) {
        throw new CodedException(400, 'INVALID_DATES', 'The due date is before the issue date');
      }
      const year = Number(today.slice(0, 4));
      const number = await nextDocumentNumber(tx, 'invoice', year);
      const displayNumber = invoiceDisplayNumber({ year, number });
      const snapshot: InvoiceSnapshot = await this.snapshots.issued(tx, invoice, lines, client, {
        displayNumber,
        issuedOn: today,
        dueOn,
      });
      const [issued] = await tx
        .update(invoices)
        .set({
          year,
          number,
          issuedOn: today,
          dueOn,
          sypPerUsd: rate,
          snapshot,
          status: 'sent',
          issuedById: actor.id,
          pdfStatus: 'pending',
          ...NO_DRAFT_PDF,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, id))
        .returning();
      if (!issued) throw new Error('The invoice was not issued');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'invoice.issued',
        entityType: 'invoice',
        entityId: id,
        before: { ...identity(invoice), status: invoice.status },
        after: {
          ...identity(issued),
          status: issued.status,
          totalMinor: issued.totalMinor,
          sypPerUsd: issued.sypPerUsd,
          dueOn,
        },
      });
      await this.sources.setExtraWorkBilling(
        tx,
        lines.flatMap((line) => (line.extraWorkItemId ? [line.extraWorkItemId] : [])),
        'billed',
        displayNumber,
        actorOf(actor),
      );
      preview = invoice.draftPdfObjectKey;
      return { detail: await this.invoices.toDetail(actor, issued, client, tx), row: issued };
    });
    await this.afterRender(row, preview);
    return detail;
  }

  /**
   * Rule 13: a new due date (≥ today) with a reason; the status follows (rule 21) and the PDF is
   * rendered again as the next version of its document.
   */
  async changeDueDate(
    actor: CurrentUserInfo,
    id: string,
    input: ChangeInvoiceDueDate,
  ): Promise<InvoiceDetail> {
    const { detail, row } = await this.db.transaction(async (tx) => {
      const { invoice, client } = await this.invoices.lockForChange(tx, actor, id);
      if (invoice.archivedAt || !OPEN.includes(invoice.status)) {
        throw new CodedException(409, 'INVALID_TRANSITION', 'Only an open invoice');
      }
      const today = businessDate();
      if (input.dueOn < today || (invoice.issuedOn && input.dueOn < invoice.issuedOn)) {
        throw new CodedException(400, 'INVALID_DATES', 'The due date is in the past');
      }
      const status = invoiceStatus({ ...invoice, dueOn: input.dueOn, today });
      const snapshot = invoice.snapshot
        ? { ...(invoice.snapshot as InvoiceSnapshot), dueOn: input.dueOn }
        : null;
      const [updated] = await tx
        .update(invoices)
        .set({ dueOn: input.dueOn, status, snapshot, pdfStatus: 'pending', updatedAt: new Date() })
        .where(eq(invoices.id, id))
        .returning();
      if (!updated) throw new Error('The invoice was not updated');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'invoice.due_date_changed',
        entityType: 'invoice',
        entityId: id,
        before: { ...identity(invoice), dueOn: invoice.dueOn, status: invoice.status },
        after: { ...identity(updated), dueOn: updated.dueOn, status, reason: input.reason },
      });
      return { detail: await this.invoices.toDetail(actor, updated, client, tx), row: updated };
    });
    await this.afterRender(row, null);
    return detail;
  }

  /**
   * Rule 14: a sent or overdue invoice without payments. The number stays used, the sources are
   * released and its extra work returns to `unbilled`.
   */
  async void(actor: CurrentUserInfo, id: string, input: VoidInvoice): Promise<InvoiceDetail> {
    return this.db.transaction(async (tx) => {
      const { invoice, client } = await this.invoices.lockForChange(tx, actor, id);
      // Payments are checked first: a paid or partly paid invoice is voided once they are.
      if (invoice.paidMinor > 0 && invoice.status !== 'void') {
        throw new CodedException(409, 'INVOICE_HAS_PAYMENTS', 'Void its payments first');
      }
      if (invoice.archivedAt || !['sent', 'overdue'].includes(invoice.status)) {
        throw new CodedException(409, 'INVALID_TRANSITION', 'Only a sent or overdue invoice');
      }
      const [voided] = await tx
        .update(invoices)
        .set({
          status: 'void',
          voidedAt: new Date(),
          voidedById: actor.id,
          voidReason: input.reason,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, id))
        .returning();
      if (!voided) throw new Error('The invoice was not voided');
      const released = await tx
        .update(invoiceLines)
        .set({ holdsSource: false })
        .where(eq(invoiceLines.invoiceId, id))
        .returning({ extraWorkItemId: invoiceLines.extraWorkItemId });
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'invoice.voided',
        entityType: 'invoice',
        entityId: id,
        before: { ...identity(invoice), status: invoice.status },
        after: { ...identity(voided), status: voided.status, reason: input.reason },
      });
      await this.sources.setExtraWorkBilling(
        tx,
        released.flatMap((line) => (line.extraWorkItemId ? [line.extraWorkItemId] : [])),
        'unbilled',
        identity(voided).number ?? '',
        actorOf(actor),
      );
      return this.invoices.toDetail(actor, voided, client, tx);
    });
  }

  /** After the commit: queues the issued invoice's PDF and deletes the draft preview it had. */
  private async afterRender(invoice: InvoiceRow, previewKey: string | null): Promise<void> {
    await this.pdf.queueIssued(invoice);
    await this.pdf.discardPreview(previewKey);
  }
}
