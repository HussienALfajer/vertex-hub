import { Injectable } from '@nestjs/common';
import type { TaskCounts } from '@vertex-hub/contracts';

/**
 * Task counts per project and milestone, reported by the module that owns tasks (F06). Maps
 * leave out ids without tasks.
 */
export interface WorkProgressSource {
  projects(ids: string[]): Promise<Map<string, TaskCounts>>;
  milestones(ids: string[]): Promise<Map<string, TaskCounts>>;
}

export const NO_TASKS: TaskCounts = { total: 0, delivered: 0, open: 0 };

/**
 * Lets the `tasks` module feed progress into projects without `projects` importing it (spec F05,
 * "Links F06 fills"). Until a source registers, every count is 0.
 */
@Injectable()
export class WorkProgress {
  private source: WorkProgressSource | undefined;

  register(source: WorkProgressSource): void {
    this.source = source;
  }

  async projects(ids: string[]): Promise<Map<string, TaskCounts>> {
    return ids.length && this.source ? this.source.projects(ids) : new Map();
  }

  async milestones(ids: string[]): Promise<Map<string, TaskCounts>> {
    return ids.length && this.source ? this.source.milestones(ids) : new Map();
  }
}

/** Delivered tasks ÷ tasks as a whole percentage rounded down; null without tasks (rule 9). */
export const progressOf = (counts: TaskCounts): number | null =>
  counts.total === 0 ? null : Math.floor((counts.delivered * 100) / counts.total);
