import type { IncomingMessage, ServerResponse } from 'node:http';
import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_FILE_NAME,
  FILE_NAME_MAX,
  FILE_PREVIEW_MAX_BYTES,
  FILES_PREVIEW_JOB,
  isPreviewableMimeType,
} from '@vertex-hub/contracts';
import {
  type Database,
  fileItems,
  fileUploads,
  fileVersions,
  type Transaction,
} from '@vertex-hub/db';
import { and, desc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { JobQueue } from '../../core/jobs/index.js';
import { recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { auditRefs, ownerFilter } from './file-access.js';
import { FileContentService } from './file-content.service.js';
import { FileStorage } from './file-storage.js';

/** The owners whose documents only their module adds (F04 quotes, F13 invoices). */
type DocumentOwnerType = 'quote' | 'invoice';

/** The owner columns of a document of `type`. */
const documentOwner = (type: DocumentOwnerType, id: string) => ({
  ownerType: type,
  quoteId: type === 'quote' ? id : null,
  invoiceId: type === 'invoice' ? id : null,
});

/** A file the system produced and already stored, such as the PDF of a sent quote (F04). */
export interface GeneratedDocument {
  ownerType: DocumentOwnerType;
  ownerId: string;
  clientId: string;
  name: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  /** Who the item is recorded as created by: the person whose action produced it. */
  createdById: string;
}

/**
 * An upload a module attaches to its own record, such as a quote's acceptance proof (F04 A1) or a
 * payment's proof (F13).
 */
export interface AttachedUpload {
  ownerType: DocumentOwnerType;
  ownerId: string;
  clientId: string;
  uploadId: string;
  /** Put before the uploaded name, such as the receipt number of a payment's proof. */
  namePrefix?: string;
}

/**
 * Files the system renders (spec F04 rules 12 and 13): attached as documents of their owner, or
 * kept outside items as a draft preview, and served once the owning module checked the reader.
 * Also attaches an upload as a document of an owner whose documents nobody adds through the file
 * endpoints (F04 A1).
 */
@Injectable()
export class GeneratedFiles {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly content: FileContentService,
    private readonly storage: FileStorage,
    private readonly jobs: JobQueue,
  ) {}

  /**
   * Rule 2 for an owner module: the actor's upload, used once (`UPLOAD_NOT_FOUND`), becomes a
   * document named after the uploaded file (`FILE_NAME_TAKEN`). Returns whether a preview waits:
   * call `queuePreviews` once the transaction committed.
   */
  async attachUpload(
    tx: Transaction,
    actor: CurrentUserInfo,
    document: AttachedUpload,
  ): Promise<{ itemId: string; name: string; preview: boolean }> {
    const [upload] = await tx
      .delete(fileUploads)
      .where(and(eq(fileUploads.id, document.uploadId), eq(fileUploads.userId, actor.id)))
      .returning();
    if (!upload) throw new CodedException(400, 'UPLOAD_NOT_FOUND', 'Upload the file again');
    const name = documentName(
      document.namePrefix ? `${document.namePrefix} ${upload.originalName}` : upload.originalName,
    );
    const [taken] = await tx
      .select({ id: fileItems.id })
      .from(fileItems)
      .where(
        and(
          ownerFilter(document.ownerType, document.ownerId),
          eq(fileItems.role, 'document'),
          isNull(fileItems.archivedAt),
          sql`lower(${fileItems.name}) = lower(${name})`,
        ),
      )
      .limit(1);
    if (taken) {
      throw new CodedException(409, 'FILE_NAME_TAKEN', 'A file with this name exists here');
    }
    const preview =
      isPreviewableMimeType(upload.mimeType) && upload.sizeBytes <= FILE_PREVIEW_MAX_BYTES;
    const [item] = await tx
      .insert(fileItems)
      .values({
        ...documentOwner(document.ownerType, document.ownerId),
        clientId: document.clientId,
        role: 'document',
        name,
        createdById: actor.id,
      })
      .returning();
    if (!item) throw new Error('File item not created');
    await tx.insert(fileVersions).values({
      fileItemId: item.id,
      number: 1,
      kind: 'upload',
      storageKey: upload.storageKey,
      originalName: upload.originalName,
      mimeType: upload.mimeType,
      sizeBytes: upload.sizeBytes,
      sha256: upload.sha256,
      width: upload.width,
      height: upload.height,
      previewStatus: preview ? 'pending' : 'none',
      uploadedById: actor.id,
    });
    await recordAudit(tx, {
      actor: { id: actor.id, name: actor.name },
      action: 'file_item.created',
      entityType: 'file_item',
      entityId: item.id,
      after: { ...auditRefs(item), name, number: 1, kind: 'upload', sizeBytes: upload.sizeBytes },
    });
    return { itemId: item.id, name, preview };
  }

  /** Nudges the preview job after a commit that left previews pending. */
  queuePreviews(): Promise<void> {
    return this.jobs.send(FILES_PREVIEW_JOB.queue);
  }

  /** Attaches the stored object as a document with one version; audited without an actor. */
  async attachDocument(tx: Transaction, document: GeneratedDocument): Promise<string> {
    const [item] = await tx
      .insert(fileItems)
      .values({
        ...documentOwner(document.ownerType, document.ownerId),
        clientId: document.clientId,
        role: 'document',
        name: document.name,
        createdById: document.createdById,
      })
      .returning();
    if (!item) throw new Error('File item not created');
    await tx.insert(fileVersions).values({
      fileItemId: item.id,
      number: 1,
      kind: 'upload',
      storageKey: document.storageKey,
      originalName: document.name,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      sha256: document.sha256,
      uploadedById: document.createdById,
    });
    await recordAudit(tx, {
      actor: null,
      action: 'file_item.created',
      entityType: 'file_item',
      entityId: item.id,
      after: {
        ...auditRefs(item),
        name: item.name,
        number: 1,
        kind: 'upload',
        sizeBytes: document.sizeBytes,
      },
    });
    return item.id;
  }

  /**
   * A new rendering of a generated document (F13 rule 13: an invoice whose due date changed)
   * becomes its next version; audited without an actor. Nothing is added when the latest version
   * already holds the object, so a repeated result adds nothing.
   */
  async addDocumentVersion(
    tx: Transaction,
    itemId: string,
    file: Pick<
      GeneratedDocument,
      'storageKey' | 'mimeType' | 'sizeBytes' | 'sha256' | 'createdById'
    >,
  ): Promise<void> {
    const [item] = await tx.select().from(fileItems).where(eq(fileItems.id, itemId)).for('update');
    if (!item) throw new Error('File item not found');
    const [latest] = await tx
      .select({ storageKey: fileVersions.storageKey })
      .from(fileVersions)
      .where(eq(fileVersions.fileItemId, itemId))
      .orderBy(desc(fileVersions.number))
      .limit(1);
    if (latest?.storageKey === file.storageKey) return;
    const [counts] = await tx
      .select({ highest: max(fileVersions.number) })
      .from(fileVersions)
      .where(eq(fileVersions.fileItemId, itemId));
    const number = (counts?.highest ?? 0) + 1;
    await tx.insert(fileVersions).values({
      fileItemId: itemId,
      number,
      kind: 'upload',
      storageKey: file.storageKey,
      originalName: item.name,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      uploadedById: file.createdById,
    });
    await tx.update(fileItems).set({ updatedAt: new Date() }).where(eq(fileItems.id, itemId));
    await recordAudit(tx, {
      actor: null,
      action: 'file_version.created',
      entityType: 'file_item',
      entityId: itemId,
      after: { ...auditRefs(item), number, kind: 'upload', sizeBytes: file.sizeBytes },
    });
  }

  /** Whether a document version holds the object, so it must not be deleted. */
  async holdsObject(executor: Database | Transaction, storageKey: string): Promise<boolean> {
    const [row] = await executor
      .select({ id: fileVersions.id })
      .from(fileVersions)
      .where(eq(fileVersions.storageKey, storageKey))
      .limit(1);
    return !!row;
  }

  /** Archives a generated document (F13 rule 22: the receipt of a void payment), once. */
  async archiveDocument(
    tx: Transaction,
    itemId: string,
    actor: { id: string; name: string } | null,
  ): Promise<void> {
    const [item] = await tx
      .update(fileItems)
      .set({ archivedAt: new Date() })
      .where(and(eq(fileItems.id, itemId), isNull(fileItems.archivedAt)))
      .returning();
    if (!item) return;
    await recordAudit(tx, {
      actor,
      action: 'file_item.archived',
      entityType: 'file_item',
      entityId: itemId,
      after: { ...auditRefs(item), name: item.name },
    });
  }

  /** The names of the given items, by id. */
  async names(
    itemIds: readonly string[],
    executor: Database | Transaction = this.db,
  ): Promise<Map<string, string>> {
    if (itemIds.length === 0) return new Map();
    const rows = await executor
      .select({ id: fileItems.id, name: fileItems.name })
      .from(fileItems)
      .where(inArray(fileItems.id, [...itemIds]));
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  /** The latest live version of a live item, or null once removed. */
  async latest(itemId: string): Promise<{ storageKey: string; mimeType: string } | null> {
    const [row] = await this.db
      .select({ storageKey: fileVersions.storageKey, mimeType: fileVersions.mimeType })
      .from(fileVersions)
      .innerJoin(fileItems, eq(fileItems.id, fileVersions.fileItemId))
      .where(
        and(
          eq(fileItems.id, itemId),
          isNull(fileItems.archivedAt),
          isNull(fileVersions.archivedAt),
          eq(fileVersions.kind, 'upload'),
        ),
      )
      .orderBy(desc(fileVersions.number))
      .limit(1);
    return row?.storageKey && row.mimeType
      ? { storageKey: row.storageKey, mimeType: row.mimeType }
      : null;
  }

  serve(
    key: string,
    name: string,
    mimeType: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    return this.content.object(key, name, mimeType, request, response);
  }

  /** Deletes an object no item holds (a replaced or discarded draft preview). */
  remove(key: string): Promise<void> {
    return this.storage.remove(key);
  }
}

/** The uploaded name with its extension, cut to the item name limit. */
function documentName(originalName: string): string {
  const dot = originalName.lastIndexOf('.');
  const extension = dot > 0 && originalName.length - dot <= 16 ? originalName.slice(dot) : '';
  const stem = originalName.slice(0, originalName.length - extension.length).trim();
  const cut = stem.slice(0, FILE_NAME_MAX - extension.length).trim();
  return cut ? `${cut}${extension}` : DEFAULT_FILE_NAME;
}
