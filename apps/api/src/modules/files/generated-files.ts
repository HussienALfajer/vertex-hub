import type { IncomingMessage, ServerResponse } from 'node:http';
import { Inject, Injectable } from '@nestjs/common';
import { type Database, fileItems, fileVersions, type Transaction } from '@vertex-hub/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { recordAudit } from '../audit/index.js';
import { auditRefs } from './file-access.js';
import { FileContentService } from './file-content.service.js';
import { FileStorage } from './file-storage.js';

/** A file the system produced and already stored, such as the PDF of a sent quote (F04). */
export interface GeneratedDocument {
  ownerType: 'quote';
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
 * Files the system renders (spec F04 rules 12 and 13): attached as documents of their owner, or
 * kept outside items as a draft preview, and served once the owning module checked the reader.
 */
@Injectable()
export class GeneratedFiles {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly content: FileContentService,
    private readonly storage: FileStorage,
  ) {}

  /** Attaches the stored object as a document with one version; audited without an actor. */
  async attachDocument(tx: Transaction, document: GeneratedDocument): Promise<string> {
    const [item] = await tx
      .insert(fileItems)
      .values({
        ownerType: document.ownerType,
        quoteId: document.ownerId,
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
