import { Inject, Injectable } from '@nestjs/common';
import type { TaskStatus } from '@vertex-hub/contracts';
import { type Database, type Transaction, tasks } from '@vertex-hub/db';
import { inArray } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';

/** A task another record links to for display (F12 rule 3). */
export interface TaskLink {
  id: string;
  title: string;
  status: TaskStatus;
  clientId: string | null;
  archived: boolean;
}

/** Tasks as other modules may link to them: title, state and client, never the table. */
@Injectable()
export class TaskLinks {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Tasks by id, archived or not. */
  async summaries(
    ids: string[],
    executor: Database | Transaction = this.db,
  ): Promise<Map<string, TaskLink>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await executor
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        clientId: tasks.clientId,
        archivedAt: tasks.archivedAt,
      })
      .from(tasks)
      .where(inArray(tasks.id, unique));
    return new Map(
      rows.map(({ archivedAt, ...row }) => [row.id, { ...row, archived: !!archivedAt }]),
    );
  }
}
