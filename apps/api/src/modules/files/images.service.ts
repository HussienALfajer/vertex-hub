import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  FILES_PREVIEW_JOB,
  IMAGE_MAX_BYTES,
  IMAGE_MIME_TYPES,
  IMAGE_MIN_SIDE,
  type SetImage,
} from '@vertex-hub/contracts';
import { fileItems, fileUploads, fileVersions, images, type Transaction } from '@vertex-hub/db';
import { and, eq, isNull } from 'drizzle-orm';
import { CodedException } from '../../core/errors/index.js';
import { JobQueue } from '../../core/jobs/index.js';
import {
  type CurrentUserInfo,
  type ImageStore,
  type ImageSubject,
  type StoredImage,
  UserImages,
} from '../auth/index.js';

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
  constructor(
    private readonly jobs: JobQueue,
    private readonly userImages: UserImages,
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
