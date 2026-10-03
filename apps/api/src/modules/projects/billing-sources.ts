import { Inject, Injectable } from '@nestjs/common';
import type {
  Currency,
  CycleStatus,
  ExtraWorkBilling,
  InvoiceSource,
  InvoiceSourceType,
  MilestoneStatus,
} from '@vertex-hub/contracts';
import {
  type Database,
  extraWorkItems,
  projectMilestones,
  projects,
  retainerCycles,
  retainers,
  type Transaction,
} from '@vertex-hub/db';
import { and, asc, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { type AuditActor, recordAudit } from '../audit/index.js';

type Executor = Database | Transaction;

/** The project or retainer an invoice bills, with what an invoice checks on it (F13). */
export interface BillingEngagement {
  type: 'project' | 'retainer';
  id: string;
  name: string;
  clientId: string;
  currency: Currency;
  archived: boolean;
}

/** A milestone, cycle or extra work item as an invoice line bills it (F13 rules 2–6). */
export interface BillingSource {
  type: InvoiceSourceType;
  id: string;
  /** The milestone or extra work name; the cycle's month for a cycle. */
  name: string;
  /** The default line text: "<engagement> — <milestone or month>", or the extra work title. */
  description: string;
  /** The installment, the retainer's current fee or the estimate; null when it has none. */
  amountMinor: number | null;
  archived: boolean;
  /** Extra work only. */
  billingStatus: ExtraWorkBilling | null;
  engagement: BillingEngagement;
}

/** Billable work of one client in one currency, before the invoices that hold it are removed. */
export interface BillableWork {
  milestones: {
    id: string;
    project: { id: string; name: string };
    name: string;
    status: MilestoneStatus;
    installmentMinor: number;
  }[];
  cycles: {
    id: string;
    retainer: { id: string; name: string };
    month: string;
    feeMinor: number | null;
  }[];
  extraWork: {
    id: string;
    project: { id: string; name: string } | null;
    retainer: { id: string; name: string } | null;
    title: string;
    estimateMinor: number | null;
  }[];
}

/** A milestone on a project's billing summary (F13). */
export interface BillingMilestone {
  id: string;
  name: string;
  status: MilestoneStatus;
  dueDate: string | null;
  installmentMinor: number | null;
}

/** What a retainer's billing summary lists (F13). */
export interface RetainerWork {
  monthlyFeeMinor: number | null;
  cycles: { id: string; month: string; status: CycleStatus }[];
  extraWork: {
    id: string;
    title: string;
    billingStatus: ExtraWorkBilling;
    estimateMinor: number | null;
  }[];
}

/** "تشرين الأول 2026" for a cycle month (Syrian month names, Latin digits). */
const monthName = new Intl.DateTimeFormat('ar-SY-u-nu-latn', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

export const cycleMonthName = (month: string) => monthName.format(new Date(`${month}T00:00:00Z`));

/** The map key of a source in `BillingSources.resolve`. */
export const sourceKey = (source: InvoiceSource) => `${source.type}:${source.id}`;

/**
 * What the `invoices` module bills from projects and retainers (F13): milestone installments,
 * retainer cycles and extra work, their engagements, and the extra work billing status that
 * issuing and voiding set. Never the tables.
 */
@Injectable()
export class BillingSources {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Projects and retainers by id, archived or not. */
  async engagement(
    type: 'project' | 'retainer',
    id: string,
    executor: Executor = this.db,
  ): Promise<BillingEngagement | null> {
    const table = type === 'project' ? projects : retainers;
    const [row] = await executor
      .select({
        id: table.id,
        name: table.name,
        clientId: table.clientId,
        currency: table.currency,
        archivedAt: table.archivedAt,
      })
      .from(table)
      .where(eq(table.id, id));
    return row ? { type, ...withoutArchivedAt(row) } : null;
  }

  async engagements(
    refs: { projectIds: string[]; retainerIds: string[] },
    executor: Executor = this.db,
  ): Promise<Map<string, BillingEngagement>> {
    const result = new Map<string, BillingEngagement>();
    for (const type of ['project', 'retainer'] as const) {
      const ids = [...new Set(type === 'project' ? refs.projectIds : refs.retainerIds)];
      if (ids.length === 0) continue;
      const table = type === 'project' ? projects : retainers;
      const rows = await executor
        .select({
          id: table.id,
          name: table.name,
          clientId: table.clientId,
          currency: table.currency,
          archivedAt: table.archivedAt,
        })
        .from(table)
        .where(inArray(table.id, ids));
      for (const row of rows) result.set(row.id, { type, ...withoutArchivedAt(row) });
    }
    return result;
  }

  /**
   * The sources by `type:id`; unknown ones are missing from the map. With `lock`, inside a
   * transaction, milestone and extra work rows are locked `FOR SHARE` until it ends, so drafting
   * waits for, and is waited on by, the changes rule 25 refuses (F13).
   */
  async resolve(
    sources: readonly InvoiceSource[],
    executor: Executor = this.db,
    options: { lock?: boolean } = {},
  ): Promise<Map<string, BillingSource>> {
    const ids = (type: InvoiceSourceType) => [
      ...new Set(sources.filter((source) => source.type === type).map((source) => source.id)),
    ];
    const result = new Map<string, BillingSource>();
    const milestoneIds = ids('milestone');
    if (milestoneIds.length) {
      const query = executor
        .select({
          id: projectMilestones.id,
          name: projectMilestones.name,
          installmentMinor: projectMilestones.installmentMinor,
          archivedAt: projectMilestones.archivedAt,
          engagement: engagementColumns(projects),
        })
        .from(projectMilestones)
        .innerJoin(projects, eq(projects.id, projectMilestones.projectId))
        .where(inArray(projectMilestones.id, milestoneIds));
      const rows = options.lock ? await query.for('share', { of: projectMilestones }) : await query;
      for (const row of rows) {
        const engagement: BillingEngagement = {
          type: 'project',
          ...withoutArchivedAt(row.engagement),
        };
        result.set(sourceKey({ type: 'milestone', id: row.id }), {
          type: 'milestone',
          id: row.id,
          name: row.name,
          description: `${engagement.name} — ${row.name}`,
          amountMinor: row.installmentMinor,
          archived: !!row.archivedAt,
          billingStatus: null,
          engagement,
        });
      }
    }
    const cycleIds = ids('retainer_cycle');
    if (cycleIds.length) {
      const rows = await executor
        .select({
          id: retainerCycles.id,
          month: retainerCycles.month,
          feeMinor: retainers.monthlyFeeMinor,
          engagement: engagementColumns(retainers),
        })
        .from(retainerCycles)
        .innerJoin(retainers, eq(retainers.id, retainerCycles.retainerId))
        .where(inArray(retainerCycles.id, cycleIds));
      for (const row of rows) {
        const engagement: BillingEngagement = {
          type: 'retainer',
          ...withoutArchivedAt(row.engagement),
        };
        const month = cycleMonthName(row.month);
        result.set(sourceKey({ type: 'retainer_cycle', id: row.id }), {
          type: 'retainer_cycle',
          id: row.id,
          name: month,
          description: `${engagement.name} — ${month}`,
          amountMinor: row.feeMinor,
          archived: false,
          billingStatus: null,
          engagement,
        });
      }
    }
    const extraIds = ids('extra_work');
    if (extraIds.length) {
      const query = executor
        .select({
          id: extraWorkItems.id,
          title: extraWorkItems.title,
          estimateMinor: extraWorkItems.estimateMinor,
          billingStatus: extraWorkItems.billingStatus,
          archivedAt: extraWorkItems.archivedAt,
          projectId: extraWorkItems.projectId,
          retainerId: extraWorkItems.retainerId,
        })
        .from(extraWorkItems)
        .where(inArray(extraWorkItems.id, extraIds));
      const rows = options.lock ? await query.for('share') : await query;
      const engagements = await this.engagements(
        {
          projectIds: rows.flatMap((row) => (row.projectId ? [row.projectId] : [])),
          retainerIds: rows.flatMap((row) => (row.retainerId ? [row.retainerId] : [])),
        },
        executor,
      );
      for (const row of rows) {
        const engagement = engagements.get(row.projectId ?? row.retainerId ?? '');
        if (!engagement) continue;
        result.set(sourceKey({ type: 'extra_work', id: row.id }), {
          type: 'extra_work',
          id: row.id,
          name: row.title,
          description: row.title.slice(0, 300),
          amountMinor: row.estimateMinor,
          archived: !!row.archivedAt,
          billingStatus: row.billingStatus,
          engagement,
        });
      }
    }
    return result;
  }

  /**
   * F13 rule 6: the client's non-archived milestones with an installment, cycles and unbilled
   * extra work of its non-archived projects and retainers in `currency`.
   */
  async billable(clientId: string, currency: Currency): Promise<BillableWork> {
    const liveProject = and(
      eq(projects.clientId, clientId),
      eq(projects.currency, currency),
      isNull(projects.archivedAt),
    );
    const liveRetainer = and(
      eq(retainers.clientId, clientId),
      eq(retainers.currency, currency),
      isNull(retainers.archivedAt),
    );
    const [milestones, cycles, projectWork, retainerWork] = await Promise.all([
      this.db
        .select({
          id: projectMilestones.id,
          projectId: projects.id,
          projectName: projects.name,
          name: projectMilestones.name,
          status: projectMilestones.status,
          installmentMinor: projectMilestones.installmentMinor,
        })
        .from(projectMilestones)
        .innerJoin(projects, eq(projects.id, projectMilestones.projectId))
        .where(
          and(
            liveProject,
            isNull(projectMilestones.archivedAt),
            gt(projectMilestones.installmentMinor, 0),
          ),
        )
        .orderBy(asc(projects.name), asc(projectMilestones.position)),
      this.db
        .select({
          id: retainerCycles.id,
          retainerId: retainers.id,
          retainerName: retainers.name,
          month: retainerCycles.month,
          feeMinor: retainers.monthlyFeeMinor,
        })
        .from(retainerCycles)
        .innerJoin(retainers, eq(retainers.id, retainerCycles.retainerId))
        .where(liveRetainer)
        .orderBy(asc(retainers.name), desc(retainerCycles.month)),
      this.db
        .select({
          id: extraWorkItems.id,
          ownerId: projects.id,
          ownerName: projects.name,
          title: extraWorkItems.title,
          estimateMinor: extraWorkItems.estimateMinor,
          requestedOn: extraWorkItems.requestedOn,
        })
        .from(extraWorkItems)
        .innerJoin(projects, eq(projects.id, extraWorkItems.projectId))
        .where(and(liveProject, unbilledWork)),
      this.db
        .select({
          id: extraWorkItems.id,
          ownerId: retainers.id,
          ownerName: retainers.name,
          title: extraWorkItems.title,
          estimateMinor: extraWorkItems.estimateMinor,
          requestedOn: extraWorkItems.requestedOn,
        })
        .from(extraWorkItems)
        .innerJoin(retainers, eq(retainers.id, extraWorkItems.retainerId))
        .where(and(liveRetainer, unbilledWork)),
    ]);
    const owner = (row: { ownerId: string; ownerName: string }) => ({
      id: row.ownerId,
      name: row.ownerName,
    });
    return {
      milestones: milestones.map((row) => ({
        id: row.id,
        project: { id: row.projectId, name: row.projectName },
        name: row.name,
        status: row.status,
        installmentMinor: row.installmentMinor ?? 0,
      })),
      cycles: cycles.map((row) => ({
        id: row.id,
        retainer: { id: row.retainerId, name: row.retainerName },
        month: row.month,
        feeMinor: row.feeMinor,
      })),
      extraWork: [
        ...projectWork.map((row) => ({ ...row, project: owner(row), retainer: null })),
        ...retainerWork.map((row) => ({ ...row, project: null, retainer: owner(row) })),
      ]
        .sort((a, b) => b.requestedOn.localeCompare(a.requestedOn) || a.id.localeCompare(b.id))
        .map((row) => ({
          id: row.id,
          project: row.project,
          retainer: row.retainer,
          title: row.title,
          estimateMinor: row.estimateMinor,
        })),
    };
  }

  /** F13 project billing: the project's non-archived milestones by position. */
  async projectMilestones(projectId: string): Promise<BillingMilestone[]> {
    return this.db
      .select({
        id: projectMilestones.id,
        name: projectMilestones.name,
        status: projectMilestones.status,
        dueDate: projectMilestones.dueDate,
        installmentMinor: projectMilestones.installmentMinor,
      })
      .from(projectMilestones)
      .where(and(eq(projectMilestones.projectId, projectId), isNull(projectMilestones.archivedAt)))
      .orderBy(asc(projectMilestones.position), asc(projectMilestones.id));
  }

  /**
   * F13 retainer billing: the retainer's current fee, its cycles (newest month first) and its
   * non-archived extra work (newest first).
   */
  async retainerWork(retainerId: string): Promise<RetainerWork> {
    const [[retainer], cycles, extraWork] = await Promise.all([
      this.db
        .select({ monthlyFeeMinor: retainers.monthlyFeeMinor })
        .from(retainers)
        .where(eq(retainers.id, retainerId)),
      this.db
        .select({
          id: retainerCycles.id,
          month: retainerCycles.month,
          status: retainerCycles.status,
        })
        .from(retainerCycles)
        .where(eq(retainerCycles.retainerId, retainerId))
        .orderBy(desc(retainerCycles.month)),
      this.db
        .select({
          id: extraWorkItems.id,
          title: extraWorkItems.title,
          billingStatus: extraWorkItems.billingStatus,
          estimateMinor: extraWorkItems.estimateMinor,
        })
        .from(extraWorkItems)
        .where(and(eq(extraWorkItems.retainerId, retainerId), isNull(extraWorkItems.archivedAt)))
        .orderBy(desc(extraWorkItems.requestedOn), asc(extraWorkItems.id)),
    ]);
    return { monthlyFeeMinor: retainer?.monthlyFeeMinor ?? null, cycles, extraWork };
  }

  /**
   * F13 rules 11 and 14: issuing an invoice bills its extra work, voiding it returns the work to
   * `unbilled`; audited as F05's `extra_work.billing_changed` with the invoice's number.
   */
  async setExtraWorkBilling(
    tx: Transaction,
    ids: string[],
    status: 'billed' | 'unbilled',
    invoiceNumber: string,
    actor: AuditActor | null,
  ): Promise<void> {
    if (ids.length === 0) return;
    const rows = await tx
      .select({
        id: extraWorkItems.id,
        billingStatus: extraWorkItems.billingStatus,
        billingNote: extraWorkItems.billingNote,
        projectId: extraWorkItems.projectId,
        retainerId: extraWorkItems.retainerId,
      })
      .from(extraWorkItems)
      .where(inArray(extraWorkItems.id, ids))
      .for('update');
    const billingNote = status === 'billed' ? invoiceNumber : null;
    for (const row of rows) {
      if (row.billingStatus === status && row.billingNote === billingNote) continue;
      await tx
        .update(extraWorkItems)
        .set({ billingStatus: status, billingNote })
        .where(eq(extraWorkItems.id, row.id));
      await recordAudit(tx, {
        actor,
        action: 'extra_work.billing_changed',
        entityType: 'extra_work',
        entityId: row.id,
        before: { billingStatus: row.billingStatus, billingNote: row.billingNote },
        after: {
          billingStatus: status,
          billingNote,
          invoice: invoiceNumber,
          ...(row.projectId ? { projectId: row.projectId } : { retainerId: row.retainerId }),
        },
      });
    }
  }
}

const unbilledWork = and(
  eq(extraWorkItems.billingStatus, 'unbilled'),
  isNull(extraWorkItems.archivedAt),
);

const engagementColumns = (table: typeof projects | typeof retainers) => ({
  id: table.id,
  name: table.name,
  clientId: table.clientId,
  currency: table.currency,
  archivedAt: table.archivedAt,
});

function withoutArchivedAt<T extends { archivedAt: Date | null }>({
  archivedAt,
  ...row
}: T): Omit<T, 'archivedAt'> & { archived: boolean } {
  return { ...row, archived: !!archivedAt };
}
