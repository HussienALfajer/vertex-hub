import type { IncomingMessage, ServerResponse } from 'node:http';
import { Inject, Injectable } from '@nestjs/common';
import { type FilePreviewStatus, type FileVersionKind, fileExtension } from '@vertex-hub/contracts';
import { type Database, fileItems, fileVersions, type Transaction } from '@vertex-hub/db';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { auditRefs } from './file-access.js';
import {
  contentDisposition,
  FileContentService,
  type PreviewSize,
} from './file-content.service.js';
import { FileStorage } from './file-storage.js';
import { clearFinal } from './files.service.js';
import { textEntry, writeZip, type ZipEntry } from './zip-stream.js';

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
  /** Measured at upload: images by the api, videos by the browser (F08B). */
  width: number | null;
  height: number | null;
  durationMs: number | null;
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
    private readonly storage: FileStorage,
  ) {}

  /**
   * F08B rule A11: sends a zip download named `name` of the given upload versions, each named
   * `baseName` with its own extension, and of text files. Removed versions and links are left
   * out: the caller lists links in a text file.
   */
  async sendArchive(
    name: string,
    files: readonly { versionId: string; baseName: string }[],
    texts: readonly { name: string; text: string }[],
    response: ServerResponse,
  ): Promise<void> {
    const ids = [...new Set(files.map((file) => file.versionId))];
    const rows = ids.length
      ? await this.db
          .select({
            id: fileVersions.id,
            storageKey: fileVersions.storageKey,
            originalName: fileVersions.originalName,
          })
          .from(fileVersions)
          .innerJoin(fileItems, eq(fileItems.id, fileVersions.fileItemId))
          .where(
            and(
              inArray(fileVersions.id, ids),
              isNull(fileVersions.archivedAt),
              isNull(fileItems.archivedAt),
            ),
          )
      : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const entries: ZipEntry[] = [];
    for (const file of files) {
      const row = byId.get(file.versionId);
      if (!row?.storageKey) continue;
      const key = row.storageKey;
      const size = await this.storage.size(key);
      if (size === null) continue;
      const extension = row.originalName ? fileExtension(row.originalName) : null;
      entries.push({
        name: extension ? `${file.baseName}.${extension}` : file.baseName,
        size,
        read: () => this.storage.read(key),
      });
    }
    entries.push(...texts.map((text) => textEntry(text.name, text.text)));
    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/zip');
    response.setHeader('Content-Disposition', contentDisposition(false, name));
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    await writeZip(entries, response);
  }

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
        width: fileVersions.width,
        height: fileVersions.height,
        durationMs: fileVersions.durationMs,
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
   * F08B: a client's current image at its small size, for the post previews of the client page;
   * the caller checked the link.
   */
  serveClientImage(
    imageId: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    return this.content.image(imageId, 'sm', request, response);
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

  /**
   * F08 rule 5: the latest live version of each live file of the posts, files by creation.
   */
  async postMedia(
    postIds: readonly string[],
    executor: Executor = this.db,
  ): Promise<Map<string, SentVersion[]>> {
    const media = new Map<string, SentVersion[]>();
    if (postIds.length === 0) return media;
    const rows = await executor
      .selectDistinctOn([fileVersions.fileItemId], {
        postId: fileItems.postId,
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
        width: fileVersions.width,
        height: fileVersions.height,
        durationMs: fileVersions.durationMs,
      })
      .from(fileVersions)
      .innerJoin(fileItems, eq(fileItems.id, fileVersions.fileItemId))
      .where(
        and(
          inArray(fileItems.postId, [...postIds]),
          isNull(fileItems.archivedAt),
          isNull(fileVersions.archivedAt),
        ),
      )
      // Item ids are UUIDv7, so their order is the order of creation.
      .orderBy(fileVersions.fileItemId, desc(fileVersions.number));
    for (const { postId, ...version } of rows) {
      if (!postId) continue;
      media.set(postId, [...(media.get(postId) ?? []), { ...version, removed: false }]);
    }
    return media;
  }

  /**
   * F08 rule 5: the final version of each live deliverable of the tasks, deliverables by
   * creation. A deliverable without a final version gives nothing.
   */
  async finalVersions(
    taskIds: readonly string[],
    executor: Executor = this.db,
  ): Promise<Map<string, SentVersion[]>> {
    const finals = new Map<string, SentVersion[]>();
    if (taskIds.length === 0) return finals;
    const rows = await executor
      .select({
        taskId: fileItems.taskId,
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
        width: fileVersions.width,
        height: fileVersions.height,
        durationMs: fileVersions.durationMs,
      })
      .from(fileVersions)
      .innerJoin(fileItems, eq(fileItems.id, fileVersions.fileItemId))
      .where(
        and(
          inArray(fileItems.taskId, [...taskIds]),
          eq(fileItems.role, 'deliverable'),
          eq(fileVersions.isFinal, true),
          isNull(fileItems.archivedAt),
          isNull(fileVersions.archivedAt),
        ),
      )
      // Item ids are UUIDv7, so their order is the order of creation.
      .orderBy(fileVersions.fileItemId);
    for (const { taskId, ...version } of rows) {
      if (!taskId) continue;
      finals.set(taskId, [...(finals.get(taskId) ?? []), { ...version, removed: false }]);
    }
    return finals;
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

  /** F17 rule B13: the live documents of each leave request (the sick certificate). */
  async hrRequestDocumentCounts(
    requestIds: readonly string[],
    executor: Executor = this.db,
  ): Promise<Map<string, number>> {
    const unique = [...new Set(requestIds)];
    if (unique.length === 0) return new Map();
    const rows = await executor
      .select({ requestId: fileItems.hrRequestId, count: count() })
      .from(fileItems)
      .where(and(inArray(fileItems.hrRequestId, unique), isNull(fileItems.archivedAt)))
      .groupBy(fileItems.hrRequestId);
    return new Map(rows.flatMap((row) => (row.requestId ? [[row.requestId, row.count]] : [])));
  }
}
