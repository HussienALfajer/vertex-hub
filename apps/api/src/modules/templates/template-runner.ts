import { Injectable } from '@nestjs/common';
import type { CalendarDate } from '@vertex-hub/contracts';
import type { Transaction } from '@vertex-hub/db';
import type { CurrentUserInfo } from '../auth/index.js';
import { TemplateRunsService } from './template-runs.service.js';

/** What a project template would create on a new project (F04 A2–A3). */
export interface NewProjectPlan {
  /** Its stages that steps use, in order, each due on its latest task's day (F07 rule 13). */
  milestones: { name: string; dueDate: CalendarDate }[];
  /** The latest due date of its tasks; null without steps. */
  lastDue: CalendarDate | null;
}

/**
 * Template runs for other modules (spec F04, A01): plans and applies project templates and links
 * monthly templates inside the caller's transaction, with F07's rules, audit and notifications.
 */
@Injectable()
export class TemplateRunner {
  constructor(private readonly runs: TemplateRunsService) {}

  /**
   * Non-archived project templates only; the others are left out of the map. Reads in `tx` when
   * given, so an acceptance plans and applies from one snapshot.
   */
  planNewProject(
    templateIds: string[],
    startDate: CalendarDate,
    tx?: Transaction,
  ): Promise<Map<string, NewProjectPlan>> {
    return this.runs.planNewProject(templateIds, startDate, tx);
  }

  /** A4: default assignees, every task with `revisionLimit`; the caller locked access changes. */
  applyToProject(
    tx: Transaction,
    actor: CurrentUserInfo,
    templateId: string,
    projectId: string,
    revisionLimit: number,
  ): Promise<string> {
    return this.runs.applyInTransaction(tx, actor, templateId, projectId, revisionLimit);
  }

  /** A5, A7: links a monthly template to a retainer the caller locked as workable. */
  linkRetainerTemplate(
    tx: Transaction,
    actor: CurrentUserInfo,
    retainerId: string,
    templateId: string,
  ): Promise<void> {
    return this.runs.linkInTransaction(tx, actor, retainerId, templateId);
  }
}
