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
import {
  type Database,
  documentNumbers,
  invoiceLines,
  invoices,
  type Transaction,
} from '@vertex-hub/db';
import { eq, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { BillingSources } from '../projects/index.js';
import { QuoteDirectory } from '../quotes/index.js';
import { actorOf, assertClientNotArchived } from './invoice-access.js';
import { InvoiceSettingsService } from './invoice-settings.service.js';
import { InvoicesService, identity } from './invoices.service.js';

const OPEN = ['sent', 'partially_paid', 'overdue'];

/** Issued invoices (F13): issue, change the due date, void. */
@Injectable()
export class InvoiceWorkflowService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly invoices: InvoicesService,
    private readonly settings: InvoiceSettingsService,
    private readonly clients: ClientDirectory,
    private readonly quotes: QuoteDirectory,
    private readonly sources: BillingSources,
  ) {}

  /**
   * Rules 9–11: numbers the draft, fixes its rate and due date, freezes what it prints and bills
   * its extra work.
   */
  async issue(actor: CurrentUserInfo, id: string, input: IssueInvoice): Promise<InvoiceDetail> {
    return this.db.transaction(async (tx) => {
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
      const number = await this.nextNumber(tx, year);
      const displayNumber = invoiceDisplayNumber({ year, number });
      const billing = await this.clients.billingDetails(client.id, tx);
      const snapshot: InvoiceSnapshot = {
        displayNumber,
        companyDetails: await this.quotes.companyDetails(tx),
        billingName: billing?.name ?? client.name,
        billingAddress: billing?.address ?? null,
        currency: invoice.currency,
        issuedOn: today,
        dueOn,
        lines: lines.map((line) => ({
          description: line.description,
          quantity: line.quantity,
          unitPriceMinor: line.unitPriceMinor,
          totalMinor: line.quantity * line.unitPriceMinor,
        })),
        totalMinor: invoice.totalMinor,
        notes: invoice.notes,
        paymentDetails: settings.paymentDetails,
        footer: settings.invoiceFooter,
      };
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
      return this.invoices.toDetail(actor, issued, client, tx);
    });
  }

  /** Rule 13: a new due date (≥ today) with a reason; the status follows (rule 21). */
  async changeDueDate(
    actor: CurrentUserInfo,
    id: string,
    input: ChangeInvoiceDueDate,
  ): Promise<InvoiceDetail> {
    return this.db.transaction(async (tx) => {
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
        .set({ dueOn: input.dueOn, status, snapshot, updatedAt: new Date() })
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
      return this.invoices.toDetail(actor, updated, client, tx);
    });
  }

  /**
   * Rule 14: a sent or overdue invoice without payments. The number stays used, the sources are
   * released and its extra work returns to `unbilled`.
   */
  async void(actor: CurrentUserInfo, id: string, input: VoidInvoice): Promise<InvoiceDetail> {
    return this.db.transaction(async (tx) => {
      const { invoice, client } = await this.invoices.lockForChange(tx, actor, id);
      if (invoice.archivedAt || !['sent', 'overdue'].includes(invoice.status)) {
        throw new CodedException(409, 'INVALID_TRANSITION', 'Only a sent or overdue invoice');
      }
      if (invoice.paidMinor > 0) {
        throw new CodedException(409, 'INVOICE_HAS_PAYMENTS', 'Void its payments first');
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

  /** The counter row of the kind and year is locked by the upsert until the transaction ends. */
  private async nextNumber(tx: Transaction, year: number): Promise<number> {
    const [row] = await tx
      .insert(documentNumbers)
      .values({ kind: 'invoice', year, lastNumber: 1 })
      .onConflictDoUpdate({
        target: [documentNumbers.kind, documentNumbers.year],
        set: { lastNumber: sql`${documentNumbers.lastNumber} + 1` },
      })
      .returning({ lastNumber: documentNumbers.lastNumber });
    if (!row) throw new Error('No invoice number');
    return row.lastNumber;
  }
}
