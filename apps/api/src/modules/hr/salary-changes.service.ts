import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ArchiveSalaryChange,
  CreateSalaryChange,
  SalaryChange,
  SalaryChangeList,
} from '@vertex-hub/contracts';
import { type Database, salaryChanges, type Transaction } from '@vertex-hub/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { NotificationCenter } from '../notifications/index.js';
import { fileView } from './employee-access.js';
import { EmployeesService } from './employees.service.js';

type Executor = Database | Transaction;

type SalaryRow = typeof salaryChanges.$inferSelect;

const actorOf = (user: CurrentUserInfo): AuditActor => ({ id: user.id, name: user.name });

/**
 * Rule A4: the salary history, read by the employee and `salaries.read` holders, added and
 * archived by `salaries.manage`, never edited. Amounts go in the audit data, never in a notice.
 */
@Injectable()
export class SalaryChangesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly employees: EmployeesService,
    private readonly center: NotificationCenter,
  ) {}

  async list(actor: CurrentUserInfo, userId: string): Promise<SalaryChangeList> {
    if (!fileView(actor, userId)?.pay) throw new NotFoundException();
    const [profile] = await this.users.profiles({ ids: [userId] });
    if (!profile) throw new NotFoundException();
    const rows = await this.db
      .select()
      .from(salaryChanges)
      .where(eq(salaryChanges.userId, userId))
      .orderBy(desc(salaryChanges.effectiveOn), desc(salaryChanges.createdAt));
    return { items: await this.toResponses(this.db, rows) };
  }

  async create(
    actor: CurrentUserInfo,
    userId: string,
    input: CreateSalaryChange,
  ): Promise<SalaryChange> {
    const row = await this.db.transaction(async (tx) => {
      // The file's lock serializes changes of one employee, so the date check holds.
      await this.employees.lockLive(tx, userId);
      const [taken] = await tx
        .select({ id: salaryChanges.id })
        .from(salaryChanges)
        .where(
          and(
            eq(salaryChanges.userId, userId),
            eq(salaryChanges.effectiveOn, input.effectiveOn),
            isNull(salaryChanges.archivedAt),
          ),
        );
      if (taken) {
        throw new CodedException(
          409,
          'DUPLICATE_EFFECTIVE_DATE',
          'Another salary change is effective on this date',
        );
      }
      const [created] = await tx
        .insert(salaryChanges)
        .values({ userId, ...input, createdById: actor.id })
        .returning();
      if (!created) throw new Error('Salary change not created');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'salary_change.created',
        entityType: 'salary_change',
        entityId: created.id,
        after: { userId, ...input },
      });
      await this.center.notify(tx, {
        type: 'salary_changed',
        data: { effectiveOn: input.effectiveOn },
        recipients: [userId],
        actorId: actor.id,
        subjectId: userId,
      });
      return created;
    });
    return this.toResponse(this.db, row);
  }

  async archive(
    actor: CurrentUserInfo,
    id: string,
    input: ArchiveSalaryChange,
  ): Promise<SalaryChange> {
    const row = await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(salaryChanges)
        .where(eq(salaryChanges.id, id))
        .for('update');
      if (!current) throw new NotFoundException();
      if (current.archivedAt) return current;
      const [archived] = await tx
        .update(salaryChanges)
        .set({ archivedAt: new Date(), archiveReason: input.reason })
        .where(eq(salaryChanges.id, id))
        .returning();
      if (!archived) throw new NotFoundException();
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'salary_change.archived',
        entityType: 'salary_change',
        entityId: id,
        before: { archiveReason: null },
        after: {
          userId: current.userId,
          effectiveOn: current.effectiveOn,
          amountMinor: current.amountMinor,
          archiveReason: input.reason,
        },
      });
      return archived;
    });
    return this.toResponse(this.db, row);
  }

  private async toResponse(executor: Executor, row: SalaryRow): Promise<SalaryChange> {
    const [response] = await this.toResponses(executor, [row]);
    if (!response) throw new NotFoundException();
    return response;
  }

  private async toResponses(executor: Executor, rows: SalaryRow[]): Promise<SalaryChange[]> {
    const names = await this.users.summaries(
      rows.flatMap((row) => (row.createdById ? [row.createdById] : [])),
      executor,
    );
    return rows.map((row) => {
      const creator = row.createdById ? names.get(row.createdById) : undefined;
      return {
        id: row.id,
        userId: row.userId,
        effectiveOn: row.effectiveOn,
        amountMinor: row.amountMinor,
        currency: row.currency,
        reason: row.reason,
        createdBy: creator ? { id: creator.id, name: creator.name } : null,
        createdAt: row.createdAt.toISOString(),
        archivedAt: row.archivedAt?.toISOString() ?? null,
        archiveReason: row.archiveReason,
      };
    });
  }
}
