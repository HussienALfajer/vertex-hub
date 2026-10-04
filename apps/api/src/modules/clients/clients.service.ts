import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  type AuditAction,
  type BrandKit,
  brandKitSchema,
  type ClientDetailResponse,
  type ClientListQuery,
  type ClientPage,
  type ClientResponse,
  type ClientStatus,
  type CreateClient,
  type SectorListResponse,
  type UpdateClient,
} from '@vertex-hub/contracts';
import { clientContacts, clientPlatformAccounts, clients, type Database } from '@vertex-hub/db';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  type SQL,
  sql,
} from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { changedFields, recordAudit } from '../audit/index.js';
import {
  type CurrentUserInfo,
  lockAccessChanges,
  ResponsibilityRegistry,
  UserDirectory,
  type UserSummary,
} from '../auth/index.js';
import {
  actorOf,
  covers,
  holdsAll,
  manageableClient,
  readableClient,
  readableClients,
} from './client-access.js';
import { ClientFactory, LIVE_STATUSES } from './client-factory.js';
import { ClientFlagHooks } from './client-flag-hooks.js';

type Change = { before: Record<string, unknown>; after: Record<string, unknown> };

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * A non-archived contact of the client has final-approval authority (rule 9). The outer id is
 * qualified by hand: Drizzle leaves columns unqualified in single-table selects.
 */
const hasApprovalContact = sql<boolean>`exists (
  select 1 from ${clientContacts}
  where ${clientContacts.clientId} = ${clients}.${sql.identifier(clients.id.name)}
    and ${clientContacts.archivedAt} is null
    and ${clientContacts.hasFinalApproval})`;

const summaryColumns = {
  id: clients.id,
  tradeName: clients.tradeName,
  sector: clients.sector,
  status: clients.status,
  isHealthcare: clients.isHealthcare,
  accountManagerId: clients.accountManagerId,
  hasApprovalContact,
};

type SummaryRow = {
  id: string;
  tradeName: string;
  sector: string | null;
  status: ClientStatus;
  isHealthcare: boolean;
  accountManagerId: string;
  hasApprovalContact: boolean;
};

/** Client basics, archive and restore, and the brand kit (F02). */
@Injectable()
export class ClientsService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly responsibilities: ResponsibilityRegistry,
    private readonly factory: ClientFactory,
    private readonly flagHooks: ClientFlagHooks,
  ) {}

  /** A user cannot be archived or lose the Account Manager role while they manage a live client. */
  onModuleInit(): void {
    this.responsibilities.register({
      role: 'account_manager',
      find: async (tx, userId) => {
        const managed = await tx
          .select({ id: clients.id, name: clients.tradeName })
          .from(clients)
          .where(
            and(
              eq(clients.accountManagerId, userId),
              inArray(clients.status, LIVE_STATUSES),
              isNull(clients.archivedAt),
            ),
          )
          .orderBy(asc(clients.tradeName));
        return managed.map((client) => ({ type: 'account_manager_of_client' as const, ...client }));
      },
    });
  }

  async list(actor: CurrentUserInfo, query: ClientListQuery): Promise<ClientPage> {
    if (query.archived && !holdsAll(actor, 'clients.manage')) throw new ForbiddenException();

    const filters: (SQL | undefined)[] = [
      query.archived ? isNotNull(clients.archivedAt) : isNull(clients.archivedAt),
      readableClients(actor),
      inArray(clients.status, query.status),
    ];
    if (query.search) filters.push(ilike(clients.tradeName, `%${escapeLike(query.search)}%`));
    if (query.accountManagerId) filters.push(eq(clients.accountManagerId, query.accountManagerId));
    if (query.sector) filters.push(sql`lower(${clients.sector}) = lower(${query.sector})`);
    if (query.healthcare !== undefined) filters.push(eq(clients.isHealthcare, query.healthcare));
    const where = and(...filters);

    const sortColumn =
      query.sort === 'createdAt' ? clients.createdAt : sql`lower(${clients.tradeName})`;
    const order = query.order === 'desc' ? desc : asc;
    const [rows, [total]] = await Promise.all([
      this.db
        .select(summaryColumns)
        .from(clients)
        .where(where)
        .orderBy(order(sortColumn), asc(clients.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ value: count() }).from(clients).where(where),
    ]);
    const managers = await this.users.summaries(rows.map((row) => row.accountManagerId));
    return {
      items: rows.map((row) => toClient(row, managers)),
      total: total?.value ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Sectors in use, one spelling per sector regardless of case (edge case 10). */
  async sectors(actor: CurrentUserInfo): Promise<SectorListResponse> {
    const rows = await this.db
      .select({ sector: sql<string>`min(${clients.sector})` })
      .from(clients)
      .where(and(isNull(clients.archivedAt), isNotNull(clients.sector), readableClients(actor)))
      .groupBy(sql`lower(${clients.sector})`)
      .orderBy(sql`lower(${clients.sector})`);
    return { items: rows.map((row) => row.sector) };
  }

  async detail(actor: CurrentUserInfo, id: string): Promise<ClientDetailResponse> {
    const access = await readableClient(this.db, actor, id);
    const [[row], contacts, platformAccounts] = await Promise.all([
      this.db
        .select({
          ...summaryColumns,
          brandKit: clients.brandKit,
          billingName: clients.billingName,
          billingAddress: clients.billingAddress,
          archivedAt: clients.archivedAt,
        })
        .from(clients)
        .where(eq(clients.id, id)),
      this.db
        .select({
          id: clientContacts.id,
          clientId: clientContacts.clientId,
          name: clientContacts.name,
          jobTitle: clientContacts.jobTitle,
          phone: clientContacts.phone,
          email: clientContacts.email,
          hasFinalApproval: clientContacts.hasFinalApproval,
          notes: clientContacts.notes,
        })
        .from(clientContacts)
        .where(and(eq(clientContacts.clientId, id), isNull(clientContacts.archivedAt)))
        .orderBy(asc(clientContacts.name), asc(clientContacts.id)),
      this.db
        .select({
          id: clientPlatformAccounts.id,
          clientId: clientPlatformAccounts.clientId,
          platform: clientPlatformAccounts.platform,
          label: clientPlatformAccounts.label,
          url: clientPlatformAccounts.url,
          agencyAccess: clientPlatformAccounts.agencyAccess,
          adminNote: clientPlatformAccounts.adminNote,
        })
        .from(clientPlatformAccounts)
        .where(
          and(eq(clientPlatformAccounts.clientId, id), isNull(clientPlatformAccounts.archivedAt)),
        )
        .orderBy(asc(clientPlatformAccounts.id)),
    ]);
    if (!row) throw new NotFoundException();
    const managers = await this.users.summaries([row.accountManagerId]);
    return {
      ...toClient(row, managers),
      brandKit: row.brandKit,
      contacts,
      platformAccounts,
      billingName: row.billingName,
      billingAddress: row.billingAddress,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      canManage: !row.archivedAt && covers(actor, 'clients.manage', access),
    };
  }

  async create(actor: CurrentUserInfo, input: CreateClient): Promise<ClientDetailResponse> {
    if (!holdsAll(actor, 'clients.manage')) throw new ForbiddenException();
    const id = await this.db.transaction(async (tx) => {
      // Serialized with archiving users and removing roles (rule 14).
      await lockAccessChanges(tx);
      return this.factory.create(tx, actorOf(actor), { ...input, sector: input.sector ?? null });
    });
    return this.detail(actor, id);
  }

  async update(
    actor: CurrentUserInfo,
    id: string,
    input: UpdateClient,
  ): Promise<ClientDetailResponse> {
    await this.db.transaction(async (tx) => {
      // Changes that depend on the account manager's validity take the access lock first.
      if (input.accountManagerId !== undefined || input.status !== undefined) {
        await lockAccessChanges(tx);
      }
      await manageableClient(tx, actor, id);
      const [current] = await tx
        .select({
          tradeName: clients.tradeName,
          sector: clients.sector,
          billingName: clients.billingName,
          billingAddress: clients.billingAddress,
          status: clients.status,
          isHealthcare: clients.isHealthcare,
          accountManagerId: clients.accountManagerId,
        })
        .from(clients)
        .where(eq(clients.id, id));
      if (!current) throw new NotFoundException();

      const managerChanges =
        input.accountManagerId !== undefined && input.accountManagerId !== current.accountManagerId;
      const healthcareChanges =
        input.isHealthcare !== undefined && input.isHealthcare !== current.isHealthcare;
      if ((managerChanges || healthcareChanges) && !holdsAll(actor, 'clients.manage')) {
        throw new ForbiddenException();
      }

      const status = input.status ?? current.status;
      const reactivates = current.status === 'ended' && LIVE_STATUSES.includes(status);
      let manager: UserSummary | undefined;
      if (managerChanges || reactivates) {
        manager = await this.factory.validAccountManager(
          tx,
          input.accountManagerId ?? current.accountManagerId,
        );
      }
      if (input.tradeName !== undefined && input.tradeName !== current.tradeName) {
        await this.factory.assertNameFree(tx, input.tradeName, id);
      }

      const audit = async (action: AuditAction, change: Change | null) => {
        if (!change) return;
        await recordAudit(tx, {
          actor: actorOf(actor),
          action,
          entityType: 'client',
          entityId: id,
          ...change,
        });
      };

      const basics = changedFields(
        {
          tradeName: current.tradeName,
          sector: current.sector,
          billingName: current.billingName,
          billingAddress: current.billingAddress,
        },
        {
          tradeName: input.tradeName,
          sector: input.sector,
          billingName: input.billingName,
          billingAddress: input.billingAddress,
        },
      );
      const statusChange = changedFields({ status: current.status }, { status: input.status });
      const healthcare = changedFields(
        { isHealthcare: current.isHealthcare },
        { isHealthcare: input.isHealthcare },
      );
      let managerChange: Change | null = null;
      if (managerChanges && manager) {
        const previous = (await this.users.summaries([current.accountManagerId], tx)).get(
          current.accountManagerId,
        );
        managerChange = {
          before: { accountManager: { id: current.accountManagerId, name: previous?.name ?? '' } },
          after: { accountManager: { id: manager.id, name: manager.name } },
        };
      }
      if (!basics && !statusChange && !healthcare && !managerChange) return;

      await tx
        .update(clients)
        .set({
          ...basics?.after,
          ...statusChange?.after,
          ...healthcare?.after,
          ...(managerChange && manager && { accountManagerId: manager.id }),
        })
        .where(eq(clients.id, id));
      await audit('client.updated', basics);
      await audit('client.status_changed', statusChange);
      await audit('client.account_manager_changed', managerChange);
      await audit('client.healthcare_changed', healthcare);
      // F09 rules 18 and 19: the change applies to the client's work not yet sent.
      if (healthcare && input.isHealthcare !== undefined) {
        await this.flagHooks.healthcareChanged(tx, {
          clientId: id,
          isHealthcare: input.isHealthcare,
          actor: actorOf(actor),
        });
      }
      if (managerChange && manager) {
        const tradeName = input.tradeName ?? current.tradeName;
        await this.factory.notifyManager(tx, actorOf(actor), id, manager.id, tradeName);
      }
    });
    return this.detail(actor, id);
  }

  async archive(actor: CurrentUserInfo, id: string): Promise<ClientDetailResponse> {
    if (!holdsAll(actor, 'clients.manage')) throw new ForbiddenException();
    await this.db.transaction(async (tx) => {
      const client = await readableClient(tx, actor, id, { forUpdate: true });
      if (client.archivedAt) {
        throw new CodedException(409, 'CLIENT_ARCHIVED', 'The client is already archived');
      }
      await tx.update(clients).set({ archivedAt: new Date() }).where(eq(clients.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'client.archived',
        entityType: 'client',
        entityId: id,
        before: { archived: false },
        after: { archived: true },
      });
    });
    return this.detail(actor, id);
  }

  async restore(actor: CurrentUserInfo, id: string): Promise<ClientDetailResponse> {
    if (!holdsAll(actor, 'clients.manage')) throw new ForbiddenException();
    await this.db.transaction(async (tx) => {
      await lockAccessChanges(tx);
      const client = await readableClient(tx, actor, id, { forUpdate: true });
      if (!client.archivedAt) {
        throw new CodedException(409, 'CLIENT_NOT_ARCHIVED', 'The client is not archived');
      }
      const [current] = await tx
        .select({ tradeName: clients.tradeName, status: clients.status })
        .from(clients)
        .where(eq(clients.id, id));
      if (!current) throw new NotFoundException();
      await this.factory.assertNameFree(tx, current.tradeName, id);
      if (LIVE_STATUSES.includes(current.status)) {
        await this.factory.validAccountManager(tx, client.accountManagerId);
      }
      await tx.update(clients).set({ archivedAt: null }).where(eq(clients.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'client.restored',
        entityType: 'client',
        entityId: id,
        before: { archived: true },
        after: { archived: false },
      });
    });
    return this.detail(actor, id);
  }

  /** Replaces the brand kit; the audit entry holds the changed keys only. */
  async replaceBrandKit(actor: CurrentUserInfo, id: string, kit: BrandKit): Promise<BrandKit> {
    return this.db.transaction(async (tx) => {
      await manageableClient(tx, actor, id);
      const [current] = await tx
        .select({ brandKit: clients.brandKit })
        .from(clients)
        .where(eq(clients.id, id));
      if (!current) throw new NotFoundException();
      // jsonb reorders object keys; parsing restores the schema order so only real changes count.
      const change = changedFields(brandKitSchema.parse(current.brandKit), kit);
      if (change) {
        await tx.update(clients).set({ brandKit: kit }).where(eq(clients.id, id));
        await recordAudit(tx, {
          actor: actorOf(actor),
          action: 'client.brand_kit_updated',
          entityType: 'client',
          entityId: id,
          ...change,
        });
      }
      return kit;
    });
  }
}

function toClient(row: SummaryRow, managers: Map<string, UserSummary>): ClientResponse {
  const manager = managers.get(row.accountManagerId);
  return {
    id: row.id,
    tradeName: row.tradeName,
    sector: row.sector,
    status: row.status,
    isHealthcare: row.isHealthcare,
    accountManager: {
      id: row.accountManagerId,
      name: manager?.name ?? '',
      archived: manager?.archived ?? false,
    },
    hasApprovalContact: row.hasApprovalContact,
  };
}
