import { Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { adDepositDisplayNumber } from '@vertex-hub/contracts';
import { adWalletEntries, type Database, type Transaction } from '@vertex-hub/db';
import { eq } from 'drizzle-orm';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { type FileOwner, FileOwnerRegistry } from '../files/index.js';
import { covers } from './campaign-access.js';

type Executor = Database | Transaction;

/**
 * The `ad_wallet_entry` owner policy of the files module (spec F12, "Changes to other tables"):
 * an entry's documents (its proof, and its receipt PDF) are read by the client's campaign readers
 * only and changed by nobody through the file endpoints: the entry attaches them through
 * `GeneratedFiles`. They are listed in neither the client library nor its documents.
 */
@Injectable()
export class AdWalletEntryFileOwner implements OnModuleInit {
  constructor(
    private readonly registry: FileOwnerRegistry,
    private readonly clients: ClientDirectory,
  ) {}

  onModuleInit(): void {
    this.registry.register('ad_wallet_entry', {
      find: (executor, actor, id, options) => this.find(executor, actor, id, options),
      ownersOfClient: async () => [],
    });
  }

  private async find(
    executor: Executor,
    actor: CurrentUserInfo,
    id: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<FileOwner> {
    const query = executor.select().from(adWalletEntries).where(eq(adWalletEntries.id, id));
    const [entry] = options.forUpdate ? await query.for('update') : await query;
    const client = entry ? await this.clients.summary(entry.clientId, executor) : null;
    if (!entry || !client || !covers(actor, 'campaigns.read', client)) {
      throw new NotFoundException();
    }
    return {
      type: 'ad_wallet_entry',
      id,
      clientId: entry.clientId,
      clientName: client.name,
      label:
        entry.year && entry.number
          ? adDepositDisplayNumber({ year: entry.year, number: entry.number })
          : '',
      archivedCode: client.archived ? 'CLIENT_ARCHIVED' : null,
      task: null,
      rights: {
        addDeliverable: false,
        addReference: false,
        manageTask: false,
        // Proofs and receipts are attached by the entry only, and closed once it is void.
        manageDocuments: false,
        // Entry documents are for campaign readers, who see all of them.
        confidentialReader: true,
        scopeAll: false,
      },
    };
  }
}
