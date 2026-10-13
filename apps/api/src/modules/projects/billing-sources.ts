import { Inject, Injectable } from '@nestjs/common';
import {
  type CalendarDate,
  type Currency,
  type CyclePeriod,
  cyclePeriod,
  type ExtraWorkBilling,
  type InvoiceSource,
  type InvoiceSourceType,
  type MilestoneStatus,
  type RetainerChargeKind,
  type RetainerChargeListQuery,
  type RetainerChargeStatus,
} from '@vertex-hub/contracts';
import { formatRetainerCycle } from '@vertex-hub/messages';
import {
  type Database,
  extraWorkItems,
  projectMilestones,
  projects,
  retainerAmendments,
  retainerCharges,
  retainers,
  retainerTerms,
  type Transaction,
} from '@vertex-hub/db';
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, type SQL } from 'drizzle-orm';
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

/** A milestone, retainer charge or extra work item as an invoice line bills it (F13 rules 2–6). */
export interface BillingSource {
  type: InvoiceSourceType;
  id: string;
  /** The milestone or extra work name; the charge's cycle for a retainer charge. */
  name: string;
  /** The default line text: "<engagement> — <milestone or cycle>", or the extra work title. */
  description: string;
  /** The installment, the charge's amount or the estimate; null when it has none. */
  amountMinor: number | null;
  /** Archived work, or a charge that is not due yet, cancelled or settled outside (F05B C7, C10). */
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
  charges: ({
    id: string;
    retainer: { id: string; name: string };
    cycle: number;
    kind: RetainerChargeKind;
    amountMinor: number;
  } & CyclePeriod)[];
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

/** A retainer's charge as its billing summary and charge list show it (F05B). */
export interface RetainerChargeRow extends CyclePeriod {
  id: string;
  cycle: number;
  kind: RetainerChargeKind;
  amountMinor: number;
  status: RetainerChargeStatus;
  /** A term cycle's `monthly` charge: its place in the term (F05B C4). */
  term: ChargeTerm | null;
  /** The amendment of an addition or a credit (C6). */
  amendment: { id: string; number: number } | null;
  settleNote: string | null;
  due: boolean;
}

export interface ChargeTerm {
  number: number;
  position: number;
  cycles: number;
}

const chargeTermColumns = {
  number: retainerTerms.number,
  startCycle: retainerTerms.startCycle,
  cycles: retainerTerms.cycles,
};

/** "2 of 3" of the charge's term, read from the joined term columns. */
function chargeTerm(
  cycle: number,
  term: { number: number; startCycle: number | null; cycles: number | null } | null,
): ChargeTerm | null {
  if (!term) return null;
  return {
    number: term.number,
    position: cycle - (term.startCycle ?? cycle) + 1,
    cycles: term.cycles ?? 1,
  };
}

/** A charge row's cycle and its anchored period (F05C). */
function chargeCycle(
  row: { cycleNumber: number | null },
  startDate: CalendarDate,
): { cycle: number } & CyclePeriod {
  const cycle = row.cycleNumber ?? 1;
  return { cycle, ...cyclePeriod(startDate, cycle) };
}

/** What a retainer's billing summary lists (F13). */
export interface RetainerWork {
  monthlyFeeMinor: number | null;
  /** Newest cycle first. */
  charges: RetainerChargeRow[];
  extraWork: {
    id: string;
    title: string;
    billingStatus: ExtraWorkBilling;
    estimateMinor: number | null;
  }[];
}

/**
 * F05B C4, F05C J3: a charge's line text after its retainer's name: the cycle and its period
 * (with "n من N" in a term), the amendment of an addition or a credit, or the termination fee.
 */
function chargeName(row: {
  kind: RetainerChargeKind;
  cycle: { cycle: number } & CyclePeriod;
  term: ChargeTerm | null;
  amendmentNumber: number | null;
}): string {
  const cycle = formatRetainerCycle({ number: row.cycle.cycle, ...row.cycle });
  switch (row.kind) {
    case 'monthly':
      return formatRetainerCycle(
        { number: row.cycle.cycle, ...row.cycle },
        row.term && { position: row.term.position, cycles: row.term.cycles },
      );
    case 'addition':
      return `تعديل ${row.amendmentNumber ?? ''} — ${cycle}`;
    case 'credit':
      return `رصيد دائن (تعديل ${row.amendmentNumber ?? ''}) — ${cycle}`;
    case 'termination_fee':
      return `رسوم إنهاء مبكر — ${cycle}`;
  }
}

/** The map key of a source in `BillingSources.resolve`. */
export const sourceKey = (source: InvoiceSource) => `${source.type}:${source.id}`;

/**
 * What the `invoices` module bills from projects and retainers (F13): milestone installments,
 * retainer charges (F05B) and extra work, their engagements, and the extra work billing status that
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
    const chargeIds = ids('retainer_charge');
    if (chargeIds.length) {
      const query = executor
        .select({
          id: retainerCharges.id,
          cycleNumber: retainerCharges.cycleNumber,
          startDate: retainers.startDate,
          kind: retainerCharges.kind,
          amountMinor: retainerCharges.amountMinor,
          status: retainerCharges.status,
          dueAt: retainerCharges.dueAt,
          engagement: engagementColumns(retainers),
          term: chargeTermColumns,
          amendmentNumber: retainerAmendments.number,
        })
        .from(retainerCharges)
        .innerJoin(retainers, eq(retainers.id, retainerCharges.retainerId))
        .leftJoin(retainerTerms, eq(retainerTerms.id, retainerCharges.termId))
        .leftJoin(retainerAmendments, eq(retainerAmendments.id, retainerCharges.amendmentId))
        .where(inArray(retainerCharges.id, chargeIds));
      // Locked like milestones: a draft waits for a change of the charge's amount or status.
      const rows = options.lock ? await query.for('share', { of: retainerCharges }) : await query;
      for (const row of rows) {
        const engagement: BillingEngagement = {
          type: 'retainer',
          ...withoutArchivedAt(row.engagement),
        };
        const cycle = chargeCycle(row, row.startDate);
        const name = chargeName({ ...row, cycle, term: chargeTerm(cycle.cycle, row.term) });
        result.set(sourceKey({ type: 'retainer_charge', id: row.id }), {
          type: 'retainer_charge',
          id: row.id,
          name,
          description: `${engagement.name} — ${name}`.slice(0, 300),
          amountMinor: row.amountMinor,
          archived: row.status !== 'pending' || row.dueAt === null,
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
   * F13 rule 6: the client's non-archived milestones with an installment, due pending retainer
   * charges (F05B C7) and unbilled extra work of its non-archived projects and retainers in
   * `currency`.
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
    const [milestones, charges, projectWork, retainerWork] = await Promise.all([
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
          id: retainerCharges.id,
          retainerId: retainers.id,
          retainerName: retainers.name,
          startDate: retainers.startDate,
          cycleNumber: retainerCharges.cycleNumber,
          kind: retainerCharges.kind,
          amountMinor: retainerCharges.amountMinor,
        })
        .from(retainerCharges)
        .innerJoin(retainers, eq(retainers.id, retainerCharges.retainerId))
        .where(
          and(
            liveRetainer,
            eq(retainerCharges.status, 'pending'),
            isNotNull(retainerCharges.dueAt),
          ),
        )
        .orderBy(
          asc(retainers.name),
          desc(retainerCharges.cycleNumber),
          asc(retainerCharges.createdAt),
          asc(retainerCharges.id),
        ),
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
      charges: charges.map((row) => ({
        id: row.id,
        retainer: { id: row.retainerId, name: row.retainerName },
        ...chargeCycle(row, row.startDate),
        kind: row.kind,
        amountMinor: row.amountMinor,
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
   * F13 retainer billing: the retainer's current fee, its charges (newest cycle first, F05B) and
   * its non-archived extra work (newest first).
   */
  async retainerWork(retainerId: string): Promise<RetainerWork> {
    const [[retainer], charges, extraWork] = await Promise.all([
      this.db
        .select({ monthlyFeeMinor: retainers.monthlyFeeMinor })
        .from(retainers)
        .where(eq(retainers.id, retainerId)),
      this.chargeRows(eq(retainerCharges.retainerId, retainerId)),
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
    return { monthlyFeeMinor: retainer?.monthlyFeeMinor ?? null, charges, extraWork };
  }

  /** F05B: one page of a retainer's charges, newest cycle first. */
  async retainerCharges(
    retainerId: string,
    query: RetainerChargeListQuery,
  ): Promise<{ items: RetainerChargeRow[]; total: number }> {
    const where = and(
      eq(retainerCharges.retainerId, retainerId),
      query.status ? inArray(retainerCharges.status, query.status) : undefined,
      query.kind ? inArray(retainerCharges.kind, query.kind) : undefined,
    );
    const [items, [total]] = await Promise.all([
      this.chargeRows(where, { limit: query.pageSize, offset: (query.page - 1) * query.pageSize }),
      this.db.select({ value: count() }).from(retainerCharges).where(where),
    ]);
    return { items, total: total?.value ?? 0 };
  }

  /** F05B C9: one charge of the retainer, as its billing shows it. */
  async retainerCharge(retainerId: string, chargeId: string): Promise<RetainerChargeRow | null> {
    const [row] = await this.chargeRows(
      and(eq(retainerCharges.retainerId, retainerId), eq(retainerCharges.id, chargeId)),
    );
    return row ?? null;
  }

  private async chargeRows(
    where: SQL | undefined,
    page?: { limit: number; offset: number },
  ): Promise<RetainerChargeRow[]> {
    const query = this.db
      .select({
        id: retainerCharges.id,
        cycleNumber: retainerCharges.cycleNumber,
        startDate: retainers.startDate,
        kind: retainerCharges.kind,
        amountMinor: retainerCharges.amountMinor,
        status: retainerCharges.status,
        dueAt: retainerCharges.dueAt,
        settleNote: retainerCharges.settleNote,
        term: chargeTermColumns,
        amendmentId: retainerAmendments.id,
        amendmentNumber: retainerAmendments.number,
      })
      .from(retainerCharges)
      .innerJoin(retainers, eq(retainers.id, retainerCharges.retainerId))
      .leftJoin(retainerTerms, eq(retainerTerms.id, retainerCharges.termId))
      .leftJoin(retainerAmendments, eq(retainerAmendments.id, retainerCharges.amendmentId))
      .where(where)
      .orderBy(
        desc(retainerCharges.cycleNumber),
        asc(retainerCharges.createdAt),
        asc(retainerCharges.id),
      );
    const rows = page ? await query.limit(page.limit).offset(page.offset) : await query;
    return rows.map(
      ({ dueAt, term, amendmentId, amendmentNumber, cycleNumber, startDate, ...row }) => {
        const cycle = chargeCycle({ cycleNumber }, startDate);
        return {
          ...row,
          ...cycle,
          term: chargeTerm(cycle.cycle, term),
          amendment:
            amendmentId && amendmentNumber !== null
              ? { id: amendmentId, number: amendmentNumber }
              : null,
          due: dueAt !== null,
        };
      },
    );
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
