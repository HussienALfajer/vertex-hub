import { Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { quoteDisplayNumber } from '@vertex-hub/contracts';
import { type Database, quotes, type Transaction } from '@vertex-hub/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { type ClientOwner, type FileOwner, FileOwnerRegistry } from '../files/index.js';
import { canRead, covers, holdsAll } from './quote-access.js';

type Executor = Database | Transaction;

/**
 * The `quote` owner policy of the files module (spec F04, "Changes to other modules"): a quote's
 * documents, the PDFs of its sent versions, are read by the client's quote readers only and
 * changed by nobody: the quote attaches them through `GeneratedFiles`.
 */
@Injectable()
export class QuoteFileOwner implements OnModuleInit {
  constructor(
    private readonly registry: FileOwnerRegistry,
    private readonly clients: ClientDirectory,
  ) {}

  onModuleInit(): void {
    this.registry.register('quote', {
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
    const query = executor.select().from(quotes).where(eq(quotes.id, id));
    const [quote] = options.forUpdate ? await query.for('update') : await query;
    const client = quote ? await this.clients.summary(quote.clientId, executor) : null;
    if (!quote || !client || !canRead(actor, client, quote)) throw new NotFoundException();
    return {
      type: 'quote',
      id,
      clientId: quote.clientId,
      clientName: client.name,
      label: quoteDisplayNumber(quote),
      archivedCode: client.archived ? 'CLIENT_ARCHIVED' : quote.archivedAt ? 'QUOTE_LOCKED' : null,
      task: null,
      rights: {
        addDeliverable: false,
        addReference: false,
        manageTask: false,
        // The frozen PDFs are attached by the system only: nobody versions, renames or removes
        // them through the file endpoints (rule 12).
        manageDocuments: false,
        // Quote documents are confidential to quote readers, who see all of them.
        confidentialReader: true,
        scopeAll: holdsAll(actor, 'quotes.manage'),
      },
    };
  }

  /** The client's live quotes, when `actor` reads its quotes; none otherwise. */
  private async ownersOfClient(
    executor: Executor,
    clientId: string,
    actor: CurrentUserInfo | undefined,
  ): Promise<ClientOwner[]> {
    const client = actor ? await this.clients.summary(clientId, executor) : null;
    if (!actor || !client || !covers(actor, 'quotes.read', client)) return [];
    const rows = await executor
      .select({
        id: quotes.id,
        year: quotes.year,
        number: quotes.number,
        version: quotes.version,
      })
      .from(quotes)
      .where(and(eq(quotes.clientId, clientId), isNull(quotes.archivedAt)))
      .orderBy(asc(quotes.year), asc(quotes.number), asc(quotes.version));
    return rows.map((row) => ({ id: row.id, label: quoteDisplayNumber(row) }));
  }
}
