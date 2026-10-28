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
  addMonths,
  BACKDATE_LIMIT_MONTHS,
  businessDate,
  type CalendarDate,
  type CreateRetainer,
  type CurrentCycle,
  type Cycle,
  canChangeRetainerStatus,
  catchUpComplete,
  currentCycleNumber,
  cycleDaysLeft,
  cyclePeriod,
  type DeliverableLine,
  type DeliverableLineInput,
  type DeliverableLineList,
  deliverableKey,
  duplicateDeliverables,
  type Image,
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
  type SetImage,
  type UpdateRetainer,
} from '@vertex-hub/contracts';
import {
  type Database,
  extraWorkItems,
  retainerCycles,
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
  personRef,
  UserDirectory,
  type UserSummary,
} from '../auth/index.js';
import { ClientDirectory, type ClientSummary, clientRef } from '../clients/index.js';
import { ImagesService } from '../files/index.js';
import { BillingLocks } from './billing-locks.js';
import { changedDepartments } from './engagement-departments.js';
import { EngagementNotices } from './engagement-notices.js';
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
  startDate: retainers.startDate,
  cyclesFrom: retainers.cyclesFrom,
  renewalDate: retainers.renewalDate,
  imageId: retainers.imageId,
};

type SummaryRow = {
  id: string;
  name: string;
  clientId: string;
  departments: Retainer['departments'];
  status: RetainerStatus;
  startDate: CalendarDate;
  cyclesFrom: CalendarDate | null;
  renewalDate: string | null;
  imageId: string | null;
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
    private readonly notices: EngagementNotices,
    private readonly images: ImagesService,
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
      this.terms.summaryWithMoney(this.db, row, money),
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
      ownImageId: row.imageId,
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
    const id = await this.db.transaction(async (tx) => {
      const today = businessDate();
      // A cycle opening at once may assign its tasks (F07 rule 16): users must stay active.
      if (input.startDate <= today) await lockAccessChanges(tx);
      const created = await this.createIn(tx, actor, input, { backdate: true });
      const backdated = pastCycles(input.startDate, today) > 0;
      // F05B, F05C: the term starts at the current cycle, before that cycle opens; at cycle 1 on
      // a backdated retainer (B5).
      if (input.term) {
        await this.terms.createIn(
          tx,
          actorOf(actor),
          { id: created, startDate: input.startDate },
          {
            ...input.term,
            startCycle: backdated ? 1 : Math.max(1, currentCycleNumber(input.startDate, today)),
          },
          today,
          { backdated },
        );
      }
      if (backdated) await this.catchUp(tx, actor, created, input, today);
      // R3, Y3: a retainer that has started gets its current cycle at once.
      await this.start(tx, actor, created, input.startDate);
      return created;
    });
    return this.detail(actor, id);
  }

  /**
   * F05C B3, B4, B7: the past cycles of a new backdated retainer, oldest first: each recorded
   * closed with its delivery choice and charged with its billing choice; the charges drafted now
   * become due (their drafts follow, C3, C4) before the current cycle opens.
   */
  private async catchUp(
    tx: Transaction,
    actor: CurrentUserInfo,
    retainerId: string,
    input: CreateRetainer,
    today: CalendarDate,
  ): Promise<void> {
    const retainer = { id: retainerId, startDate: input.startDate };
    const entries = [...(input.catchUp ?? [])].sort((a, b) => a.cycle - b.cycle);
    const recorded = [];
    for (const entry of entries) {
      const period = cyclePeriod(input.startDate, entry.cycle);
      await this.cycles.createBackdated(tx, retainer, entry.cycle, entry.delivered);
      const amountMinor = await this.charges.catchUp(
        tx,
        retainerId,
        { number: entry.cycle, start: period.periodStart },
        entry.billing,
        input.monthlyFeeMinor ?? null,
        actorOf(actor),
      );
      recorded.push({ ...entry, ...period, amountMinor });
    }
    await recordAudit(tx, {
      actor: actorOf(actor),
      action: 'retainer.backdated',
      entityType: 'retainer',
      entityId: retainerId,
      after: { startDate: input.startDate, pastCycles: recorded },
    });
    await this.charges.runDue(tx, retainerId, today, actorOf(actor));
  }

  /**
   * Creates a retainer and its standing lines in the caller's transaction, without its first
   * cycle: `start` opens it, once the caller linked a template (F04 A8). `backdate`: the new
   * retainer form, whose start date may be up to 12 months back with its catch-up (F05C B1, B2);
   * otherwise (quote acceptance, B6) it starts in the cycle holding today or later.
   */
  async createIn(
    tx: Transaction,
    actor: CurrentUserInfo,
    input: CreateRetainer,
    options: { backdate?: boolean } = {},
  ): Promise<string> {
    const client = await this.clients.summary(input.clientId, tx, { forUpdate: true });
    if (!client) throw new NotFoundException();
    if (!coversClient(actor, client)) throw new ForbiddenException();
    assertClientTakesWork(client);
    if (
      input.currency !== undefined ||
      input.monthlyFeeMinor !== undefined ||
      input.term !== undefined ||
      input.catchUp !== undefined
    ) {
      assertCanEditMoney(actor, client);
    }
    assertLines(input.deliverables);
    const today = businessDate();
    if (options.backdate) {
      assertBackdate(input.startDate, today);
      assertCatchUp(input, today);
    } else {
      assertStartDate(input.startDate, today);
    }
    await this.assertNameFree(tx, client.id, input.name);
    await this.users.assertActiveDepartments(input.departments, tx);

    const values = {
      name: input.name,
      departments: input.departments,
      startDate: input.startDate,
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
      after: {
        ...values,
        client: { id: client.id, name: client.name },
        deliverables: lines,
      },
    });
    return created.id;
  }

  /** R3, F05C Y3: a retainer that has started gets its current cycle. */
  async start(
    tx: Transaction,
    actor: CurrentUserInfo,
    retainerId: string,
    startDate: string,
  ): Promise<void> {
    const today = businessDate();
    if (startDate <= today) {
      await this.cycles.open(tx, { id: retainerId, startDate }, today, actorOf(actor));
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
      // F05C edge case 8: cycle numbers never move once a cycle or a charge exists.
      if (
        startChanges &&
        ((await this.cycles.hasCycles(tx, id)) || (await this.charges.hasCharges(tx, id)))
      ) {
        throw new CodedException(
          409,
          'RETAINER_STARTED',
          'The start date is fixed once the retainer has a cycle or a charge',
        );
      }
      if (startChanges && input.startDate) assertStartDate(input.startDate, businessDate());
      if (input.name !== undefined && input.name.toLowerCase() !== current.name.toLowerCase()) {
        await this.assertNameFree(tx, retainer.clientId, input.name, id);
      }
      if (input.departments) {
        const added = input.departments.filter((code) => !current.departments.includes(code));
        await this.users.assertActiveDepartments(added, tx);
      }

      const basics = changedFields(
        {
          name: current.name,
          departments: current.departments,
          startDate: current.startDate,
        },
        {
          name: input.name,
          departments: changedDepartments(current.departments, input.departments),
          startDate: input.startDate,
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
      const startDate = input.startDate ?? current.startDate;
      if (startChanges && startDate <= today && retainer.status === 'active') {
        await this.cycles.open(tx, { id, startDate }, today, actorOf(actor));
      }
      // F05B C2: a fee set while the open cycle has none charges that cycle.
      if (money?.after.monthlyFeeMinor && !current.monthlyFeeMinor) {
        await this.charges.chargeOpenCycle(
          tx,
          { id, startDate },
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

  /**
   * The status diagram (R3, R5, F05C P1–P4): who may make each change is checked after it is
   * allowed.
   */
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
      if (change.startNow !== undefined && to !== 'active') {
        throw new BadRequestException('"Start now" comes only with resuming or reactivating');
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
      const resume = to === 'active' ? await this.resumePlan(tx, retainer, change, today) : null;
      await tx
        .update(retainers)
        .set({
          status: to,
          ...(to === 'ended' && { endedOn: today, cyclesFrom: null }),
          ...(reactivating && { endedOn: null }),
          ...(resume && { cyclesFrom: resume.cyclesFrom }),
        })
        .where(eq(retainers.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'retainer.status_changed',
        entityType: 'retainer',
        entityId: id,
        before: { status: retainer.status },
        after: {
          status: to,
          ...(resume?.opensNow && { startNow: true }),
          ...(resume?.cyclesFrom && { cyclesFrom: resume.cyclesFrom }),
        },
      });
      if (to === 'ended') {
        await this.cycles.closeAll(tx, id, today, actorOf(actor));
        // F05B E1, E2: later cycles are cancelled; a termination fee drafts at once.
        await this.terms.endEarly(tx, retainer, today, actorOf(actor));
        await this.amendments.cancelOpen(tx, id, actorOf(actor));
        if (change.termination) {
          const number = Math.max(1, currentCycleNumber(retainer.startDate, today));
          await this.charges.createTerminationFee(
            tx,
            id,
            { number, start: cyclePeriod(retainer.startDate, number).periodStart },
            today,
            change.termination,
            actorOf(actor),
          );
        }
      }
      // P2, P3: a cycle started now runs from today to the end of its period.
      if (resume?.opensNow) {
        await this.cycles.open(tx, retainer, today, actorOf(actor), { startNow: true });
      }
      await this.notices.retainerStatus(tx, id, to, actor.id);
    });
    return this.detail(actor, id);
  }

  /**
   * F05C P2–P4: what resuming or reactivating does to the current cycle. With an open cycle row
   * nothing changes (paused and resumed in the same cycle). Without one, a term's cycle opens now
   * (its charge is due anyway, P3); an open-ended retainer starts now on request, else at the
   * next cycle (`cycles_from`). A cycle that closed when the retainer ended stays closed
   * (`CYCLE_CLOSED` for "start now").
   */
  private async resumePlan(
    tx: Transaction,
    retainer: { id: string; startDate: CalendarDate },
    change: RetainerStatusChange,
    today: CalendarDate,
  ): Promise<{ opensNow: boolean; cyclesFrom: CalendarDate | null }> {
    const current = currentCycleNumber(retainer.startDate, today);
    // Not started yet: its first cycle opens on its start date.
    if (current === 0) return { opensNow: false, cyclesFrom: null };
    const [row] = await tx
      .select({ status: retainerCycles.status })
      .from(retainerCycles)
      .where(and(eq(retainerCycles.retainerId, retainer.id), eq(retainerCycles.number, current)));
    const nextStart = cyclePeriod(retainer.startDate, current + 1).periodStart;
    if (row?.status === 'open') return { opensNow: false, cyclesFrom: null };
    if (row) {
      if (change.startNow) {
        throw new CodedException(
          409,
          'CYCLE_CLOSED',
          'The current cycle closed; the retainer starts again at the next cycle',
        );
      }
      return { opensNow: false, cyclesFrom: nextStart };
    }
    if (await this.terms.covering(tx, retainer.id, current)) {
      return { opensNow: true, cyclesFrom: null };
    }
    return change.startNow
      ? { opensNow: true, cyclesFrom: null }
      : { opensNow: false, cyclesFrom: nextStart };
  }

  /** F01C rules 1, 3, 5 and 18: the retainer's own image, shown instead of its client's logo. */
  async setImage(actor: CurrentUserInfo, id: string, input: SetImage): Promise<Image> {
    const image = await this.db.transaction(async (tx) => {
      const { retainer, imageId } = await this.lockForImage(tx, actor, id);
      const stored = await this.images.set(tx, actor, { type: 'retainer', id }, input);
      await tx.update(retainers).set({ imageId: stored.image.id }).where(eq(retainers.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'retainer.image_set',
        entityType: 'retainer',
        entityId: id,
        ...(imageId && { before: { imageId } }),
        after: { imageId: stored.image.id, source: stored.source },
      });
      await this.notices.imageChanged(tx, { kind: 'retainer', ...retainer }, false, actor.id);
      return stored.image;
    });
    await this.images.queueRenders();
    return image;
  }

  /** F01C rules 3 and 4: back to the client's logo; nothing changes without an image. */
  async removeImage(actor: CurrentUserInfo, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const { retainer, imageId } = await this.lockForImage(tx, actor, id);
      if (!imageId) return;
      await this.images.remove(tx, actor, { type: 'retainer', id });
      await tx.update(retainers).set({ imageId: null }).where(eq(retainers.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'retainer.image_removed',
        entityType: 'retainer',
        entityId: id,
        before: { imageId },
        after: { imageId: null },
      });
      await this.notices.imageChanged(tx, { kind: 'retainer', ...retainer }, true, actor.id);
    });
  }

  /** Client scope, on a retainer that is not archived (ended ones too). */
  private async lockForImage(tx: Transaction, actor: CurrentUserInfo, id: string) {
    const retainer = await readableRetainer(tx, this.clients, actor, id, { forUpdate: true });
    if (!coversClient(actor, retainer.client)) throw new ForbiddenException();
    assertRetainerNotArchived(retainer);
    const [row] = await tx
      .select({ imageId: retainers.imageId })
      .from(retainers)
      .where(eq(retainers.id, id));
    return { retainer, imageId: row?.imageId ?? null };
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
      await this.notices.retainerArchived(tx, id, actor.id);
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

/** F05C B1: the cycles of a retainer that ended before the current one; 0 when it starts later. */
function pastCycles(startDate: CalendarDate, today: CalendarDate): number {
  return Math.max(0, currentCycleNumber(startDate, today) - 1);
}

/** F05C B1: a new retainer starts from today − 12 months (`INVALID_DATES` beyond). */
function assertBackdate(startDate: CalendarDate, today: CalendarDate): void {
  if (startDate < addMonths(today, -BACKDATE_LIMIT_MONTHS)) {
    throw new CodedException(
      400,
      'INVALID_DATES',
      'A retainer starts at most 12 months before today',
    );
  }
}

/** F05C B2: one complete catch-up entry per past cycle, none without past cycles. */
function assertCatchUp(input: CreateRetainer, today: CalendarDate): void {
  const past = pastCycles(input.startDate, today);
  if (!catchUpComplete(input.catchUp ?? [], past, input.deliverables.length)) {
    throw new CodedException(
      400,
      'CATCH_UP_REQUIRED',
      'Each past cycle needs its billing and delivery, with a count per line when entered',
      { pastCycles: past },
    );
  }
}

/**
 * A start date falls in the cycle that holds `today` or later (quote acceptance, F05C B6; an
 * edited start date): earlier cycles need the new retainer form's catch-up.
 */
function assertStartDate(startDate: CalendarDate, today: CalendarDate): void {
  if (addMonths(startDate, 1) <= today) {
    throw new CodedException(
      400,
      'INVALID_DATES',
      'The start date falls in a cycle that has already ended',
    );
  }
}

/** F05C Y6: the open cycle as the header shows it, with its place in the term covering it. */
function presentCurrent(
  cycle: Cycle | undefined,
  term: RetainerTermSummary | undefined,
  today: CalendarDate,
): CurrentCycle | null {
  if (!cycle) return null;
  const covered =
    term && term.startCycle <= cycle.number && cycle.number < term.startCycle + term.cycles;
  return {
    ...cycle,
    daysLeft: cycleDaysLeft(cycle, today),
    termPosition: covered ? cycle.number - term.startCycle + 1 : null,
    termCycles: covered ? term.cycles : null,
  };
}

/**
 * F05C Y6: when the next cycle opens, for a retainer without an open cycle that will open one:
 * its start date before it starts, `cycles_from` once resumed "from the next cycle", the next
 * anchor day while paused or between cycles; null once ended or with an open cycle (unless
 * paused, which opens none).
 */
function nextCycleStart(
  row: SummaryRow,
  cycle: Cycle | undefined,
  today: CalendarDate,
): CalendarDate | null {
  if (row.status === 'ended') return null;
  if (row.startDate > today) return row.startDate;
  if (row.status === 'active' && cycle) return null;
  if (row.status === 'active' && row.cyclesFrom) return row.cyclesFrom;
  return cyclePeriod(row.startDate, currentCycleNumber(row.startDate, today) + 1).periodStart;
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
  const cycle = context.currentCycles.get(row.id);
  const term = context.terms.get(row.id);
  return {
    id: row.id,
    name: row.name,
    client: clientRef(context.clients, row.clientId),
    // F01C rule 3: its own image, else the client's logo.
    imageId: row.imageId ?? client?.imageId ?? null,
    accountManager: personRef(context.people, managerId),
    departments: row.departments,
    status: row.status,
    renewalDate: row.renewalDate,
    renewal: renewalState(row.renewalDate, row.status, context.today),
    term: term ?? null,
    pendingAmendments: context.pending.get(row.id) ?? 0,
    currentCycle: presentCurrent(cycle, term, context.today),
    nextCycleStart: nextCycleStart(row, cycle, context.today),
  };
}
