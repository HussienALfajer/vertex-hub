import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  businessDate,
  type CalendarDate,
  type CreateProject,
  type CreateRetainer,
  type Currency,
  type DeliverableKind,
  type DepartmentCode,
  firstOfMonth,
  type RetainerStatus,
  type RetainerTermInput,
} from '@vertex-hub/contracts';
import { type Database, projectMilestones, retainers, type Transaction } from '@vertex-hub/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { actorOf, assertCanEditMoney } from './project-access.js';
import { ProjectsService } from './projects.service.js';
import { workableRetainer } from './retainer-access.js';
import { RetainerAmendmentsService } from './retainer-amendments.service.js';
import { RetainerTermsService } from './retainer-terms.service.js';
import { RetainersService } from './retainers.service.js';

/** A retainer an accepted quote may renew (F04 A5), and when the renewal would take effect. */
export interface RenewableRetainer {
  id: string;
  name: string;
  status: RetainerStatus;
  currency: Currency;
  /** F05B Q2: the month after its active term, else next month. */
  renewsFrom: CalendarDate;
  /** Whether it has an active term the renewal waits for. */
  afterTerm: boolean;
}

/** The standing lines, fee and term an accepted quote renews a retainer with (F04 A7, F05B Q2). */
export interface RetainerRenewal {
  /** The accepted quote. */
  quoteId: string;
  /** The quote's client: a retainer of another client is not found. */
  clientId: string;
  /** The quote's currency (edge case 9). */
  currency: Currency;
  deliverables: {
    kind: DeliverableKind;
    label: string | null;
    monthlyQuantity: number;
    revisionLimit: number | null;
  }[];
  monthlyFeeMinor: number;
  /** The monthly template linked with the renewal (owner decision); null keeps the retainer's. */
  templateId: string | null;
  /** The new term; null: none (an active term continues monthly after it ends). */
  term: RetainerTermInput | null;
  /** The quote renewal amendment's reason (the quote's number and title). */
  reason: string;
}

/**
 * Engagements made by other modules (spec F04, A01): creates a project with its milestones, a
 * retainer with its lines, term and first cycle, and renews a retainer, inside the caller's
 * transaction, with F05's rules, audit and notifications. The caller locks access changes first.
 */
@Injectable()
export class EngagementFactory {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly projects: ProjectsService,
    private readonly retainers: RetainersService,
    private readonly terms: RetainerTermsService,
    private readonly amendments: RetainerAmendmentsService,
  ) {}

  /** Returns the project and its milestones' ids in order (F13 A01 drafts the first installment). */
  async createProject(
    tx: Transaction,
    actor: CurrentUserInfo,
    input: CreateProject,
  ): Promise<{ id: string; milestoneIds: string[] }> {
    const id = await this.projects.createIn(tx, actor, input);
    const milestones = await tx
      .select({ id: projectMilestones.id })
      .from(projectMilestones)
      .where(eq(projectMilestones.projectId, id))
      .orderBy(asc(projectMilestones.position));
    return { id, milestoneIds: milestones.map((milestone) => milestone.id) };
  }

  /**
   * Without its first cycle: link its template, then `startRetainer` (A8). A `term` starts in the
   * start date's month, or the current month when that is later, and records the quote that
   * created it (F05B Q1).
   */
  async createRetainer(
    tx: Transaction,
    actor: CurrentUserInfo,
    input: CreateRetainer,
    options: { quoteId?: string } = {},
  ): Promise<string> {
    if (input.term && input.renewalDate) {
      throw new CodedException(
        409,
        'RENEWAL_DATE_FROM_TERM',
        'A retainer with a term takes its renewal date from the term',
      );
    }
    const id = await this.retainers.createIn(tx, actor, input);
    if (input.term) {
      // A start date in an earlier month starts the term this month (owner decision 2026-10-07).
      const today = businessDate();
      const startMonth = [firstOfMonth(input.startDate), firstOfMonth(today)].sort()[1];
      await this.terms.createIn(
        tx,
        actorOf(actor),
        { id, startDate: input.startDate },
        { ...input.term, startMonth: startMonth ?? firstOfMonth(today) },
        today,
        { quoteId: options.quoteId },
      );
    }
    return id;
  }

  /** R3: a retainer whose start date is today or earlier opens this month's cycle. */
  startRetainer(
    tx: Transaction,
    actor: CurrentUserInfo,
    retainerId: string,
    startDate: string,
  ): Promise<void> {
    return this.retainers.start(tx, actor, retainerId, startDate);
  }

  /** The client's non-archived active or paused retainers, by name. */
  async renewable(
    clientId: string,
    executor: Database | Transaction = this.db,
  ): Promise<RenewableRetainer[]> {
    const rows = await executor
      .select({
        id: retainers.id,
        name: retainers.name,
        status: retainers.status,
        currency: retainers.currency,
        startDate: retainers.startDate,
      })
      .from(retainers)
      .where(
        and(
          eq(retainers.clientId, clientId),
          inArray(retainers.status, ['active', 'paused']),
          isNull(retainers.archivedAt),
        ),
      )
      .orderBy(asc(retainers.name));
    const starts = await this.terms.renewalStarts(executor, rows, businessDate());
    return rows.flatMap(({ startDate: _startDate, ...row }) => {
      const start = starts.get(row.id);
      return start ? [{ ...row, ...start }] : [];
    });
  }

  /**
   * A7 with F05B Q2: the quote's term (if any) is placed after the active term, replacing a
   * scheduled one, and its lines, fee and monthly template become a `quote_renewal` amendment of
   * that month.
   * Returns the retainer's name and departments and the month the renewal takes effect in.
   */
  async renewRetainer(
    tx: Transaction,
    actor: CurrentUserInfo,
    retainerId: string,
    renewal: RetainerRenewal,
  ): Promise<{ name: string; departments: DepartmentCode[]; renewsFrom: CalendarDate }> {
    const retainer = await workableRetainer(tx, this.clients, actor, retainerId);
    if (retainer.clientId !== renewal.clientId) throw new NotFoundException();
    if (retainer.currency !== renewal.currency) {
      throw new CodedException(
        409,
        'CURRENCY_MISMATCH',
        "The retainer's currency differs from the quote's",
      );
    }
    assertCanEditMoney(actor, retainer.client);
    const renewsFrom = await this.terms.renewForQuote(
      tx,
      actorOf(actor),
      retainer,
      { quoteId: renewal.quoteId, term: renewal.term },
      businessDate(),
    );
    await this.amendments.createQuoteRenewal(tx, retainerId, actorOf(actor), {
      quoteId: renewal.quoteId,
      effectiveMonth: renewsFrom,
      feeMinor: renewal.monthlyFeeMinor,
      templateId: renewal.templateId,
      lines: renewal.deliverables,
      reason: renewal.reason,
    });
    const [row] = await tx
      .select({ name: retainers.name, departments: retainers.departments })
      .from(retainers)
      .where(eq(retainers.id, retainerId));
    if (!row) throw new Error('The retainer disappeared');
    return { ...row, renewsFrom };
  }
}
