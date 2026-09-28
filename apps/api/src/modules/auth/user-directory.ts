import { Inject, Injectable } from '@nestjs/common';
import { type Database, type Transaction, userRoles, users } from '@vertex-hub/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';

export interface UserSummary {
  id: string;
  name: string;
  archived: boolean;
}

/** Users as other modules may see them: names, status and roles, never the tables. */
@Injectable()
export class UserDirectory {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Names of the given users, archived ones included. */
  async summaries(ids: string[], executor: Database | Transaction = this.db) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map<string, UserSummary>();
    const rows = await executor
      .select({ id: users.id, name: users.name, archivedAt: users.archivedAt })
      .from(users)
      .where(inArray(users.id, unique));
    return new Map<string, UserSummary>(
      rows.map((row) => [row.id, { id: row.id, name: row.name, archived: !!row.archivedAt }]),
    );
  }

  /** A non-archived user who holds the Account Manager role; an invited user qualifies. */
  async accountManager(
    userId: string,
    executor: Database | Transaction = this.db,
  ): Promise<UserSummary | null> {
    const [row] = await executor
      .select({ id: users.id, name: users.name })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .where(
        and(eq(users.id, userId), eq(userRoles.role, 'account_manager'), isNull(users.archivedAt)),
      );
    return row ? { ...row, archived: false } : null;
  }
}
