import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  businessDate,
  type CreateProjectExpense,
  type ProjectBilling,
  type UpdateProjectExpense,
} from '@vertex-hub/contracts';
import { type Database, projectExpenses, type Transaction } from '@vertex-hub/db';
import { eq } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { changedFields, recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { type BillingEngagement, BillingSources, EngagementDirectory } from '../projects/index.js';
import { actorOf, covers } from './invoice-access.js';
import { InvoiceBillingService } from './invoice-billing.service.js';
import { InvoiceSettingsService } from './invoice-settings.service.js';

type ExpenseRow = typeof projectExpenses.$inferSelect;

const audited = (row: ExpenseRow) => ({
  spentOn: row.spentOn,
  description: row.description,
  amountMinor: row.amountMinor,
  currency: row.currency,
  sypPerUsd: row.sypPerUsd,
  note: row.note,
});

/**
 * Project expenses (rule 26): added, edited and archived on non-archived projects in any status
 * by `expenses.manage` covering the client. Every change answers the project's billing summary.
 */
@Injectable()
export class ProjectExpensesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly engagements: EngagementDirectory,
    private readonly sources: BillingSources,
    private readonly settings: InvoiceSettingsService,
    private readonly billing: InvoiceBillingService,
  ) {}

  async create(
    actor: CurrentUserInfo,
    projectId: string,
    input: CreateProjectExpense,
  ): Promise<ProjectBilling> {
    await this.db.transaction(async (tx) => {
      const project = await this.writableProject(tx, actor, projectId);
      assertNotFuture(input.spentOn);
      const rate = input.sypPerUsd ?? (await this.settings.row(tx)).sypPerUsd;
      if (!rate) throw new CodedException(409, 'RATE_REQUIRED', 'No exchange rate is set');
      const [row] = await tx
        .insert(projectExpenses)
        .values({
          projectId: project.id,
          spentOn: input.spentOn,
          description: input.description,
          amountMinor: input.amountMinor,
          currency: input.currency ?? project.currency,
          sypPerUsd: rate,
          note: input.note,
          loggedById: actor.id,
        })
        .returning();
      if (!row) throw new Error('The expense was not created');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'project_expense.created',
        entityType: 'project_expense',
        entityId: row.id,
        after: { projectId: project.id, clientId: project.clientId, ...audited(row) },
      });
    });
    return this.billing.projectBilling(actor, projectId);
  }

  async update(
    actor: CurrentUserInfo,
    id: string,
    input: UpdateProjectExpense,
  ): Promise<ProjectBilling> {
    const projectId = await this.db.transaction(async (tx) => {
      const { expense, project } = await this.lockExpense(tx, actor, id);
      if (input.spentOn !== undefined) assertNotFuture(input.spentOn);
      const [updated] = await tx
        .update(projectExpenses)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(projectExpenses.id, id))
        .returning();
      if (!updated) throw new NotFoundException();
      const changes = changedFields(audited(expense), audited(updated));
      if (changes) {
        await recordAudit(tx, {
          actor: actorOf(actor),
          action: 'project_expense.updated',
          entityType: 'project_expense',
          entityId: id,
          before: { projectId: project.id, clientId: project.clientId, ...changes.before },
          after: { projectId: project.id, clientId: project.clientId, ...changes.after },
        });
      }
      return project.id;
    });
    return this.billing.projectBilling(actor, projectId);
  }

  /** Entered by mistake: hidden and out of the margin. */
  async archive(actor: CurrentUserInfo, id: string): Promise<ProjectBilling> {
    const projectId = await this.db.transaction(async (tx) => {
      const { project } = await this.lockExpense(tx, actor, id);
      await tx
        .update(projectExpenses)
        .set({ archivedAt: new Date() })
        .where(eq(projectExpenses.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'project_expense.archived',
        entityType: 'project_expense',
        entityId: id,
        before: { projectId: project.id, clientId: project.clientId, archived: false },
        after: { projectId: project.id, clientId: project.clientId, archived: true },
      });
      return project.id;
    });
    return this.billing.projectBilling(actor, projectId);
  }

  /** A non-archived expense, locked; `INVALID_TRANSITION` once archived. */
  private async lockExpense(
    tx: Transaction,
    actor: CurrentUserInfo,
    id: string,
  ): Promise<{ expense: ExpenseRow; project: BillingEngagement }> {
    const [expense] = await tx
      .select()
      .from(projectExpenses)
      .where(eq(projectExpenses.id, id))
      .for('update');
    if (!expense) throw new NotFoundException();
    const project = await this.writableProject(tx, actor, expense.projectId);
    if (expense.archivedAt) {
      throw new CodedException(409, 'INVALID_TRANSITION', 'The expense is archived');
    }
    return { expense, project };
  }

  /**
   * A project the actor may read (else 404) with `expenses.manage` covering its client (else
   * 403) that is not archived (`PROJECT_ARCHIVED`).
   */
  private async writableProject(
    tx: Transaction,
    actor: CurrentUserInfo,
    projectId: string,
  ): Promise<BillingEngagement> {
    await this.engagements.readableProject(actor, projectId);
    const project = await this.sources.engagement('project', projectId, tx);
    const client = project ? await this.clients.summary(project.clientId, tx) : null;
    if (!project || !client) throw new NotFoundException();
    if (!covers(actor, 'expenses.manage', client)) throw new ForbiddenException();
    if (project.archived) {
      throw new CodedException(409, 'PROJECT_ARCHIVED', 'Expenses are kept on live projects');
    }
    return project;
  }
}

function assertNotFuture(spentOn: string): void {
  if (spentOn > businessDate()) {
    throw new CodedException(400, 'INVALID_DATES', 'The expense date is in the future');
  }
}
