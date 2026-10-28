import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { DepartmentCode } from '@vertex-hub/contracts';
import {
  type Transaction,
  workTemplateAssignees,
  workTemplateSteps,
  workTemplates,
} from '@vertex-hub/db';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { DepartmentTransfers, type TransferPreview, UserDirectory } from '../auth/index.js';

const PREVIEW_ITEMS = 5;

const activeTemplates = (tx: Transaction) =>
  tx.select({ id: workTemplates.id }).from(workTemplates).where(isNull(workTemplates.archivedAt));

/**
 * F23 rule 10 and edge case 7: the steps of active templates move to the templates target; a
 * default assignee moves with them when the template has none for the target and the person is a
 * member of the target after the move (members move first), otherwise the row goes and those
 * steps go to the target's queue, as F07 does.
 */
@Injectable()
export class TemplateDepartmentTransfers implements OnModuleInit {
  constructor(
    private readonly transfers: DepartmentTransfers,
    private readonly users: UserDirectory,
  ) {}

  onModuleInit(): void {
    this.transfers.register({
      category: 'templates',
      preview: (tx, code) => this.preview(tx, code),
      move: (tx, from, to, actor) => this.move(tx, from, to, actor),
    });
  }

  /** Counts steps and default-assignee rows; lists the templates. */
  private async preview(tx: Transaction, code: DepartmentCode): Promise<TransferPreview> {
    const [steps] = await tx
      .select({ value: sql<number>`count(*)::int` })
      .from(workTemplateSteps)
      .where(
        and(
          eq(workTemplateSteps.department, code),
          inArray(workTemplateSteps.templateId, activeTemplates(tx)),
        ),
      );
    const [assignees] = await tx
      .select({ value: sql<number>`count(*)::int` })
      .from(workTemplateAssignees)
      .where(
        and(
          eq(workTemplateAssignees.department, code),
          inArray(workTemplateAssignees.templateId, activeTemplates(tx)),
        ),
      );
    const items = await tx
      .select({ id: workTemplates.id, name: workTemplates.name })
      .from(workTemplates)
      .where(
        and(
          isNull(workTemplates.archivedAt),
          or(
            inArray(
              workTemplates.id,
              tx
                .select({ id: workTemplateSteps.templateId })
                .from(workTemplateSteps)
                .where(eq(workTemplateSteps.department, code)),
            ),
            inArray(
              workTemplates.id,
              tx
                .select({ id: workTemplateAssignees.templateId })
                .from(workTemplateAssignees)
                .where(eq(workTemplateAssignees.department, code)),
            ),
          ),
        ),
      )
      .orderBy(asc(workTemplates.name), asc(workTemplates.id))
      .limit(PREVIEW_ITEMS);
    return { count: (steps?.value ?? 0) + (assignees?.value ?? 0), items };
  }

  /** One `template.updated` entry per template touched. */
  private async move(
    tx: Transaction,
    from: DepartmentCode,
    to: DepartmentCode,
    actor: AuditActor,
  ): Promise<number> {
    const steps = await tx
      .update(workTemplateSteps)
      .set({ department: to })
      .where(
        and(
          eq(workTemplateSteps.department, from),
          inArray(workTemplateSteps.templateId, activeTemplates(tx)),
        ),
      )
      .returning({ templateId: workTemplateSteps.templateId });
    const rows = await tx
      .select({
        templateId: workTemplateAssignees.templateId,
        userId: workTemplateAssignees.userId,
      })
      .from(workTemplateAssignees)
      .where(
        and(
          eq(workTemplateAssignees.department, from),
          inArray(workTemplateAssignees.templateId, activeTemplates(tx)),
        ),
      );
    const assignees = new Map<string, { before: string; after: string | null }>();
    for (const row of rows) {
      const [taken] = await tx
        .select({ userId: workTemplateAssignees.userId })
        .from(workTemplateAssignees)
        .where(
          and(
            eq(workTemplateAssignees.templateId, row.templateId),
            eq(workTemplateAssignees.department, to),
          ),
        );
      const stays = !taken && (await this.users.activeMember(row.userId, to, tx)) !== null;
      const current = and(
        eq(workTemplateAssignees.templateId, row.templateId),
        eq(workTemplateAssignees.department, from),
      );
      if (stays) {
        await tx.update(workTemplateAssignees).set({ department: to }).where(current);
      } else {
        await tx.delete(workTemplateAssignees).where(current);
      }
      assignees.set(row.templateId, { before: row.userId, after: stays ? row.userId : null });
    }
    const touched = new Set([...steps.map((step) => step.templateId), ...assignees.keys()]);
    for (const templateId of touched) {
      const assignee = assignees.get(templateId);
      await recordAudit(tx, {
        actor,
        action: 'template.updated',
        entityType: 'template',
        entityId: templateId,
        before: { department: from, ...(assignee && { assigneeId: assignee.before }) },
        after: {
          department: to,
          ...(assignee && { assigneeId: assignee.after }),
          reason: 'department_archived',
        },
      });
    }
    return steps.length + [...assignees.values()].filter((row) => row.after).length;
  }
}
