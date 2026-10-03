import { Inject, Injectable } from '@nestjs/common';
import {
  addDays,
  businessDate,
  type CalendarDate,
  type InvoiceDraftSnapshot,
  type InvoicePdfKind,
  type InvoiceSnapshot,
  invoiceDisplayNumber,
  type ReceiptSnapshot,
  receiptDisplayNumber,
} from '@vertex-hub/contracts';
import type { Database, payments, Transaction } from '@vertex-hub/db';
import { DATABASE } from '../../core/database/database.module.js';
import { payloadHash } from '../../core/jobs/index.js';
import { ClientDirectory, type ClientSummary } from '../clients/index.js';
import { QuoteDirectory } from '../quotes/index.js';
import { InvoiceSettingsService } from './invoice-settings.service.js';
import type { InvoiceLineRow, InvoiceRow } from './invoices.service.js';

type Executor = Database | Transaction;

type PaymentRow = typeof payments.$inferSelect;

/** Names a render (rules 15, 20 and 29): the same kind and payload, the same PDF. */
export const invoicePdfHash = (kind: InvoicePdfKind, snapshot: object) =>
  payloadHash({ kind, snapshot });

/**
 * The render payloads of invoices and receipts (spec F13 rules 15 and 20): company details from
 * the quote settings, the client's billing details, the invoice settings' payment details and
 * footer, frozen when the invoice is issued or the payment recorded.
 */
@Injectable()
export class InvoiceSnapshots {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly settings: InvoiceSettingsService,
    private readonly clients: ClientDirectory,
    private readonly quotes: QuoteDirectory,
  ) {}

  /** Rule 9: what an issued invoice prints, frozen on issue. */
  async issued(
    executor: Executor,
    invoice: InvoiceRow,
    lines: readonly InvoiceLineRow[],
    client: ClientSummary,
    issue: { displayNumber: string; issuedOn: CalendarDate; dueOn: CalendarDate },
  ): Promise<InvoiceSnapshot> {
    const settings = await this.settings.row(executor);
    const billing = await this.clients.billingDetails(client.id, executor);
    return {
      displayNumber: issue.displayNumber,
      companyDetails: await this.quotes.companyDetails(executor),
      billingName: billing?.name ?? client.name,
      billingAddress: billing?.address ?? null,
      currency: invoice.currency,
      issuedOn: issue.issuedOn,
      dueOn: issue.dueOn,
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
  }

  /** A draft preview: no number, dated as if issued today with the draft's payment terms. */
  async draft(
    executor: Executor,
    invoice: InvoiceRow,
    lines: readonly InvoiceLineRow[],
    client: ClientSummary,
  ): Promise<InvoiceDraftSnapshot> {
    const issuedOn = businessDate();
    const snapshot = await this.issued(executor, invoice, lines, client, {
      displayNumber: '',
      issuedOn,
      dueOn: addDays(issuedOn, invoice.paymentTermsDays),
    });
    return { ...snapshot, displayNumber: null };
  }

  /** Rule 20: the receipt of a payment just recorded on `invoice` (already updated). */
  async receipt(
    executor: Executor,
    invoice: InvoiceRow,
    payment: PaymentRow,
    client: ClientSummary,
  ): Promise<ReceiptSnapshot> {
    const settings = await this.settings.row(executor);
    const billing = await this.clients.billingDetails(client.id, executor);
    return {
      displayNumber: receiptDisplayNumber(payment),
      companyDetails: await this.quotes.companyDetails(executor),
      billingName: billing?.name ?? client.name,
      billingAddress: billing?.address ?? null,
      paidOn: payment.paidOn,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      method: payment.method,
      reference: payment.reference,
      invoiceNumber:
        invoice.year && invoice.number
          ? invoiceDisplayNumber({ year: invoice.year, number: invoice.number })
          : '',
      invoiceCurrency: invoice.currency,
      appliedMinor: payment.appliedMinor,
      balanceAfterMinor: invoice.totalMinor - invoice.paidMinor,
      footer: settings.invoiceFooter,
    };
  }

  /** The current draft preview payload's hash, to tell an outdated preview (as F04 rule 13). */
  async draftHash(
    invoice: InvoiceRow,
    lines: readonly InvoiceLineRow[],
    client: ClientSummary,
    executor: Executor = this.db,
  ): Promise<string> {
    return invoicePdfHash('invoice_draft', await this.draft(executor, invoice, lines, client));
  }
}
