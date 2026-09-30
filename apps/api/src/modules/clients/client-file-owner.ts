import { Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { clients, type Database, type Transaction } from '@vertex-hub/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { CurrentUserInfo } from '../auth/index.js';
import { type FileOwner, FileOwnerRegistry, isConfidentialReader } from '../files/index.js';
import { covers, holdsAll, readableClient } from './client-access.js';
import { ClientDirectory } from './client-directory.js';

type Executor = Database | Transaction;

/**
 * The `client` owner policy of the files module (spec F10): brand files and client documents
 * are read under `clients.read` and changed under `clients.manage`, as the brand kit (F02).
 */
@Injectable()
export class ClientFileOwner implements OnModuleInit {
  constructor(
    private readonly registry: FileOwnerRegistry,
    private readonly directory: ClientDirectory,
  ) {}

  onModuleInit(): void {
    this.registry.register('client', {
      find: (executor, actor, id, options) => this.find(executor, actor, id, options),
      ownersOfClient: async (executor, clientId) =>
        executor
          .select({ id: clients.id, label: clients.tradeName })
          .from(clients)
          .where(and(eq(clients.id, clientId), isNull(clients.archivedAt))),
    });
  }

  private async find(
    executor: Executor,
    actor: CurrentUserInfo,
    id: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<FileOwner> {
    const client = await readableClient(executor, actor, id, options);
    const summary = await this.directory.summary(id, executor);
    if (!summary) throw new NotFoundException();
    return {
      type: 'client',
      id,
      clientId: id,
      clientName: summary.name,
      label: summary.name,
      archivedCode: client.archivedAt ? 'CLIENT_ARCHIVED' : null,
      task: null,
      rights: {
        addDeliverable: false,
        addReference: false,
        manageTask: false,
        manageDocuments: covers(actor, 'clients.manage', client),
        confidentialReader: isConfidentialReader(actor, summary),
        scopeAll: holdsAll(actor, 'clients.manage'),
      },
    };
  }
}
