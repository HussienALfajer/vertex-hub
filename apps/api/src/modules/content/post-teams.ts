import { Inject, Injectable } from '@nestjs/common';
import { OPEN_POST_STATUSES } from '@vertex-hub/contracts';
import { contentPosts, type Database, type Transaction } from '@vertex-hub/db';
import { and, inArray, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';

/** Who works on a client's content, as other modules may see it: never the table. */
@Injectable()
export class PostTeams {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** F16 rule D1: the responsible persons of the clients' open, non-archived posts. */
  async openResponsibles(
    clientIds: readonly string[],
    executor: Database | Transaction = this.db,
  ): Promise<string[]> {
    if (clientIds.length === 0) return [];
    const rows = await executor
      .selectDistinct({ id: contentPosts.responsibleId })
      .from(contentPosts)
      .where(
        and(
          inArray(contentPosts.clientId, [...clientIds]),
          inArray(contentPosts.status, [...OPEN_POST_STATUSES]),
          isNull(contentPosts.archivedAt),
        ),
      );
    return rows.map((row) => row.id);
  }
}
