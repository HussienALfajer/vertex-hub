import { Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { type Database, employeeFiles, type Transaction } from '@vertex-hub/db';
import { eq } from 'drizzle-orm';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { type FileOwner, FileOwnerRegistry } from '../files/index.js';
import { fileView, holdsAll } from './employee-access.js';
import { EmployeeFiles } from './employee-files.js';

type Executor = Database | Transaction;

/**
 * The `employee` owner policy of the files module (rule A6): documents of an employee file, keyed
 * by the user id. `employees.read` holders and the employee read them; documents marked
 * confidential are for `salaries.read` holders and the employee only. `employees.manage`
 * holders upload and archive them; `salaries.read` holders without the file see, upload and
 * archive confidential ones only.
 */
@Injectable()
export class EmployeeFileOwner implements OnModuleInit {
  constructor(
    private readonly registry: FileOwnerRegistry,
    private readonly users: UserDirectory,
    private readonly files: EmployeeFiles,
  ) {}

  onModuleInit(): void {
    this.registry.register('employee', {
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
    const view = fileView(actor, id);
    const [profile] = view ? await this.users.profiles({ ids: [id] }, executor) : [];
    if (!view || !profile) throw new NotFoundException();
    await this.files.ensure(executor, [profile]);
    const query = executor
      .select({ archivedAt: employeeFiles.archivedAt })
      .from(employeeFiles)
      .where(eq(employeeFiles.userId, id));
    const [file] = options.forUpdate ? await query.for('update') : await query;
    if (!file) throw new NotFoundException();
    const manages = holdsAll(actor, 'employees.manage');
    const paysReader = holdsAll(actor, 'salaries.read');
    return {
      type: 'employee',
      id,
      clientId: null,
      clientName: null,
      label: profile.name,
      archivedCode: file.archivedAt ? 'USER_ARCHIVED' : null,
      task: null,
      rights: {
        addDeliverable: false,
        addReference: false,
        manageTask: false,
        manageDocuments: manages || paysReader,
        confidentialReader: paysReader || actor.id === id,
        confidentialOnly: !view.file,
        scopeAll: manages,
      },
    };
  }
}
