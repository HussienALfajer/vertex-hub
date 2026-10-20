import { Inject, Injectable } from '@nestjs/common';
import {
  type Following,
  type FollowSubject,
  type Permission,
  permissionScopes,
} from '@vertex-hub/contracts';
import { type Database, recordFollowers, type Transaction } from '@vertex-hub/db';
import { and, count, eq } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { UserDirectory } from '../auth/index.js';

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
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
  ) {}

  /**
   * Automatic following, in the transaction of the change that makes the users follow (the
   * creator, the assignee, a commenter): a user who unfollowed stays out.
   */
  async follow(
    tx: Transaction,
    record: FollowedRecord,
    userIds: readonly (string | null)[],
  ): Promise<void> {
    const ids = [...new Set(userIds.filter((id): id is string => !!id))];
    if (ids.length === 0) return;
    await tx
      .insert(recordFollowers)
      .values(
        ids.map((userId) => ({
          subjectType: record.type,
          subjectId: record.id,
          userId,
          following: true,
          source: 'auto' as const,
        })),
      )
      .onConflictDoNothing();
  }

  /**
   * The followers who still receive (rule B12, edge case 13): following, not archived, and
   * holding `permission` (the record's read permission) over every record, as reading it needs.
   */
  async recipients(
    tx: Transaction,
    record: FollowedRecord,
    permission: Permission,
  ): Promise<string[]> {
    const rows = await tx
      .select({ userId: recordFollowers.userId })
      .from(recordFollowers)
      .where(and(this.of(record), eq(recordFollowers.following, true)));
    const readers: string[] = [];
    for (const { userId } of rows) {
      const access = await this.users.access(userId, tx);
      if (access && permissionScopes(access, permission).includes('all')) readers.push(userId);
    }
    return readers;
  }

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
