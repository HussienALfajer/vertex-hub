import { Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import {
  type Database,
  projects,
  retainerContracts,
  retainers,
  type Transaction,
} from '@vertex-hub/db';
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import {
  type ClientOwner,
  type FileOwner,
  FileOwnerRegistry,
  isConfidentialReader,
} from '../files/index.js';
import { canWork, coversClient, holdsAll, readableProject, seesMoney } from './project-access.js';
import { readableRetainer } from './retainer-access.js';

type Executor = Database | Transaction;

/**
 * The `project`, `retainer` and `retainer_contract` owner policies of the files module (spec
 * F10): documents are read under `projects.read`; project documents are changed by client scope
 * and the project manager, retainer documents by client scope only (F05). A contract's documents
 * (its PDFs, annex PDFs and signed copies, F05C) are read by contract readers, who hold money
 * access, and changed by nobody through the file endpoints: the contract attaches them.
 */
@Injectable()
export class EngagementFileOwners implements OnModuleInit {
  constructor(
    private readonly registry: FileOwnerRegistry,
    private readonly clients: ClientDirectory,
  ) {}

  onModuleInit(): void {
    this.registry.register('project', {
      find: (executor, actor, id, options) => this.project(executor, actor, id, options),
      ownersOfClient: (executor, clientId) =>
        executor
          .select({ id: projects.id, label: projects.name })
          .from(projects)
          .where(and(eq(projects.clientId, clientId), isNull(projects.archivedAt)))
          .orderBy(asc(projects.id)),
    });
    this.registry.register('retainer', {
      find: (executor, actor, id, options) => this.retainer(executor, actor, id, options),
      ownersOfClient: (executor, clientId) =>
        executor
          .select({ id: retainers.id, label: retainers.name })
          .from(retainers)
          .where(and(eq(retainers.clientId, clientId), isNull(retainers.archivedAt)))
          .orderBy(asc(retainers.id)),
    });
    this.registry.register('retainer_contract', {
      find: (executor, actor, id, options) => this.contract(executor, actor, id, options),
      ownersOfClient: (executor, clientId, actor) =>
        this.contractsOfClient(executor, clientId, actor),
    });
  }

  private async project(
    executor: Executor,
    actor: CurrentUserInfo,
    id: string,
    options?: { forUpdate?: boolean },
  ): Promise<FileOwner> {
    const project = await readableProject(executor, this.clients, actor, id, options);
    return {
      type: 'project',
      id,
      clientId: project.clientId,
      clientName: project.client.name,
      label: project.name,
      archivedCode: project.archivedAt
        ? 'PROJECT_ARCHIVED'
        : project.client.archived
          ? 'CLIENT_ARCHIVED'
          : null,
      task: null,
      rights: {
        addDeliverable: false,
        addReference: false,
        manageTask: false,
        manageDocuments: canWork(actor, project),
        confidentialReader: isConfidentialReader(actor, project.client),
        scopeAll: holdsAll(actor, 'projects.manage'),
      },
    };
  }

  private async retainer(
    executor: Executor,
    actor: CurrentUserInfo,
    id: string,
    options?: { forUpdate?: boolean },
  ): Promise<FileOwner> {
    const retainer = await readableRetainer(executor, this.clients, actor, id, options);
    return {
      type: 'retainer',
      id,
      clientId: retainer.clientId,
      clientName: retainer.client.name,
      label: retainer.name,
      archivedCode: retainer.archivedAt
        ? 'RETAINER_ARCHIVED'
        : retainer.client.archived
          ? 'CLIENT_ARCHIVED'
          : null,
      task: null,
      rights: {
        addDeliverable: false,
        addReference: false,
        manageTask: false,
        manageDocuments: coversClient(actor, retainer.client),
        confidentialReader: isConfidentialReader(actor, retainer.client),
        scopeAll: holdsAll(actor, 'projects.manage'),
      },
    };
  }

  private async contract(
    executor: Executor,
    actor: CurrentUserInfo,
    id: string,
    options?: { forUpdate?: boolean },
  ): Promise<FileOwner> {
    const query = executor
      .select({
        retainerId: retainerContracts.retainerId,
        number: retainerContracts.number,
      })
      .from(retainerContracts)
      .where(eq(retainerContracts.id, id));
    const [contract] = options?.forUpdate ? await query.for('update') : await query;
    if (!contract) throw new NotFoundException();
    const retainer = await readableRetainer(executor, this.clients, actor, contract.retainerId);
    if (!seesMoney(actor, retainer.client)) throw new NotFoundException();
    return {
      type: 'retainer_contract',
      id,
      clientId: retainer.clientId,
      clientName: retainer.client.name,
      label: contract.number ?? retainer.name,
      archivedCode: retainer.archivedAt
        ? 'RETAINER_ARCHIVED'
        : retainer.client.archived
          ? 'CLIENT_ARCHIVED'
          : null,
      task: null,
      rights: {
        addDeliverable: false,
        addReference: false,
        manageTask: false,
        // PDFs and signed copies are attached by the contract only.
        manageDocuments: false,
        // Contract documents are for contract readers, who see all of them.
        confidentialReader: true,
        scopeAll: holdsAll(actor, 'projects.manage'),
      },
    };
  }

  /** The client's numbered contracts, when `actor` reads its money; none otherwise. */
  private async contractsOfClient(
    executor: Executor,
    clientId: string,
    actor: CurrentUserInfo | undefined,
  ): Promise<ClientOwner[]> {
    const client = actor ? await this.clients.summary(clientId, executor) : null;
    if (!actor || !client || !seesMoney(actor, client)) return [];
    const rows = await executor
      .select({ id: retainerContracts.id, number: retainerContracts.number })
      .from(retainerContracts)
      .innerJoin(retainers, eq(retainers.id, retainerContracts.retainerId))
      .where(and(eq(retainers.clientId, clientId), isNotNull(retainerContracts.number)))
      .orderBy(asc(retainerContracts.number));
    return rows.map((row) => ({ id: row.id, label: row.number ?? '' }));
  }
}
