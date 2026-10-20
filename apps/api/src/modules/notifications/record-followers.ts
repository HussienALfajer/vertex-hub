import { Inject, Injectable } from '@nestjs/common';
import type { Following, FollowSubject } from '@vertex-hub/contracts';
import { type Database, recordFollowers } from '@vertex-hub/db';
import { and, count, eq } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';

/** A followed record: a task or a post (F16 rule B12). */
export interface FollowedRecord {
  type: FollowSubject;
  id: string;
}

/**
 * F16 rule B12: who follows a task or a post. The owning module checks that the user may read the
 * record before calling; an unfollow is kept as `following` false, so automatic following does not
 * add the user back. Personal rows: never audited.
 */
@Injectable()
export class RecordFollowers {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async following(record: FollowedRecord, userId: string): Promise<Following> {
    const [[row], [total]] = await Promise.all([
      this.db
        .select({ following: recordFollowers.following })
        .from(recordFollowers)
        .where(and(this.of(record), eq(recordFollowers.userId, userId))),
      this.db
        .select({ value: count() })
        .from(recordFollowers)
        .where(and(this.of(record), eq(recordFollowers.following, true))),
    ]);
    return { following: row?.following ?? false, followers: total?.value ?? 0 };
  }

  /** Following or unfollowing by hand. */
  async setFollowing(
    record: FollowedRecord,
    userId: string,
    following: boolean,
  ): Promise<Following> {
    await this.db
      .insert(recordFollowers)
      .values({
        subjectType: record.type,
        subjectId: record.id,
        userId,
        following,
        source: 'manual',
      })
      .onConflictDoUpdate({
        target: [recordFollowers.subjectType, recordFollowers.subjectId, recordFollowers.userId],
        set: { following, source: 'manual', updatedAt: new Date() },
      });
    return this.following(record, userId);
  }

  private of(record: FollowedRecord) {
    return and(
      eq(recordFollowers.subjectType, record.type),
      eq(recordFollowers.subjectId, record.id),
    );
  }
}
