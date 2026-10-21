import { Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { type Database, hrRequests, type Transaction } from '@vertex-hub/db';
import { and, eq, isNull } from 'drizzle-orm';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { type FileOwner, FileOwnerRegistry } from '../files/index.js';
import { holdsAll } from './employee-access.js';
import { HrScope } from './hr-scope.js';

type Executor = Database | Transaction;

/**
 * The `hr_request` owner policy of the files module (rule B13): a request's documents, the sick
 * certificate above all. The employee and `hr.read` holders covering them read them; the employee
 * and `hr.approve` holders add them, also after the request is submitted.
 */
@Injectable()
export class HrRequestFileOwner implements OnModuleInit {
  constructor(
    private readonly registry: FileOwnerRegistry,
    private readonly users: UserDirectory,
    private readonly scope: HrScope,
  ) {}

  onModuleInit(): void {
    this.registry.register('hr_request', {
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
    const query = executor
      .select({ userId: hrRequests.userId })
      .from(hrRequests)
      .where(and(eq(hrRequests.id, id), isNull(hrRequests.archivedAt)));
    const [request] = options.forUpdate ? await query.for('update') : await query;
    if (!request) throw new NotFoundException();
    const own = request.userId === actor.id;
    if (!own && !(await this.scope.covers(actor, request.userId, executor))) {
      throw new NotFoundException();
    }
    const people = await this.users.summaries([request.userId], executor);
    const employee = people.get(request.userId);
    const approver = holdsAll(actor, 'hr.approve');
    return {
      type: 'hr_request',
      id,
      clientId: null,
      clientName: null,
      label: employee?.name ?? '',
      archivedCode: employee?.archived ? 'USER_ARCHIVED' : null,
      task: null,
      rights: {
        addDeliverable: false,
        addReference: false,
        manageTask: false,
        manageDocuments: own || approver,
        confidentialReader: false,
        scopeAll: approver,
      },
    };
  }
}
