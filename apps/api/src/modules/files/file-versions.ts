import type { IncomingMessage, ServerResponse } from 'node:http';
import { Inject, Injectable } from '@nestjs/common';
import type { FilePreviewStatus, FileVersionKind } from '@vertex-hub/contracts';
import { type Database, fileItems, fileVersions, type Transaction } from '@vertex-hub/db';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { auditRefs } from './file-access.js';
import { FileContentService, type PreviewSize } from './file-content.service.js';
import { clearFinal } from './files.service.js';

type Executor = Database | Transaction;

/** A version as a review snapshot names it (F09). */
export interface VersionRef {
  id: string;
  fileItemId: string;
  /** The file's current name. */
  name: string;
  number: number;
}

/** A version of a snapshot sent to the client, as an approval request shows it (F09). */
export interface SentVersion extends VersionRef {
  kind: FileVersionKind;
  mimeType: string | null;
  sizeBytes: number | null;
  previewStatus: FilePreviewStatus;
  url: string | null;
  linkLabel: string | null;
  /** The version or its file was removed since. */
  removed: boolean;
}

/**
 * What the `tasks` module calls inside its own transactions (spec F10, "Changes to earlier
 * features"): the final markers, the client of task files, the file counts, and the versions a
 * review snapshot holds (spec F09). The `approvals` module reads the versions it sent, and serves
 * them to the holder of a link.
 */
@Injectable()
export class FileVersions {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly content: FileContentService,
  ) {}

  /** Versions by id with what an approval request shows of them, removed or not. */
  async sent(ids: readonly string[]): Promise<Map<string, SentVersion>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.db
      .select({
        id: fileVersions.id,
        fileItemId: fileVersions.fileItemId,
        name: fileItems.name,
        number: fileVersions.number,
        kind: fileVersions.kind,
        mimeType: fileVersions.mimeType,
        sizeBytes: fileVersions.sizeBytes,
        previewStatus: fileVersions.previewStatus,
        url: fileVersions.url,
        linkLabel: fileVersions.linkLabel,
        versionArchivedAt: fileVersions.archivedAt,
        itemArchivedAt: fileItems.archivedAt,
      })
      .from(fileVersions)
      .innerJoin(fileItems, eq(fileItems.id, fileVersions.fileItemId))
      .where(inArray(fileVersions.id, unique));
    return new Map(
      rows.map(({ versionArchivedAt, itemArchivedAt, ...row }) => [
        row.id,
        { ...row, removed: !!versionArchivedAt || !!itemArchivedAt },
      ]),
    );
  }

  /**
   * F09 rule 22: the bytes of a version an approval link shows. The caller has checked the link
   * and that the version belongs to a snapshot of its request.
   */
  serveSent(
    versionId: string,
    part: 'content' | PreviewSize,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    return this.content.sent(versionId, part, request, response);
  }

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

  /**
   * F09 rule 13: a client approval marks the exact versions sent final (`client`), each taking
   * the marker of its deliverable; deliverables outside the snapshot keep theirs. Versions or
   * files removed since are skipped.
   */
  async markSnapshotFinal(
    tx: Transaction,
    taskId: string,
    versionIds: readonly string[],
    actor: AuditActor | null,
  ): Promise<void> {
    if (versionIds.length === 0) return;
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
    const byId = new Map(items.map((item) => [item.id, item]));
    const versions = await tx
      .select()
      .from(fileVersions)
      .where(and(inArray(fileVersions.id, [...versionIds]), isNull(fileVersions.archivedAt)))
      .orderBy(fileVersions.fileItemId);
    for (const version of versions) {
      const item = byId.get(version.fileItemId);
      if (!item || (version.isFinal && version.finalSource === 'client')) continue;
      const previous = await clearFinal(tx, item.id);
      await tx
        .update(fileVersions)
        .set({ isFinal: true, finalSource: 'client', finalMarkedAt: new Date() })
        .where(eq(fileVersions.id, version.id));
      await recordAudit(tx, {
        actor,
        action: 'file_version.final_set',
        entityType: 'file_item',
        entityId: item.id,
        after: {
          ...auditRefs(item),
          number: version.number,
          source: 'client',
          previousFinal: previous,
        },
      });
    }
  }

  /**
   * What a review looks at (F09 rules 1 and 2): the latest live version of every live
   * deliverable of the task.
   */
  async latestDeliverableVersions(taskId: string, executor: Executor = this.db): Promise<string[]> {
    const rows = await executor
      .selectDistinctOn([fileVersions.fileItemId], { id: fileVersions.id })
      .from(fileVersions)
      .innerJoin(fileItems, eq(fileItems.id, fileVersions.fileItemId))
      .where(
        and(
          eq(fileItems.taskId, taskId),
          eq(fileItems.role, 'deliverable'),
          isNull(fileItems.archivedAt),
          isNull(fileVersions.archivedAt),
        ),
      )
      .orderBy(fileVersions.fileItemId, desc(fileVersions.number));
    return rows.map((row) => row.id);
  }

  /** Versions by id, removed or not, with their file's current name. */
  async versionRefs(
    ids: readonly string[],
    executor: Executor = this.db,
  ): Promise<Map<string, VersionRef>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await executor
      .select({
        id: fileVersions.id,
        fileItemId: fileVersions.fileItemId,
        name: fileItems.name,
        number: fileVersions.number,
      })
      .from(fileVersions)
      .innerJoin(fileItems, eq(fileItems.id, fileVersions.fileItemId))
      .where(inArray(fileVersions.id, unique));
    return new Map(rows.map((row) => [row.id, row]));
  }

  /** Rule 4: the task's files follow its client. */
  async moveTaskClient(tx: Transaction, taskId: string, clientId: string | null): Promise<void> {
    await tx.update(fileItems).set({ clientId }).where(eq(fileItems.taskId, taskId));
  }

  /** Live deliverables and references of a task, for its page header. */
  async taskFileCounts(
    taskId: string,
    executor: Executor = this.db,
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
