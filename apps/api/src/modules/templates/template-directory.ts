import { Inject, Injectable } from '@nestjs/common';
import type { TemplateKind } from '@vertex-hub/contracts';
import { type Database, type Transaction, workTemplates } from '@vertex-hub/db';
import { inArray } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';

export interface TemplateSummary {
  id: string;
  name: string;
  kind: TemplateKind;
  archived: boolean;
}

/** Templates as other modules may see them (F04): name, kind and archived state. Never the tables. */
@Injectable()
export class TemplateDirectory {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Templates by id, archived or not. */
  async summaries(ids: (string | null)[], executor: Database | Transaction = this.db) {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (unique.length === 0) return new Map<string, TemplateSummary>();
    const rows = await executor
      .select({
        id: workTemplates.id,
        name: workTemplates.name,
        kind: workTemplates.kind,
        archivedAt: workTemplates.archivedAt,
      })
      .from(workTemplates)
      .where(inArray(workTemplates.id, unique));
    return new Map(
      rows.map((row) => [
        row.id,
        { id: row.id, name: row.name, kind: row.kind, archived: !!row.archivedAt },
      ]),
    );
  }
}
