import { Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { invoiceDisplayNumber } from '@vertex-hub/contracts';
import { type Database, invoices, type Transaction } from '@vertex-hub/db';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { type ClientOwner, type FileOwner, FileOwnerRegistry } from '../files/index.js';
import { covers, holdsAll } from './invoice-access.js';

type Executor = Database | Transaction;

/**
 * The `invoice` owner policy of the files module (spec F13, "Changes to other tables"): an
 * invoice's documents (payment proofs, and later its PDFs and receipts) are read by the client's
 * invoice readers only and changed by nobody through the file endpoints: the invoice attaches
 * them through `GeneratedFiles`.
 */
@Injectable()
export class InvoiceFileOwner implements OnModuleInit {
  constructor(
    private readonly registry: FileOwnerRegistry,
    private readonly clients: ClientDirectory,
  ) {}

  onModuleInit(): void {
    this.registry.register('invoice', {
      find: (executor, actor, id, options) => this.find(executor, actor, id, options),
      ownersOfClient: (executor, clientId, actor) => this.ownersOfClient(executor, clientId, actor),
    });
  }

  private async find(
    executor: Executor,
    actor: CurrentUserInfo,
    id: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<FileOwner> {
    const query = executor.select().from(invoices).where(eq(invoices.id, id));
    const [invoice] = options.forUpdate ? await query.for('update') : await query;
    const client = invoice ? await this.clients.summary(invoice.clientId, executor) : null;
    if (!invoice || !client || !covers(actor, 'invoices.read', client)) {
      throw new NotFoundException();
    }
    return {
      type: 'invoice',
      id,
      clientId: invoice.clientId,
      clientName: client.name,
      label: label(invoice),
      archivedCode: client.archived ? 'CLIENT_ARCHIVED' : null,
      task: null,
      rights: {
        addDeliverable: false,
        addReference: false,
        manageTask: false,
        // Proofs and PDFs are attached by the invoice only: nobody versions, renames or removes
        // them through the file endpoints.
        manageDocuments: false,
        // Invoice documents are confidential to invoice readers, who see all of them.
        confidentialReader: true,
        scopeAll: holdsAll(actor, 'invoices.manage'),
      },
    };
  }

  /** The client's issued invoices, when `actor` reads its invoices; none otherwise. */
  private async ownersOfClient(
    executor: Executor,
    clientId: string,
    actor: CurrentUserInfo | undefined,
  ): Promise<ClientOwner[]> {
    const client = actor ? await this.clients.summary(clientId, executor) : null;
    if (!actor || !client || !covers(actor, 'invoices.read', client)) return [];
    const rows = await executor
      .select({ id: invoices.id, year: invoices.year, number: invoices.number })
      .from(invoices)
      .where(and(eq(invoices.clientId, clientId), isNotNull(invoices.number)))
      .orderBy(asc(invoices.year), asc(invoices.number));
    return rows.map((row) => ({ id: row.id, label: label(row) }));
  }
}

const label = (row: { year: number | null; number: number | null }) =>
  row.year && row.number ? invoiceDisplayNumber({ year: row.year, number: row.number }) : '';
