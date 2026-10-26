import { Injectable, NotFoundException } from '@nestjs/common';
import type { DepartmentCode } from '@vertex-hub/contracts';
import type { Transaction } from '@vertex-hub/db';
import type { AuditActor } from '../audit/index.js';

/** A task created from a task template's draft (F06B rule D2), with its new subtasks in order. */
export interface TaskTemplateUse {
  templateId: string;
  actor: AuditActor;
  taskId: string;
  subtasks: { id: string; title: string; department: DepartmentCode }[];
}

export type TaskTemplateListener = (tx: Transaction, use: TaskTemplateUse) => Promise<void>;

/**
 * Lets `templates` record the run of a task template (F07's `template_runs`) in the transaction
 * that creates the task, without `tasks` importing it. The listener answers 404 or
 * `TEMPLATE_KIND` for a template the draft cannot come from; without one, no template is known.
 */
@Injectable()
export class TaskTemplateHooks {
  private listener: TaskTemplateListener | undefined;

  register(listener: TaskTemplateListener): void {
    this.listener = listener;
  }

  async used(tx: Transaction, use: TaskTemplateUse): Promise<void> {
    if (!this.listener) throw new NotFoundException();
    await this.listener(tx, use);
  }
}
