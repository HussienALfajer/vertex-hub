import { Inject, Injectable } from '@nestjs/common';
import {
  FILE_PREVIEW_MAX_BYTES,
  FILES_PREVIEW_JOB,
  isPreviewableMimeType,
  type TaskAttachment,
} from '@vertex-hub/contracts';
import {
  type Database,
  fileItems,
  fileUploads,
  fileVersions,
  type Transaction,
} from '@vertex-hub/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { JobQueue } from '../../core/jobs/index.js';
import { recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { auditRefs } from './file-access.js';
import { documentName } from './generated-files.js';

type Executor = Database | Transaction;

/** The task, its client and the comment a set of files goes to. */
export interface TaskThreadTarget {
  taskId: string;
  clientId: string | null;
  commentId: string;
}

/**
 * F06B rule B2: the files of a task's thread. The author's held uploads (F10 rule 1) become
 * `attachment` items of the task tied to a comment, a question or a reply, single versions like
 * references; rule B11 copies them as references of the subtask a question was turned into. They
 * follow the task's file access, and the `tasks` module calls this inside its transaction.
 */
@Injectable()
export class FileAttachments {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly jobs: JobQueue,
  ) {}

  /**
   * Attaches the actor's uploads, each used once (`UPLOAD_NOT_FOUND`). Returns whether a preview
   * waits: call `queuePreviews` once the transaction committed.
   */
  async attach(
    tx: Transaction,
    actor: CurrentUserInfo,
    target: TaskThreadTarget,
    uploadIds: readonly string[],
  ): Promise<boolean> {
    let preview = false;
    for (const uploadId of uploadIds) {
      const [upload] = await tx
        .delete(fileUploads)
        .where(and(eq(fileUploads.id, uploadId), eq(fileUploads.userId, actor.id)))
        .returning();
      if (!upload) throw new CodedException(400, 'UPLOAD_NOT_FOUND', 'Upload the file again');
      const previewable =
        isPreviewableMimeType(upload.mimeType) && upload.sizeBytes <= FILE_PREVIEW_MAX_BYTES;
      preview ||= previewable;
      const itemId = await this.insertItem(tx, actor, {
        ownerType: 'task',
        taskId: target.taskId,
        clientId: target.clientId,
        role: 'attachment',
        taskCommentId: target.commentId,
        name: documentName(upload.originalName),
      });
      await tx.insert(fileVersions).values({
        fileItemId: itemId,
        number: 1,
        kind: 'upload',
        storageKey: upload.storageKey,
        originalName: upload.originalName,
        mimeType: upload.mimeType,
        sizeBytes: upload.sizeBytes,
        sha256: upload.sha256,
        width: upload.width,
        height: upload.height,
        previewStatus: previewable ? 'pending' : 'none',
        uploadedById: actor.id,
      });
    }
    return preview;
  }

  /** The live attachments of each comment, oldest first. */
  async ofComments(
    commentIds: readonly string[],
    executor: Executor = this.db,
  ): Promise<Map<string, TaskAttachment[]>> {
    const byComment = new Map<string, TaskAttachment[]>();
    if (commentIds.length === 0) return byComment;
    const rows = await executor
      .select({
        commentId: fileItems.taskCommentId,
        id: fileItems.id,
        name: fileItems.name,
        versionId: fileVersions.id,
        mimeType: fileVersions.mimeType,
        sizeBytes: fileVersions.sizeBytes,
        previewStatus: fileVersions.previewStatus,
      })
      .from(fileItems)
      .innerJoin(fileVersions, eq(fileVersions.fileItemId, fileItems.id))
      .where(
        and(
          inArray(fileItems.taskCommentId, [...commentIds]),
          isNull(fileItems.archivedAt),
          isNull(fileVersions.archivedAt),
        ),
      )
      .orderBy(asc(fileItems.createdAt), asc(fileItems.id));
    for (const row of rows) {
      if (!row.commentId || !row.mimeType || !row.sizeBytes) continue;
      const list = byComment.get(row.commentId) ?? [];
      list.push({
        id: row.id,
        name: row.name,
        versionId: row.versionId,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        previewReady: row.previewStatus === 'ready',
      });
      byComment.set(row.commentId, list);
    }
    return byComment;
  }

  /**
   * Rule B11: the comment's live attachments copied as references of another task, keeping the
   * stored objects. Returns whether a preview waits (`queuePreviews` after the commit).
   */
  async copyAsReferences(
    tx: Transaction,
    actor: CurrentUserInfo,
    commentId: string,
    to: { taskId: string; clientId: string | null },
  ): Promise<boolean> {
    const sources = await tx
      .select({ name: fileItems.name, version: fileVersions })
      .from(fileItems)
      .innerJoin(fileVersions, eq(fileVersions.fileItemId, fileItems.id))
      .where(
        and(
          eq(fileItems.taskCommentId, commentId),
          isNull(fileItems.archivedAt),
          isNull(fileVersions.archivedAt),
        ),
      )
      .orderBy(asc(fileItems.createdAt), asc(fileItems.id));
    let preview = false;
    for (const { name, version } of sources) {
      const itemId = await this.insertItem(tx, actor, {
        ownerType: 'task',
        taskId: to.taskId,
        clientId: to.clientId,
        role: 'reference',
        taskCommentId: null,
        name,
      });
      const previewable = version.previewStatus !== 'none';
      preview ||= previewable;
      await tx.insert(fileVersions).values({
        fileItemId: itemId,
        number: 1,
        kind: version.kind,
        storageKey: version.storageKey,
        originalName: version.originalName,
        mimeType: version.mimeType,
        sizeBytes: version.sizeBytes,
        sha256: version.sha256,
        width: version.width,
        height: version.height,
        url: version.url,
        linkLabel: version.linkLabel,
        // The preview is stored per version: the copy renders its own.
        previewStatus: previewable ? 'pending' : 'none',
        uploadedById: actor.id,
      });
    }
    return preview;
  }

  /** Nudges the preview job after a commit that left previews pending. */
  queuePreviews(): Promise<void> {
    return this.jobs.send(FILES_PREVIEW_JOB.queue);
  }

  private async insertItem(
    tx: Transaction,
    actor: CurrentUserInfo,
    values: Pick<
      typeof fileItems.$inferInsert,
      'ownerType' | 'taskId' | 'clientId' | 'role' | 'taskCommentId' | 'name'
    >,
  ): Promise<string> {
    const [item] = await tx
      .insert(fileItems)
      .values({ ...values, createdById: actor.id })
      .returning();
    if (!item) throw new Error('File item not created');
    await recordAudit(tx, {
      actor: { id: actor.id, name: actor.name },
      action: 'file_item.created',
      entityType: 'file_item',
      entityId: item.id,
      after: {
        ...auditRefs(item),
        name: item.name,
        number: 1,
        ...(item.taskCommentId && { taskCommentId: item.taskCommentId }),
      },
    });
    return item.id;
  }
}
