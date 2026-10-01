import { Injectable } from '@nestjs/common';
import type { Transaction } from '@vertex-hub/db';
import { CodedException } from '../../core/errors/index.js';

/** A module that holds tasks and answers which of them may not be cancelled, archived or moved. */
export interface TaskGuard {
  /** The ids among `taskIds` that are held, with the title of what holds them. */
  held(tx: Transaction, taskIds: readonly string[]): Promise<{ taskId: string; title: string }[]>;
}

/**
 * Asked before a task is cancelled, archived or moved to another department (spec F11 rule 9):
 * the `calendar` module registers its scheduled shoots, so `tasks` never imports it. Until a guard
 * registers, nothing is held.
 */
@Injectable()
export class TaskGuards {
  private readonly guards: TaskGuard[] = [];

  register(guard: TaskGuard): void {
    this.guards.push(guard);
  }

  /** `TASK_HAS_SHOOT` (409) listing what holds the tasks, when anything does. */
  async assertFree(tx: Transaction, taskIds: readonly string[]): Promise<void> {
    if (taskIds.length === 0) return;
    const held: { taskId: string; title: string }[] = [];
    for (const guard of this.guards) held.push(...(await guard.held(tx, taskIds)));
    if (held.length > 0) {
      throw new CodedException(
        409,
        'TASK_HAS_SHOOT',
        'A scheduled shoot holds the task: cancel the shoot first',
        held,
      );
    }
  }
}
