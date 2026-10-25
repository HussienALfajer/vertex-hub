import { Injectable } from '@nestjs/common';

/** The current photo of each user id given, null without one (F01C). */
export type ActorPhotoSource = (ids: readonly string[]) => Promise<Map<string, string | null>>;

/**
 * The actors' photos on the audit screen: `auth` registers its users here, since it imports
 * `audit` for `recordAudit` and `audit` cannot import it back (as `UserImages` does for `files`).
 */
@Injectable()
export class AuditActorPhotos {
  private source: ActorPhotoSource | undefined;

  register(source: ActorPhotoSource): void {
    this.source = source;
  }

  async of(ids: readonly string[]): Promise<Map<string, string | null>> {
    return ids.length > 0 && this.source ? this.source(ids) : new Map();
  }
}
