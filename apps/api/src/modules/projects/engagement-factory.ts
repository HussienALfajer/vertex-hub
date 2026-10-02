import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type CreateProject,
  type CreateRetainer,
  type Currency,
  type DeliverableKind,
  type DepartmentCode,
  deliverableKey,
  type RetainerStatus,
} from '@vertex-hub/contracts';
import { type Database, retainers, type Transaction } from '@vertex-hub/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { changedFields, recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { actorOf, assertCanEditMoney } from './project-access.js';
import { ProjectsService } from './projects.service.js';
import { workableRetainer } from './retainer-access.js';
import { RetainersService } from './retainers.service.js';

/** A retainer an accepted quote may renew (F04 A5). */
export interface RenewableRetainer {
  id: string;
  name: string;
  status: RetainerStatus;
  currency: Currency;
}

/** The standing lines, fee and dates an accepted quote renews a retainer with (F04 A7). */
export interface RetainerRenewal {
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
  /** Left out: the renewal date stays. */
  renewalDate?: string;
}

/**
 * Engagements made by other modules (spec F04, A01): creates a project with its milestones, a
 * retainer with its lines and first cycle, and renews a retainer, inside the caller's
 * transaction, with F05's rules, audit and notifications. The caller locks access changes first.
 */
@Injectable()
export class EngagementFactory {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly projects: ProjectsService,
    private readonly retainers: RetainersService,
  ) {}

  createProject(tx: Transaction, actor: CurrentUserInfo, input: CreateProject): Promise<string> {
    return this.projects.createIn(tx, actor, input);
  }

  /** Without its first cycle: link its template, then `startRetainer` (A8). */
  createRetainer(tx: Transaction, actor: CurrentUserInfo, input: CreateRetainer): Promise<string> {
    return this.retainers.createIn(tx, actor, input);
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
  renewable(clientId: string, executor: Database | Transaction = this.db) {
    return executor
      .select({
        id: retainers.id,
        name: retainers.name,
        status: retainers.status,
        currency: retainers.currency,
      })
      .from(retainers)
      .where(
        and(
          eq(retainers.clientId, clientId),
          inArray(retainers.status, ['active', 'paused']),
          isNull(retainers.archivedAt),
        ),
      )
      .orderBy(asc(retainers.name)) as Promise<RenewableRetainer[]>;
  }

  /**
   * A7: replaces the standing lines from the next cycle (R10; lines of the same kind and label
   * keep their identity), sets the fee and, when given, the renewal date. Returns the retainer's
   * name and departments.
   */
  async renewRetainer(
    tx: Transaction,
    actor: CurrentUserInfo,
    retainerId: string,
    renewal: RetainerRenewal,
  ): Promise<{ name: string; departments: DepartmentCode[] }> {
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
    const current = await this.retainers.standingLines(tx, retainerId);
    const idOf = new Map(current.map((line) => [deliverableKey(line), line.id]));
    await this.retainers.replaceLines(
      tx,
      actor,
      retainerId,
      renewal.deliverables.map((line) => ({ ...line, id: idOf.get(deliverableKey(line)) })),
    );
    const [row] = await tx
      .select({
        name: retainers.name,
        departments: retainers.departments,
        startDate: retainers.startDate,
        renewalDate: retainers.renewalDate,
        monthlyFeeMinor: retainers.monthlyFeeMinor,
      })
      .from(retainers)
      .where(eq(retainers.id, retainerId));
    if (!row) throw new Error('The retainer disappeared');
    if (renewal.renewalDate !== undefined && renewal.renewalDate <= row.startDate) {
      throw new CodedException(
        400,
        'INVALID_DATES',
        'The renewal date is not after the start date',
      );
    }
    const basics = changedFields(
      { renewalDate: row.renewalDate },
      { renewalDate: renewal.renewalDate },
    );
    const money = changedFields(
      { monthlyFeeMinor: row.monthlyFeeMinor },
      { monthlyFeeMinor: renewal.monthlyFeeMinor },
    );
    if (basics || money) {
      await tx
        .update(retainers)
        .set({ ...basics?.after, ...money?.after })
        .where(eq(retainers.id, retainerId));
    }
    for (const [action, change] of [
      ['retainer.updated', basics],
      ['retainer.money_updated', money],
    ] as const) {
      if (!change) continue;
      await recordAudit(tx, {
        actor: actorOf(actor),
        action,
        entityType: 'retainer',
        entityId: retainerId,
        ...change,
      });
    }
    return { name: row.name, departments: row.departments };
  }
}
