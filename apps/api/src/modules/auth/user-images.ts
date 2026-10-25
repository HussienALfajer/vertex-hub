import { Injectable } from '@nestjs/common';
import type { Image, ImageSource, ImageSubjectType, SetImage } from '@vertex-hub/contracts';
import type { Transaction } from '@vertex-hub/db';
import type { CurrentUserInfo } from './current-user.decorator.js';

/** The record an image belongs to (F01C). */
export interface ImageSubject {
  type: ImageSubjectType;
  id: string;
}

/** A new current image, with what its audit entry records. */
export interface StoredImage {
  image: Image;
  source: ImageSource;
  brandVersionId: string | null;
}

/**
 * Where images are stored (the `files` module's `ImagesService`, ADR 0040). The record's module
 * locks its row, keeps its own `image_id`, audits and notifies in the same transaction.
 */
export interface ImageStore {
  /** Rules 1, 2 and 6: archives the subject's current image and stores the upload as the new one. */
  set(
    tx: Transaction,
    actor: CurrentUserInfo,
    subject: ImageSubject,
    input: SetImage,
  ): Promise<StoredImage>;
  /** Rule 4: archives the subject's current image, if any. */
  remove(tx: Transaction, actor: CurrentUserInfo, subject: ImageSubject): Promise<void>;
  /** Nudges the `files.preview` job once the transaction committed. */
  queueRenders(): Promise<void>;
}

/**
 * Lets `files`, which imports `auth`, store users' photos without `auth` importing it (as
 * `AccountNotices` does for notifications).
 */
@Injectable()
export class UserImages {
  private store: ImageStore | undefined;

  register(store: ImageStore): void {
    this.store = store;
  }

  get images(): ImageStore {
    if (!this.store) throw new Error('No image store registered');
    return this.store;
  }
}
