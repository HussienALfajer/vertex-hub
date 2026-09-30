import { Inject, Injectable } from '@nestjs/common';
import { type Database, fileItems, fileVersions, type Transaction } from '@vertex-hub/db';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { auditRefs } from './file-access.js';
import { clearFinal } from './files.service.js';

/**
 * What the `tasks` module calls inside its own transactions (spec F10, "Changes to earlier
 * features"): the automatic final marker, the client of task files, and the file counts.
 */
@Injectable()
export class FileVersions {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Rule 9: the latest live version of every live deliverable of the task becomes final
   * (`auto`), taking the marker from a previous final version. Audited with the approving actor.
   */
  async markLatestFinal(tx: Transaction, taskId: string, actor: AuditActor): Promise<void> {
    const items = await tx
      .select()
      .from(fileItems)
      .where(
        and(
          eq(fileItems.taskId, taskId),
          eq(fileItems.role, 'deliverable'),
          isNull(fileItems.archivedAt),
        ),
      )
      .orderBy(fileItems.id)
      .for('update');
    for (const item of items) {
      const [latest] = await tx
        .select()
        .from(fileVersions)
        .where(and(eq(fileVersions.fileItemId, item.id), isNull(fileVersions.archivedAt)))
        .orderBy(desc(fileVersions.number))
        .limit(1);
      if (!latest || latest.isFinal) continue;
      const previous = await clearFinal(tx, item.id);
      await tx
        .update(fileVersions)
        .set({ isFinal: true, finalSource: 'auto', finalMarkedAt: new Date() })
        .where(eq(fileVersions.id, latest.id));
      await recordAudit(tx, {
        actor,
        action: 'file_version.final_set',
        entityType: 'file_item',
        entityId: item.id,
        after: {
          ...auditRefs(item),
          number: latest.number,
          source: 'auto',
          previousFinal: previous,
        },
      });
    }
  }

  /** Rule 4: the task's files follow its client. */
  async moveTaskClient(tx: Transaction, taskId: string, clientId: string | null): Promise<void> {
    await tx.update(fileItems).set({ clientId }).where(eq(fileItems.taskId, taskId));
  }

  /** Live deliverables and references of a task, for its page header. */
  async taskFileCounts(
    taskId: string,
    executor: Database | Transaction = this.db,
  ): Promise<{ deliverables: number; references: number }> {
    const rows = await executor
      .select({ role: fileItems.role, count: count() })
      .from(fileItems)
      .where(and(eq(fileItems.taskId, taskId), isNull(fileItems.archivedAt)))
      .groupBy(fileItems.role);
    const of = (role: string) => rows.find((row) => row.role === role)?.count ?? 0;
    return { deliverables: of('deliverable'), references: of('reference') };
  }
}
