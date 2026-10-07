import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type AuditAction,
  addDays,
  businessDate,
  type CreateRetainer,
  type Cycle,
  canChangeRetainerStatus,
  type DeliverableLine,
  type DeliverableLineInput,
  type DeliverableLineList,
  deliverableKey,
  duplicateDeliverables,
  firstOfMonth,
  permissionScopes,
  RENEWAL_NOTICE_DAYS,
  RETAINER_LIMITS,
  type Retainer,
  type RetainerDeliverables,
  type RetainerDetail,
  type RetainerListQuery,
  type RetainerPage,
  type RetainerStatus,
  type RetainerStatusChange,
  type RetainerTermSummary,
  renewalState,
  type UpdateRetainer,
} from '@vertex-hub/contracts';
import {
  type Database,
  extraWorkItems,
  retainerDeliverables,
  retainers,
  type Transaction,
} from '@vertex-hub/db';
import {
  and,
  arrayContains,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  not,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { changedFields, recordAudit } from '../audit/index.js';
import {
  type CurrentUserInfo,
  lockAccessChanges,
  UserDirectory,
  type UserSummary,
} from '../auth/index.js';
import { ClientDirectory, type ClientSummary } from '../clients/index.js';
import { BillingLocks } from './billing-locks.js';
import {
  actorOf,
  assertCanEditMoney,
  assertClientTakesWork,
  coversClient,
  holdsAll,
  seesMoney,
} from './project-access.js';
import {
  assertRetainerNotArchived,
  readableRetainer,
  retainerPermissions,
  workableRetainer,
} from './retainer-access.js';
import { RetainerAmendmentsService } from './retainer-amendments.service.js';
import { RetainerCharges } from './retainer-charges.js';
import { RetainerCyclesService } from './retainer-cycles.service.js';
import { RetainerTermsService } from './retainer-terms.service.js';

type Executor = Database | Transaction;

type Change = { before: Record<string, unknown>; after: Record<string, unknown> };

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

const summaryColumns = {
  id: retainers.id,
  name: retainers.name,
  clientId: retainers.clientId,
  departments: retainers.departments,
  status: retainers.status,
  renewalDate: retainers.renewalDate,
};

type SummaryRow = {
  id: string;
  name: string;
  clientId: string;
  departments: Retainer['departments'];
  status: RetainerStatus;
  renewalDate: string | null;
};

const lineColumns = {
  id: retainerDeliverables.id,
  kind: retainerDeliverables.kind,
  label: retainerDeliverables.label,
  monthlyQuantity: retainerDeliverables.monthlyQuantity,
  revisionLimit: retainerDeliverables.revisionLimit,
  position: retainerDeliverables.position,
};

/** Retainers of clients (F05): basics, standing lines, status, archive and restore. */
@Injectable()
export class RetainersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
    private readonly cycles: RetainerCyclesService,
    private readonly locks: BillingLocks,
    private readonly charges: RetainerCharges,
    private readonly terms: RetainerTermsService,
    private readonly amendments: RetainerAmendmentsService,
  ) {}

  async list(actor: CurrentUserInfo, query: RetainerListQuery): Promise<RetainerPage> {
    if (query.archived && !holdsAll(actor, 'projects.manage')) throw new ForbiddenException();
    const today = businessDate();

    const filters: (SQL | undefined)[] = [
      query.archived
        ? isNotNull(retainers.archivedAt)
        : and(isNull(retainers.archivedAt), this.clients.isLive(retainers.clientId)),
      permissionScopes(actor.access, 'projects.read').includes('all') ? undefined : sql`false`,
      inArray(retainers.status, query.status),
    ];
    if (query.search) {
      filters.push(
        or(
          ilike(retainers.name, `%${escapeLike(query.search)}%`),
          this.clients.nameContains(retainers.clientId, query.search),
        ),
      );
    }
    if (query.clientId) filters.push(eq(retainers.clientId, query.clientId));
    if (query.accountManagerId) {
      filters.push(this.clients.managedBy(retainers.clientId, query.accountManagerId));
    }
    if (query.department) filters.push(arrayContains(retainers.departments, [query.department]));
    if (query.renewalDue !== undefined) {
      // R6: due from 30 days before the renewal date, and overdue after it, until ended.
      const due = and(
        isNotNull(retainers.renewalDate),
        ne(retainers.status, 'ended'),
        lte(retainers.renewalDate, addDays(today, RENEWAL_NOTICE_DAYS)),
      );
      filters.push(query.renewalDue ? due : or(isNull(retainers.renewalDate), not(due as SQL)));
    }
    if (query.pendingApproval !== undefined) {
      filters.push(this.amendments.pendingApprovalFilter(query.pendingApproval));
    }
    const where = and(...filters);

    const sortColumn =
      query.sort === 'name'
        ? sql`lower(${retainers.name})`
        : query.sort === 'renewalDate'
          ? retainers.renewalDate
          : this.clients.sortName(retainers.clientId);
    const order = query.order === 'desc' ? desc : asc;
    const ordered = this.db
      .select(summaryColumns)
      .from(retainers)
      .where(where)
      .orderBy(order(sortColumn), asc(retainers.id));

    let rows: SummaryRow[];
    let total: number;
    let currentCycles: Map<string, Cycle>;
    if (query.behind === undefined) {
      const [page, [counted]] = await Promise.all([
        ordered.limit(query.pageSize).offset((query.page - 1) * query.pageSize),
        this.db.select({ value: count() }).from(retainers).where(where),
      ]);
      rows = page;
      total = counted?.value ?? 0;
      currentCycles = await this.cycles.current(rows);
    } else {
      // "Behind" depends on delivered counts (R11), so it is decided per retainer; a client
      // base of this size keeps the whole filtered set small (edge case 17).
      const all = await ordered;
      currentCycles = await this.cycles.current(all);
      const matching = all.filter(
        (row) => (currentCycles.get(row.id)?.behind ?? false) === query.behind,
      );
      total = matching.length;
      rows = matching.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
    }

    const clients = await this.clients.summaries(rows.map((row) => row.clientId));
    const people = await this.users.summaries(
      [...clients.values()].map((client) => client.accountManagerId),
    );
    const ids = rows.map((row) => row.id);
    const [terms, pending] = await Promise.all([
      this.terms.summaries(this.db, ids),
      this.amendments.pendingCounts(this.db, ids),
    ]);
    return {
      items: rows.map((row) =>
        toRetainer(row, { clients, people, currentCycles, terms, pending, today }),
      ),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async detail(actor: CurrentUserInfo, id: string): Promise<RetainerDetail> {
    const access = await readableRetainer(this.db, this.clients, actor, id);
    const [[row], lines] = await Promise.all([
      this.db
        .select({
          ...summaryColumns,
          startDate: retainers.startDate,
          endedOn: retainers.endedOn,
          currency: retainers.currency,
          monthlyFeeMinor: retainers.monthlyFeeMinor,
          archivedAt: retainers.archivedAt,
        })
        .from(retainers)
        .where(eq(retainers.id, id)),
      this.standingLines(this.db, id),
    ]);
    if (!row) throw new NotFoundException();
    const money = seesMoney(actor, access.client);
    const [currentCycles, people, term, pending, credits] = await Promise.all([
      this.cycles.current([row]),
      this.users.summaries([access.client.accountManagerId]),
      this.terms.summaryWithMoney(this.db, id, money),
      this.amendments.pendingCounts(this.db, [id]),
      money ? this.creditPending(id) : Promise.resolve(0),
    ]);
    return {
      ...toRetainer(row, {
        clients: new Map([[access.client.id, access.client]]),
        people,
        currentCycles,
        terms: new Map(term ? [[id, term]] : []),
        pending,
        today: businessDate(),
      }),
      startDate: row.startDate,
      endedOn: row.endedOn,
      deliverables: lines,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      ...(money && {
        money: {
          currency: row.currency,
          monthlyFeeMinor: row.monthlyFeeMinor,
          creditPendingMinor: credits,
        },
      }),
      permissions: retainerPermissions(actor, access),
    };
  }

  async create(actor: CurrentUserInfo, input: CreateRetainer): Promise<RetainerDetail> {
    if (input.term && input.renewalDate) {
      throw new CodedException(
        409,
        'RENEWAL_DATE_FROM_TERM',
        'A retainer with a term takes its renewal date from the term',
      );
    }
    const id = await this.db.transaction(async (tx) => {
      // A cycle opening at once may assign its tasks (F07 rule 16): users must stay active.
      if (input.startDate <= businessDate()) await lockAccessChanges(tx);
      const created = await this.createIn(tx, actor, input);
      // F05B: the term starts in the start date's month, before the first cycle opens.
      if (input.term) {
        await this.terms.createIn(
          tx,
          actorOf(actor),
          { id: created, startDate: input.startDate },
          { ...input.term, startMonth: firstOfMonth(input.startDate) },
          businessDate(),
        );
      }
      // R3: a retainer that has started gets this month's cycle at once.
      await this.start(tx, actor, created, input.startDate);
      return created;
    });
    return this.detail(actor, id);
  }

  /**
   * Creates a retainer and its standing lines in the caller's transaction, without its first
   * cycle: `start` opens it, once the caller linked a template (F04 A8).
   */
  async createIn(tx: Transaction, actor: CurrentUserInfo, input: CreateRetainer): Promise<string> {
    const client = await this.clients.summary(input.clientId, tx, { forUpdate: true });
    if (!client) throw new NotFoundException();
    if (!coversClient(actor, client)) throw new ForbiddenException();
    assertClientTakesWork(client);
    if (
      input.currency !== undefined ||
      input.monthlyFeeMinor !== undefined ||
      input.term !== undefined
    ) {
      assertCanEditMoney(actor, client);
    }
    assertLines(input.deliverables);
    assertDates(input.startDate, input.renewalDate ?? null);
    await this.assertNameFree(tx, client.id, input.name);

    const values = {
      name: input.name,
      departments: input.departments,
      startDate: input.startDate,
      renewalDate: input.renewalDate ?? null,
      currency: input.currency ?? 'USD',
      monthlyFeeMinor: input.monthlyFeeMinor ?? null,
    };
    const [created] = await tx
      .insert(retainers)
      .values({ ...values, clientId: client.id })
      .returning({ id: retainers.id });
    if (!created) throw new Error('Retainer insert returned no row');
    const lines = input.deliverables.map((line, index) => ({
      kind: line.kind,
      label: line.label ?? null,
      monthlyQuantity: line.monthlyQuantity,
      revisionLimit: line.revisionLimit ?? null,
      position: index + 1,
    }));
    if (lines.length > 0) {
      await tx
        .insert(retainerDeliverables)
        .values(lines.map((line) => ({ ...line, retainerId: created.id })));
    }
    await recordAudit(tx, {
      actor: actorOf(actor),
      action: 'retainer.created',
      entityType: 'retainer',
      entityId: created.id,
      after: { ...values, client: { id: client.id, name: client.name }, deliverables: lines },
    });
    return created.id;
  }

  /** R3: a retainer that has started gets this month's cycle, from its start date. */
  async start(
    tx: Transaction,
    actor: CurrentUserInfo,
    retainerId: string,
    startDate: string,
  ): Promise<void> {
    const today = businessDate();
    if (startDate <= today) {
      await this.cycles.open(tx, retainerId, startDate, today, actorOf(actor));
    }
  }

  async update(actor: CurrentUserInfo, id: string, input: UpdateRetainer): Promise<RetainerDetail> {
    await this.db.transaction(async (tx) => {
      // A new start date may open a cycle that assigns its tasks (F07 rule 16); taken before the
      // retainer lock, as every other holder of both.
      if (input.startDate) await lockAccessChanges(tx);
      const retainer = await workableRetainer(tx, this.clients, actor, id);
      const [current] = await tx
        .select({
          name: retainers.name,
          departments: retainers.departments,
          startDate: retainers.startDate,
          renewalDate: retainers.renewalDate,
          currency: retainers.currency,
          monthlyFeeMinor: retainers.monthlyFeeMinor,
        })
        .from(retainers)
        .where(eq(retainers.id, id));
      if (!current) throw new NotFoundException();
      if (input.currency !== undefined || input.monthlyFeeMinor !== undefined) {
        assertCanEditMoney(actor, retainer.client);
      }
      const startChanges = input.startDate !== undefined && input.startDate !== current.startDate;
      if (startChanges && (await this.cycles.hasCycles(tx, id))) {
        throw new CodedException(
          409,
          'RETAINER_STARTED',
          'The start date is fixed once the retainer has a cycle',
        );
      }
      assertDates(
        input.startDate ?? current.startDate,
        input.renewalDate === undefined ? current.renewalDate : input.renewalDate,
      );
      // F05B T2: a term never starts before the month of the retainer's start date.
      if (startChanges && input.startDate) {
        const termStart = await this.terms.firstOpenMonth(tx, id);
        if (termStart && firstOfMonth(input.startDate) > termStart) {
          throw new CodedException(
            400,
            'INVALID_DATES',
            'The start date falls after the start of the retainer’s term',
          );
        }
      }
      // F05B T11: with an active or scheduled term the renewal date is derived from it.
      if (
        input.renewalDate !== undefined &&
        input.renewalDate !== current.renewalDate &&
        (await this.terms.hasOpenTerm(tx, id))
      ) {
        throw new CodedException(
          409,
          'RENEWAL_DATE_FROM_TERM',
          'The renewal date follows the retainer term',
        );
      }
      if (input.name !== undefined && input.name.toLowerCase() !== current.name.toLowerCase()) {
        await this.assertNameFree(tx, retainer.clientId, input.name, id);
      }

      const basics = changedFields(
        {
          name: current.name,
          departments: current.departments,
          startDate: current.startDate,
          renewalDate: current.renewalDate,
        },
        {
          name: input.name,
          departments: input.departments,
          startDate: input.startDate,
          renewalDate: input.renewalDate,
        },
      );
      const money = changedFields(
        { currency: current.currency, monthlyFeeMinor: current.monthlyFeeMinor },
        { currency: input.currency, monthlyFeeMinor: input.monthlyFeeMinor },
      );
      // F05B A9: once the retainer has a charge, its fee changes only by an onward amendment.
      if (money?.after.monthlyFeeMinor !== undefined && (await this.charges.hasCharges(tx, id))) {
        throw new CodedException(
          409,
          'FEE_CHANGE_NEEDS_AMENDMENT',
          'The retainer has charges; change its fee with an amendment',
        );
      }
      if (money?.after.currency !== undefined) {
        await this.assertCurrencyFree(tx, id, current.monthlyFeeMinor);
        if (await this.charges.hasCharges(tx, id)) {
          throw new CodedException(409, 'CURRENCY_LOCKED', 'The retainer has charges');
        }
        await this.locks.assertCurrencyFree(tx, { type: 'retainer', id });
      }
      if (!basics && !money) return;

      await tx
        .update(retainers)
        .set({ ...basics?.after, ...money?.after })
        .where(eq(retainers.id, id));
      const audit = async (action: AuditAction, change: Change | null) => {
        if (!change) return;
        await recordAudit(tx, {
          actor: actorOf(actor),
          action,
          entityType: 'retainer',
          entityId: id,
          ...change,
        });
      };
      await audit('retainer.updated', basics);
      await audit('retainer.money_updated', money);
      // R3: moving the start date to today or earlier starts the retainer at once.
      const today = businessDate();
      if (
        startChanges &&
        input.startDate &&
        input.startDate <= today &&
        retainer.status === 'active'
      ) {
        await this.cycles.open(tx, id, input.startDate, today, actorOf(actor));
      }
      // F05B C2: a fee set while the month's open cycle has none charges that month.
      if (money?.after.monthlyFeeMinor && !current.monthlyFeeMinor) {
        await this.charges.chargeOpenMonth(
          tx,
          id,
          today,
          money.after.monthlyFeeMinor,
          actorOf(actor),
        );
      }
    });
    return this.detail(actor, id);
  }

  /** R10: replaces the standing lines; lines left out are archived. The open cycle keeps its own. */
  async setDeliverables(
    actor: CurrentUserInfo,
    id: string,
    input: RetainerDeliverables,
  ): Promise<DeliverableLineList> {
    await this.db.transaction(async (tx) => {
      await workableRetainer(tx, this.clients, actor, id);
      await this.replaceLines(tx, actor, id, input.lines);
    });
    return { items: await this.standingLines(this.db, id) };
  }

  /**
   * R10 on a retainer the caller locked as workable: the lines replace the standing lines, kept
   * by `id`; lines left out are archived. The open cycle keeps its own.
   */
  async replaceLines(
    tx: Transaction,
    actor: CurrentUserInfo,
    id: string,
    lines: DeliverableLineInput[],
  ): Promise<void> {
    assertLines(lines);
    const current = await this.standingLines(tx, id);
    const known = new Set(current.map((line) => line.id));
    if (lines.some((line) => line.id !== undefined && !known.has(line.id))) {
      throw new NotFoundException('A line does not belong to the retainer');
    }
    const next = lines.map((line, index) => ({
      id: line.id,
      kind: line.kind,
      label: line.label ?? null,
      monthlyQuantity: line.monthlyQuantity,
      revisionLimit: line.revisionLimit ?? null,
      position: index + 1,
    }));
    const keys = new Map(
      next.flatMap((line) => (line.id ? [[line.id, deliverableKey(line)]] : [])),
    );
    // Removed lines, and kept lines whose kind or label changes, leave the unique index first;
    // every write after that only adds a line of the final set, which has no duplicates.
    const moving = current.filter((line) => keys.get(line.id) !== deliverableKey(line));
    if (moving.length > 0) {
      await tx
        .update(retainerDeliverables)
        .set({ archivedAt: new Date() })
        .where(
          inArray(
            retainerDeliverables.id,
            moving.map((line) => line.id),
          ),
        );
    }
    for (const line of next) {
      const { id: lineId, ...values } = line;
      if (lineId) {
        await tx
          .update(retainerDeliverables)
          .set({ ...values, archivedAt: null })
          .where(eq(retainerDeliverables.id, lineId));
      } else {
        await tx.insert(retainerDeliverables).values({ ...values, retainerId: id });
      }
    }
    const shape = (rows: Omit<DeliverableLine, 'id'>[]) =>
      rows.map(({ kind, label, monthlyQuantity, revisionLimit }) => ({
        kind,
        label,
        monthlyQuantity,
        revisionLimit,
      }));
    const before = shape(current);
    const after = shape(next);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    await recordAudit(tx, {
      actor: actorOf(actor),
      action: 'retainer.deliverables_updated',
      entityType: 'retainer',
      entityId: id,
      before: { deliverables: before },
      after: { deliverables: after },
    });
  }

  /** The status diagram (R3, R5): who may make each change is checked after it is allowed. */
  async changeStatus(
    actor: CurrentUserInfo,
    id: string,
    change: RetainerStatusChange,
  ): Promise<RetainerDetail> {
    await this.db.transaction(async (tx) => {
      // Resuming may open a cycle that assigns its tasks (F07 rule 16).
      if (change.status === 'active') await lockAccessChanges(tx);
      const retainer = await readableRetainer(tx, this.clients, actor, id, { forUpdate: true });
      if (!coversClient(actor, retainer.client)) throw new ForbiddenException();
      const to = change.status;
      if (change.termination) {
        if (to !== 'ended') {
          throw new BadRequestException('A termination fee comes only with ending the retainer');
        }
        assertCanEditMoney(actor, retainer.client);
      }
      assertRetainerNotArchived(retainer);
      if (!canChangeRetainerStatus(retainer.status, to)) {
        throw new CodedException(
          409,
          'INVALID_TRANSITION',
          `A ${retainer.status} retainer cannot become ${to}`,
        );
      }
      const reactivating = retainer.status === 'ended';
      if (reactivating && !holdsAll(actor, 'projects.manage')) throw new ForbiddenException();

      const today = businessDate();
      await tx
        .update(retainers)
        .set({
          status: to,
          ...(to === 'ended' && { endedOn: today }),
          ...(reactivating && { endedOn: null }),
        })
        .where(eq(retainers.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'retainer.status_changed',
        entityType: 'retainer',
        entityId: id,
        before: { status: retainer.status },
        after: { status: to },
      });
      if (to === 'ended') {
        await this.cycles.closeAll(tx, id, today, actorOf(actor));
        // F05B E1, E2: later months are cancelled; a termination fee drafts at once.
        await this.terms.endEarly(tx, id, today, actorOf(actor));
        await this.amendments.cancelOpen(tx, id, actorOf(actor));
        if (change.termination) {
          await this.charges.createTerminationFee(
            tx,
            id,
            today,
            change.termination,
            actorOf(actor),
          );
        }
      }
      // R3: resuming or reactivating a started retainer opens this month's cycle, from today.
      if (to === 'active' && retainer.startDate <= today) {
        await this.cycles.open(tx, id, today, today, actorOf(actor));
      }
    });
    return this.detail(actor, id);
  }

  async archive(actor: CurrentUserInfo, id: string): Promise<RetainerDetail> {
    if (!holdsAll(actor, 'projects.manage')) throw new ForbiddenException();
    await this.db.transaction(async (tx) => {
      const retainer = await readableRetainer(tx, this.clients, actor, id, { forUpdate: true });
      if (retainer.archivedAt) {
        throw new CodedException(409, 'RETAINER_ARCHIVED', 'The retainer is already archived');
      }
      await tx.update(retainers).set({ archivedAt: new Date() }).where(eq(retainers.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'retainer.archived',
        entityType: 'retainer',
        entityId: id,
        before: { archived: false },
        after: { archived: true },
      });
    });
    return this.detail(actor, id);
  }

  async restore(actor: CurrentUserInfo, id: string): Promise<RetainerDetail> {
    if (!holdsAll(actor, 'projects.manage')) throw new ForbiddenException();
    await this.db.transaction(async (tx) => {
      const retainer = await readableRetainer(tx, this.clients, actor, id, { forUpdate: true });
      if (!retainer.archivedAt) {
        throw new CodedException(409, 'RETAINER_NOT_ARCHIVED', 'The retainer is not archived');
      }
      if (retainer.client.archived) {
        throw new CodedException(409, 'CLIENT_ARCHIVED', 'Restore the client first');
      }
      await this.assertNameFree(tx, retainer.clientId, retainer.name, id);
      await tx.update(retainers).set({ archivedAt: null }).where(eq(retainers.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'retainer.restored',
        entityType: 'retainer',
        entityId: id,
        before: { archived: true },
        after: { archived: false },
      });
    });
    return this.detail(actor, id);
  }

  /** C9: the pending credits no live invoice bills, owed to the client, as a positive amount. */
  private async creditPending(retainerId: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      const credits = await this.charges.pendingCredits(tx, retainerId, tx);
      return -credits.reduce((total, credit) => total + credit.amountMinor, 0);
    });
  }

  /** Non-archived standing lines, by position. */
  standingLines(executor: Executor, retainerId: string): Promise<DeliverableLine[]> {
    return executor
      .select(lineColumns)
      .from(retainerDeliverables)
      .where(
        and(
          eq(retainerDeliverables.retainerId, retainerId),
          isNull(retainerDeliverables.archivedAt),
        ),
      )
      .orderBy(asc(retainerDeliverables.position), asc(retainerDeliverables.id));
  }

  /** Unique case-insensitively per client among non-archived retainers. */
  private async assertNameFree(
    executor: Executor,
    clientId: string,
    name: string,
    exceptId?: string,
  ) {
    const [taken] = await executor
      .select({ id: retainers.id })
      .from(retainers)
      .where(
        and(
          eq(retainers.clientId, clientId),
          sql`lower(${retainers.name}) = lower(${name})`,
          isNull(retainers.archivedAt),
          exceptId ? ne(retainers.id, exceptId) : undefined,
        ),
      );
    if (taken) {
      throw new CodedException(
        409,
        'RETAINER_NAME_TAKEN',
        'The client has a retainer with this name',
      );
    }
  }

  /** M2: the currency changes only while no fee or extra work estimate is set. */
  private async assertCurrencyFree(tx: Transaction, retainerId: string, feeMinor: number | null) {
    const [estimated] = await tx
      .select({ id: extraWorkItems.id })
      .from(extraWorkItems)
      .where(
        and(
          eq(extraWorkItems.retainerId, retainerId),
          isNull(extraWorkItems.archivedAt),
          isNotNull(extraWorkItems.estimateMinor),
        ),
      )
      .limit(1);
    if (feeMinor !== null || estimated) {
      throw new CodedException(
        409,
        'CURRENCY_LOCKED',
        'The currency cannot change once amounts are set',
      );
    }
  }
}

/** At most 20 lines, none repeated. */
function assertLines(lines: { kind: DeliverableLine['kind']; label?: string | null }[]) {
  if (lines.length > RETAINER_LIMITS.deliverables) {
    throw new CodedException(409, 'LIMIT_REACHED', 'A retainer holds at most 20 lines');
  }
  if (duplicateDeliverables(lines).length > 0) {
    throw new CodedException(409, 'DUPLICATE_DELIVERABLE', 'Each line needs its own kind or label');
  }
}

/** The renewal date comes after the start date. */
function assertDates(startDate: string, renewalDate: string | null): void {
  if (renewalDate !== null && renewalDate <= startDate) {
    throw new CodedException(400, 'INVALID_DATES', 'The renewal date is not after the start date');
  }
}

function toRetainer(
  row: SummaryRow,
  context: {
    clients: Map<string, ClientSummary>;
    people: Map<string, UserSummary>;
    currentCycles: Map<string, Cycle>;
    terms: Map<string, RetainerTermSummary>;
    pending: Map<string, number>;
    today: string;
  },
): Retainer {
  const client = context.clients.get(row.clientId);
  const managerId = client?.accountManagerId ?? '';
  return {
    id: row.id,
    name: row.name,
    client: { id: row.clientId, name: client?.name ?? '' },
    accountManager: { id: managerId, name: context.people.get(managerId)?.name ?? '' },
    departments: row.departments,
    status: row.status,
    renewalDate: row.renewalDate,
    renewal: renewalState(row.renewalDate, row.status, context.today),
    term: context.terms.get(row.id) ?? null,
    pendingAmendments: context.pending.get(row.id) ?? 0,
    currentCycle: context.currentCycles.get(row.id) ?? null,
  };
}
