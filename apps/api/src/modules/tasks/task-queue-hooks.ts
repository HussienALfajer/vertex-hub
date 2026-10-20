import { Injectable } from '@nestjs/common';
import type { Transaction } from '@vertex-hub/db';

/** A task left its department's unassigned queue: it was assigned, cancelled or archived. */
export interface TaskQueueEvent {
  taskId: string;
  actorId: string | null;
}

export type TaskQueueListener = (tx: Transaction, event: TaskQueueEvent) => Promise<void>;

/**
 * Lets `templates` close the managers' `tasks_generated` notice once a run's unassigned tasks are
 * all assigned or closed (F16 part C), without `tasks` importing it. Until a listener
 * registers, nobody hears.
 */
@Injectable()
export class TaskQueueHooks {
  private listener: TaskQueueListener | undefined;

  register(listener: TaskQueueListener): void {
    this.listener = listener;
  }

  async left(tx: Transaction, event: TaskQueueEvent): Promise<void> {
    await this.listener?.(tx, event);
  }
}
