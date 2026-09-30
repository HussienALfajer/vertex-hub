import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type Database, projects, retainers, type Transaction } from '@vertex-hub/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { type FileOwner, FileOwnerRegistry, isConfidentialReader } from '../files/index.js';
import { canWork, coversClient, holdsAll, readableProject } from './project-access.js';
import { readableRetainer } from './retainer-access.js';

type Executor = Database | Transaction;

/**
 * The `project` and `retainer` owner policies of the files module (spec F10): documents are read
 * under `projects.read`; project documents are changed by client scope and the project manager,
 * retainer documents by client scope only (F05).
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
}
