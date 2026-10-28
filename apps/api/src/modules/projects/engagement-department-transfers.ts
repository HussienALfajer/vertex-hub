import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type DepartmentCode, OPEN_PROJECT_STATUSES } from '@vertex-hub/contracts';
import { projects, retainers, type Transaction } from '@vertex-hub/db';
import { and, arrayContains, asc, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { DepartmentTransfers, type TransferPreview } from '../auth/index.js';

const PREVIEW_ITEMS = 5;

const openProjectsOf = (code: DepartmentCode) =>
  and(
    arrayContains(projects.departments, [code]),
    inArray(projects.status, [...OPEN_PROJECT_STATUSES]),
    isNull(projects.archivedAt),
  ) as SQL;

const liveRetainersOf = (code: DepartmentCode) =>
  and(
    arrayContains(retainers.departments, [code]),
    inArray(retainers.status, ['active', 'paused']),
    isNull(retainers.archivedAt),
  ) as SQL;

/** The list with `from` replaced by `to`, without a duplicate when `to` is already there. */
const replaced = (list: readonly DepartmentCode[], from: DepartmentCode, to: DepartmentCode) => [
  ...new Set(list.map((code) => (code === from ? to : code))),
];

/**
 * F23 rule 10: open projects and active or paused retainers replace an archived department with
 * the engagements target in their departments; closed projects and ended retainers keep it.
 */
@Injectable()
export class EngagementDepartmentTransfers implements OnModuleInit {
  constructor(private readonly transfers: DepartmentTransfers) {}

  onModuleInit(): void {
    this.transfers.register({
      category: 'engagements',
      preview: (tx, code) => this.preview(tx, code),
      move: (tx, from, to, actor) => this.move(tx, from, to, actor),
    });
  }

  private async preview(tx: Transaction, code: DepartmentCode): Promise<TransferPreview> {
    const project = await tx
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(openProjectsOf(code))
      .orderBy(asc(projects.name), asc(projects.id));
    const retainer = await tx
      .select({ id: retainers.id, name: retainers.name })
      .from(retainers)
      .where(liveRetainersOf(code))
      .orderBy(asc(retainers.name), asc(retainers.id));
    const all = [...project, ...retainer];
    return { count: all.length, items: all.slice(0, PREVIEW_ITEMS) };
  }

  private async move(
    tx: Transaction,
    from: DepartmentCode,
    to: DepartmentCode,
    actor: AuditActor,
  ): Promise<number> {
    const open = await tx
      .select({ id: projects.id, departments: projects.departments })
      .from(projects)
      .where(openProjectsOf(from))
      .for('update');
    for (const project of open) {
      const departments = replaced(project.departments, from, to);
      await tx.update(projects).set({ departments }).where(eq(projects.id, project.id));
      await recordAudit(tx, {
        actor,
        action: 'project.updated',
        entityType: 'project',
        entityId: project.id,
        before: { departments: project.departments },
        after: { departments, reason: 'department_archived' },
      });
    }
    const live = await tx
      .select({ id: retainers.id, departments: retainers.departments })
      .from(retainers)
      .where(liveRetainersOf(from))
      .for('update');
    for (const retainer of live) {
      const departments = replaced(retainer.departments, from, to);
      await tx.update(retainers).set({ departments }).where(eq(retainers.id, retainer.id));
      await recordAudit(tx, {
        actor,
        action: 'retainer.updated',
        entityType: 'retainer',
        entityId: retainer.id,
        before: { departments: retainer.departments },
        after: { departments, reason: 'department_archived' },
      });
    }
    return open.length + live.length;
  }
}
