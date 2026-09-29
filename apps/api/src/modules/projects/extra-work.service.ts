import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type AuditAction,
  billingNeedsNote,
  businessDate,
  type CreateExtraWork,
  type Currency,
  type ExtraWork,
  type ExtraWorkBilling,
  type ExtraWorkBillingChange,
  type ExtraWorkListQuery,
  type ExtraWorkPage,
  type UpdateExtraWork,
} from '@vertex-hub/contracts';
import { type Database, extraWorkItems, projects, type Transaction } from '@vertex-hub/db';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { changedFields, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { ClientDirectory, type ClientSummary } from '../clients/index.js';
import {
  actorOf,
  assertCanEditMoney,
  assertNotArchived,
  coversClient,
  readableProject,
  seesMoney,
  workableProject,
} from './project-access.js';
import {
  assertRetainerNotArchived,
  readableRetainer,
  workableRetainer,
} from './retainer-access.js';

/** What extra work is logged on. */
export type ExtraWorkOwnerKind = 'project' | 'retainer';

interface Owner {
  kind: ExtraWorkOwnerKind;
  id: string;
  client: ClientSummary;
  currency: Currency;
  /** `PROJECT_ARCHIVED`, `RETAINER_ARCHIVED` or `CLIENT_ARCHIVED` when read-only. */
  assertNotArchived: () => void;
}

type Executor = Database | Transaction;

const itemColumns = {
  id: extraWorkItems.id,
  projectId: extraWorkItems.projectId,
  retainerId: extraWorkItems.retainerId,
  title: extraWorkItems.title,
  description: extraWorkItems.description,
  requestedOn: extraWorkItems.requestedOn,
  requestedByContactId: extraWorkItems.requestedByContactId,
  estimateMinor: extraWorkItems.estimateMinor,
  billingStatus: extraWorkItems.billingStatus,
  billingNote: extraWorkItems.billingNote,
  loggedById: extraWorkItems.loggedById,
  createdAt: extraWorkItems.createdAt,
};

type ItemRow = {
  id: string;
  projectId: string | null;
  retainerId: string | null;
  title: string;
  description: string | null;
  requestedOn: string;
  requestedByContactId: string | null;
  estimateMinor: number | null;
  billingStatus: ExtraWorkBilling;
  billingNote: string | null;
  loggedById: string;
  createdAt: Date;
};

const ownerColumn = (kind: ExtraWorkOwnerKind) =>
  kind === 'project' ? extraWorkItems.projectId : extraWorkItems.retainerId;

/** Out-of-scope work on projects and retainers, for separate billing (spec F05, M3). */
@Injectable()
export class ExtraWorkService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
  ) {}

  async list(
    actor: CurrentUserInfo,
    kind: ExtraWorkOwnerKind,
    ownerId: string,
    query: ExtraWorkListQuery,
  ): Promise<ExtraWorkPage> {
    const owner = await this.readable(this.db, actor, kind, ownerId);
    const where = and(
      eq(ownerColumn(kind), ownerId),
      isNull(extraWorkItems.archivedAt),
      inArray(extraWorkItems.billingStatus, query.billingStatus),
    );
    const [rows, [total]] = await Promise.all([
      this.db
        .select(itemColumns)
        .from(extraWorkItems)
        .where(where)
        .orderBy(
          desc(extraWorkItems.requestedOn),
          desc(extraWorkItems.createdAt),
          desc(extraWorkItems.id),
        )
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ value: count() }).from(extraWorkItems).where(where),
    ]);
    return {
      items: await this.present(rows, owner, seesMoney(actor, owner.client)),
      total: total?.value ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** M3: logged on an open project or a running retainer; the estimate needs money access. */
  async create(
    actor: CurrentUserInfo,
    kind: ExtraWorkOwnerKind,
    ownerId: string,
    input: CreateExtraWork,
  ): Promise<ExtraWork> {
    const id = await this.db.transaction(async (tx) => {
      const owner = await this.workable(tx, actor, kind, ownerId);
      if (input.estimateMinor !== undefined) assertCanEditMoney(actor, owner.client);
      const values = {
        title: input.title,
        description: input.description ?? null,
        requestedOn: input.requestedOn ?? businessDate(),
        requestedByContactId: input.requestedByContactId ?? null,
        estimateMinor: input.estimateMinor ?? null,
      };
      assertRequestedOn(values.requestedOn);
      await this.assertContact(tx, owner, values.requestedByContactId);
      const [created] = await tx
        .insert(extraWorkItems)
        .values({
          ...values,
          projectId: kind === 'project' ? ownerId : null,
          retainerId: kind === 'retainer' ? ownerId : null,
          loggedById: actor.id,
        })
        .returning({ id: extraWorkItems.id });
      if (!created) throw new Error('Extra work insert returned no row');
      await this.audit(tx, actor, 'extra_work.created', created.id, owner, { after: values });
      return created.id;
    });
    return this.one(actor, kind, ownerId, id);
  }

  async update(
    actor: CurrentUserInfo,
    kind: ExtraWorkOwnerKind,
    ownerId: string,
    itemId: string,
    input: UpdateExtraWork,
  ): Promise<ExtraWork> {
    await this.db.transaction(async (tx) => {
      const owner = await this.workable(tx, actor, kind, ownerId);
      if (input.estimateMinor !== undefined) assertCanEditMoney(actor, owner.client);
      const current = await this.item(tx, owner, itemId, { forUpdate: true });
      const change = changedFields(
        {
          title: current.title,
          description: current.description,
          requestedOn: current.requestedOn,
          requestedByContactId: current.requestedByContactId,
          estimateMinor: current.estimateMinor,
        },
        input,
      );
      if (!change) return;
      if (change.after.requestedOn !== undefined) assertRequestedOn(change.after.requestedOn);
      if (change.after.requestedByContactId !== undefined) {
        await this.assertContact(tx, owner, change.after.requestedByContactId);
      }
      await tx.update(extraWorkItems).set(change.after).where(eq(extraWorkItems.id, itemId));
      await this.audit(tx, actor, 'extra_work.updated', itemId, owner, change);
    });
    return this.one(actor, kind, ownerId, itemId);
  }

  /**
   * M3: client scope and money access. Billing follows the work after it is done, so it stays
   * open on completed and cancelled projects and on ended retainers; not on archived ones.
   */
  async changeBilling(
    actor: CurrentUserInfo,
    kind: ExtraWorkOwnerKind,
    ownerId: string,
    itemId: string,
    input: ExtraWorkBillingChange,
  ): Promise<ExtraWork> {
    await this.db.transaction(async (tx) => {
      const owner = await this.readable(tx, actor, kind, ownerId, { forUpdate: true });
      if (!coversClient(actor, owner.client) || !seesMoney(actor, owner.client)) {
        throw new ForbiddenException();
      }
      owner.assertNotArchived();
      const current = await this.item(tx, owner, itemId, { forUpdate: true });
      const note = input.billingNote ?? null;
      if (billingNeedsNote(input.billingStatus) && !note) {
        throw new CodedException(
          400,
          'BILLING_NOTE_REQUIRED',
          'Billed needs the invoice reference; waived needs why it is free',
        );
      }
      const change = changedFields(
        { billingStatus: current.billingStatus, billingNote: current.billingNote },
        { billingStatus: input.billingStatus, billingNote: note },
      );
      if (!change) return;
      await tx
        .update(extraWorkItems)
        .set({ billingStatus: input.billingStatus, billingNote: note })
        .where(eq(extraWorkItems.id, itemId));
      await this.audit(tx, actor, 'extra_work.billing_changed', itemId, owner, change);
    });
    return this.one(actor, kind, ownerId, itemId);
  }

  async archive(
    actor: CurrentUserInfo,
    kind: ExtraWorkOwnerKind,
    ownerId: string,
    itemId: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const owner = await this.workable(tx, actor, kind, ownerId);
      await this.item(tx, owner, itemId, { forUpdate: true });
      await tx
        .update(extraWorkItems)
        .set({ archivedAt: new Date() })
        .where(eq(extraWorkItems.id, itemId));
      await this.audit(tx, actor, 'extra_work.archived', itemId, owner, {
        before: { archived: false },
        after: { archived: true },
      });
    });
  }

  private async one(
    actor: CurrentUserInfo,
    kind: ExtraWorkOwnerKind,
    ownerId: string,
    itemId: string,
  ): Promise<ExtraWork> {
    const owner = await this.readable(this.db, actor, kind, ownerId);
    const row = await this.item(this.db, owner, itemId);
    const [item] = await this.present([row], owner, seesMoney(actor, owner.client));
    if (!item) throw new NotFoundException();
    return item;
  }

  private async present(rows: ItemRow[], owner: Owner, withMoney: boolean): Promise<ExtraWork[]> {
    const [contacts, people] = await Promise.all([
      this.clients.contactSummaries(
        rows.flatMap((row) => (row.requestedByContactId ? [row.requestedByContactId] : [])),
      ),
      this.users.summaries(rows.map((row) => row.loggedById)),
    ]);
    return rows.map((row) => {
      const contact = row.requestedByContactId ? contacts.get(row.requestedByContactId) : null;
      return {
        id: row.id,
        projectId: row.projectId,
        retainerId: row.retainerId,
        title: row.title,
        description: row.description,
        requestedOn: row.requestedOn,
        contact: contact ?? null,
        loggedBy: { id: row.loggedById, name: people.get(row.loggedById)?.name ?? '' },
        billingStatus: row.billingStatus,
        billingNote: row.billingNote,
        createdAt: row.createdAt.toISOString(),
        ...(withMoney && {
          money: { estimateMinor: row.estimateMinor, currency: owner.currency },
        }),
      };
    });
  }

  /** The project or retainer, readable by the actor, else 404. */
  private async readable(
    executor: Executor,
    actor: CurrentUserInfo,
    kind: ExtraWorkOwnerKind,
    id: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<Owner> {
    if (kind === 'retainer') {
      const retainer = await readableRetainer(executor, this.clients, actor, id, options);
      return {
        kind,
        id,
        client: retainer.client,
        currency: retainer.currency,
        assertNotArchived: () => assertRetainerNotArchived(retainer),
      };
    }
    const project = await readableProject(executor, this.clients, actor, id, options);
    return {
      kind,
      id,
      client: project.client,
      currency: await this.projectCurrency(executor, id),
      assertNotArchived: () => assertNotArchived(project),
    };
  }

  /**
   * A project the actor works on (client scope or project manager) that is open (rule 7), or a
   * retainer the actor manages that is running (R12).
   */
  private async workable(
    tx: Transaction,
    actor: CurrentUserInfo,
    kind: ExtraWorkOwnerKind,
    id: string,
  ): Promise<Owner> {
    if (kind === 'retainer') {
      const retainer = await workableRetainer(tx, this.clients, actor, id);
      return {
        kind,
        id,
        client: retainer.client,
        currency: retainer.currency,
        assertNotArchived: () => assertRetainerNotArchived(retainer),
      };
    }
    const project = await workableProject(tx, this.clients, actor, id);
    return {
      kind,
      id,
      client: project.client,
      currency: await this.projectCurrency(tx, id),
      assertNotArchived: () => assertNotArchived(project),
    };
  }

  /** The currency of a project's amounts; `readableProject` leaves it out. */
  private async projectCurrency(executor: Executor, projectId: string): Promise<Currency> {
    const [row] = await executor
      .select({ currency: projects.currency })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!row) throw new NotFoundException();
    return row.currency;
  }

  /** A non-archived item of the owner, else 404. */
  private async item(
    executor: Executor,
    owner: Owner,
    itemId: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<ItemRow> {
    const query = executor
      .select(itemColumns)
      .from(extraWorkItems)
      .where(
        and(
          eq(extraWorkItems.id, itemId),
          eq(ownerColumn(owner.kind), owner.id),
          isNull(extraWorkItems.archivedAt),
        ),
      );
    const [row] = options.forUpdate ? await query.for('update') : await query;
    if (!row) throw new NotFoundException();
    return row;
  }

  /** The requesting contact is a non-archived contact of the owner's client. */
  private async assertContact(tx: Transaction, owner: Owner, contactId: string | null) {
    if (contactId === null) return;
    if (!(await this.clients.isActiveContact(owner.client.id, contactId, tx))) {
      throw new CodedException(
        400,
        'UNKNOWN_CONTACT',
        'The contact is not a contact of the client',
      );
    }
  }

  /** Extra work entries carry their project or retainer, so the audit log links them. */
  private audit(
    tx: Transaction,
    actor: CurrentUserInfo,
    action: AuditAction,
    itemId: string,
    owner: Owner,
    change: { before?: Record<string, unknown>; after: Record<string, unknown> },
  ) {
    return recordAudit(tx, {
      actor: actorOf(actor),
      action,
      entityType: 'extra_work',
      entityId: itemId,
      before: change.before ?? null,
      after: {
        ...change.after,
        ...(owner.kind === 'project' ? { projectId: owner.id } : { retainerId: owner.id }),
      },
    });
  }
}

/** The request date is not in the future. */
function assertRequestedOn(requestedOn: string): void {
  if (requestedOn > businessDate()) {
    throw new CodedException(400, 'INVALID_DATES', 'The request date is in the future');
  }
}
