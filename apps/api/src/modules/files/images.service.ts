import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  FILES_PREVIEW_JOB,
  IMAGE_MAX_BYTES,
  IMAGE_MIME_TYPES,
  IMAGE_MIN_SIDE,
  type SetImage,
} from '@vertex-hub/contracts';
import {
  type Database,
  fileItems,
  fileUploads,
  fileVersions,
  images,
  type Transaction,
} from '@vertex-hub/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { JobQueue } from '../../core/jobs/index.js';
import {
  type CurrentUserInfo,
  type ImageStore,
  type ImageSubject,
  type StoredImage,
  UserImages,
} from '../auth/index.js';
import { imageRenditionKey } from './file-content.service.js';
import { FileStorage } from './file-storage.js';

/** The column of `images` that holds the subject's id. */
const subjectColumn = (type: ImageSubject['type']) =>
  ({
    user: images.userId,
    client: images.clientId,
    project: images.projectId,
    retainer: images.retainerId,
  })[type];

const subjectValues = (subject: ImageSubject) => ({
  subjectType: subject.type,
  userId: subject.type === 'user' ? subject.id : null,
  clientId: subject.type === 'client' ? subject.id : null,
  projectId: subject.type === 'project' ? subject.id : null,
  retainerId: subject.type === 'retainer' ? subject.id : null,
});

/**
 * Profile images (spec F01C, ADR 0040): one current image per user, client, project or
 * retainer. The record's module calls this inside its own transaction; `FileContentService`
 * serves and renders the images.
 */
@Injectable()
export class ImagesService implements ImageStore, OnModuleInit {
  private readonly logger = new Logger(ImagesService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly jobs: JobQueue,
    private readonly userImages: UserImages,
    private readonly storage: FileStorage,
  ) {}

  onModuleInit(): void {
    this.userImages.register(this);
  }

  async set(
    tx: Transaction,
    actor: CurrentUserInfo,
    subject: ImageSubject,
    input: SetImage,
  ): Promise<StoredImage> {
    const { uploadId, brandVersionId } = input.source;
    // F10's attach: the uploader's upload, once; restored if the transaction fails.
    const [upload] = await tx
      .delete(fileUploads)
      .where(and(eq(fileUploads.id, uploadId), eq(fileUploads.userId, actor.id)))
      .returning();
    if (!upload) throw new CodedException(400, 'UPLOAD_NOT_FOUND', 'Upload the file again');
    if (!(IMAGE_MIME_TYPES as readonly string[]).includes(upload.mimeType)) {
      throw new CodedException(400, 'IMAGE_TYPE_NOT_ALLOWED', 'Upload a PNG, JPEG or WebP image');
    }
    if (upload.sizeBytes > IMAGE_MAX_BYTES) {
      throw new CodedException(413, 'IMAGE_TOO_LARGE', 'Images are limited to 10 MB');
    }
    if (
      (upload.width !== null && upload.width < IMAGE_MIN_SIDE) ||
      (upload.height !== null && upload.height < IMAGE_MIN_SIDE)
    ) {
      throw new CodedException(400, 'IMAGE_TOO_SMALL', 'Each side must be at least 128 px');
    }
    if (brandVersionId) await this.assertBrandLogo(tx, subject, brandVersionId);

    await this.archiveCurrent(tx, actor, subject);
    const source = brandVersionId ? 'brand_file' : 'upload';
    const [image] = await tx
      .insert(images)
      .values({
        ...subjectValues(subject),
        source,
        sourceVersionId: brandVersionId ?? null,
        storageKey: upload.storageKey,
        mimeType: upload.mimeType,
        sizeBytes: upload.sizeBytes,
        width: upload.width,
        height: upload.height,
        createdById: actor.id,
      })
      .returning({ id: images.id, status: images.status });
    if (!image) throw new Error('Image not stored');
    return { image, source, brandVersionId: brandVersionId ?? null };
  }

  async remove(tx: Transaction, actor: CurrentUserInfo, subject: ImageSubject): Promise<void> {
    await this.archiveCurrent(tx, actor, subject);
  }

  /**
   * Rule 14: the storage key a client-facing PDF embeds beside the client's name: the `md`
   * rendition of the client's current logo when ready, the uploaded square while pending, null
   * without a logo or when it failed.
   */
  async clientLogoKey(
    clientId: string | null,
    executor: Database | Transaction = this.db,
  ): Promise<string | null> {
    if (!clientId) return null;
    const [image] = await executor
      .select({ storageKey: images.storageKey, status: images.status })
      .from(images)
      .where(and(eq(images.clientId, clientId), isNull(images.archivedAt)));
    if (!image || image.status === 'failed') return null;
    return image.status === 'ready' ? imageRenditionKey(image.storageKey, 'md') : image.storageKey;
  }

  /**
   * Rule 15: a user's photo as a data URL, for the entrance screen, which has no session: the `md`
   * rendition when ready, the uploaded square while pending; null without a photo, when it
   * failed or when the file cannot be read (the greeting then shows the initial).
   */
  async photoDataUrl(imageId: string | null): Promise<string | null> {
    if (!imageId) return null;
    const [image] = await this.db
      .select({ storageKey: images.storageKey, mimeType: images.mimeType, status: images.status })
      .from(images)
      .where(
        and(
          eq(images.id, imageId),
          eq(images.subjectType, 'user'),
          inArray(images.status, ['ready', 'pending']),
          isNull(images.archivedAt),
        ),
      );
    if (!image) return null;
    const ready = image.status === 'ready';
    const key = ready ? imageRenditionKey(image.storageKey, 'md') : image.storageKey;
    try {
      const bytes = Buffer.concat(await this.storage.read(key).toArray());
      return `data:${ready ? 'image/webp' : image.mimeType};base64,${bytes.toString('base64')}`;
    } catch (error) {
      this.logger.warn(`Could not read the photo ${key}: ${String(error)}`);
      return null;
    }
  }

  queueRenders(): Promise<void> {
    return this.jobs.send(FILES_PREVIEW_JOB.queue);
  }

  private async archiveCurrent(
    tx: Transaction,
    actor: CurrentUserInfo,
    subject: ImageSubject,
  ): Promise<void> {
    await tx
      .update(images)
      .set({ archivedAt: new Date(), archivedById: actor.id, updatedAt: new Date() })
      .where(and(eq(subjectColumn(subject.type), subject.id), isNull(images.archivedAt)));
  }

  /**
   * Rule 6: a version of a non-archived `logo` brand file of the same client, uploaded (not a
   * link); only clients pick from brand files.
   */
  private async assertBrandLogo(
    tx: Transaction,
    subject: ImageSubject,
    versionId: string,
  ): Promise<void> {
    const [version] =
      subject.type === 'client'
        ? await tx
            .select({ id: fileVersions.id })
            .from(fileVersions)
            .innerJoin(fileItems, eq(fileItems.id, fileVersions.fileItemId))
            .where(
              and(
                eq(fileVersions.id, versionId),
                eq(fileVersions.kind, 'upload'),
                eq(fileItems.ownerType, 'client'),
                eq(fileItems.clientId, subject.id),
                eq(fileItems.role, 'brand'),
                eq(fileItems.brandKind, 'logo'),
                isNull(fileItems.archivedAt),
              ),
            )
        : [];
    if (!version) {
      throw new CodedException(400, 'BRAND_FILE_NOT_FOUND', 'Pick a logo of this client');
    }
  }
}
