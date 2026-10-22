import { Injectable } from '@nestjs/common';
import type { FieldWorkKind } from '@vertex-hub/contracts';
import type { Database, Transaction } from '@vertex-hub/db';

type Executor = Database | Transaction;

/** The titles of one kind's records, by id; missing ids are left out. */
export type FieldWorkTitles = (
  executor: Executor,
  ids: readonly string[],
) => Promise<Map<string, string>>;

/**
 * Rule C11: a field punch may name a task or a meeting. `tasks` and `calendar` register how their
 * titles are read, so `hr` imports neither; the choices come from `LeaveWorkSources`.
 */
@Injectable()
export class AttendanceFieldWork {
  private readonly sources = new Map<FieldWorkKind, FieldWorkTitles>();

  register(kind: FieldWorkKind, titles: FieldWorkTitles): void {
    this.sources.set(kind, titles);
  }

  titles(executor: Executor, kind: FieldWorkKind, ids: readonly string[]) {
    const source = this.sources.get(kind);
    if (ids.length === 0 || !source) return Promise.resolve(new Map<string, string>());
    return source(executor, ids);
  }
}
