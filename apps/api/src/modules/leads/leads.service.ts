import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  businessDate,
  type CalendarDate,
  type CreateLead,
  daysInStage,
  followUpDateInRange,
  followUpFilterRange,
  hasPermission,
  isOpenLeadStage,
  LEAD_LIMITS,
  LEAD_STAGES,
  type Lead,
  type LeadBoard,
  type LeadBoardQuery,
  type LeadDetail,
  type LeadDuplicateQuery,
  type LeadDuplicates,
  type LeadInterest,
  type LeadListQuery,
  type LeadOwnerOptions,
  type LeadPage,
  leadDisplayName,
  leadHasContactMethod,
  leadSourceDetailMissing,
  MANUAL_LEAD_STAGES,
  manualLeadMoveRefusal,
  OPEN_LEAD_STAGES,
  type UpdateLead,
} from '@vertex-hub/contracts';
import { type Database, leadInterests, leadNotes, leads, type Transaction } from '@vertex-hub/db';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
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
  ResponsibilityRegistry,
  UserDirectory,
} from '../auth/index.js';
import { CatalogDirectory } from '../catalog/index.js';
import { ClientDirectory } from '../clients/index.js';
import { NotificationCenter } from '../notifications/index.js';
import { actorOf, coversLead, coversLeadQuotes, holdsAll, readsLead } from './lead-access.js';
import { LeadQuoteChecks } from './lead-closed-hooks.js';

export type LeadRow = typeof leads.$inferSelect;

type LeadNoteRow = typeof leadNotes.$inferSelect;

type Executor = Database | Transaction;

type InterestInput = { serviceId?: string; packageId?: string };

const DAY_MS = 24 * 60 * 60 * 1000;

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** What every lead audit entry carries: the display name. */
export const identity = (row: Pick<LeadRow, 'companyName' | 'contactName'>) => ({
  name: leadDisplayName(row),
});

/** The fields an edit may change, as audited (rule 7). */
const editable = (row: Omit<LeadRow, 'id'> | LeadRow) => ({
  contactName: row.contactName,
  companyName: row.companyName,
  phone: row.phone,
  email: row.email,
  socialHandle: row.socialHandle,
  source: row.source,
  sourceDetail: row.sourceDetail,
  request: row.request,
  budgetMinor: row.budgetMinor,
  budgetCurrency: row.budgetCurrency,
  sector: row.sector,
  isHealthcare: row.isHealthcare,
  nextFollowUpOn: row.nextFollowUpOn,
});

const interestKey = (interest: { serviceId?: string | null; packageId?: string | null }) =>
  interest.serviceId ?? interest.packageId ?? '';

/** Users who may own leads: General Managers, account managers and these departments' members. */
const OWNER_DEPARTMENTS = ['general_communication', 'marketing'] as const;

/**
 * Leads (spec F03): list, board, detail, create, edit, duplicate check and eligible owners.
 * Users, clients and catalog items are read through their modules' directories.
 */
@Injectable()
export class LeadsService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
    private readonly catalog: CatalogDirectory,
    private readonly center: NotificationCenter,
    private readonly quoteChecks: LeadQuoteChecks,
    private readonly responsibilities: ResponsibilityRegistry,
  ) {}

  /**
   * Edge case 3: a user cannot be archived while they own open leads, archived ones included (a
   * restore makes them live again); lost and won leads stay.
   */
  onModuleInit(): void {
    this.responsibilities.register({
      find: async (tx, userId) =>
        (
          await tx
            .select()
            .from(leads)
            .where(and(eq(leads.ownerId, userId), inArray(leads.stage, [...OPEN_LEAD_STAGES])))
            .orderBy(asc(leads.createdAt), asc(leads.id))
        ).map((lead) => ({
          type: 'owner_of_open_leads' as const,
          id: lead.id,
          name: leadDisplayName(lead),
        })),
    });
  }

  async list(actor: CurrentUserInfo, query: LeadListQuery): Promise<LeadPage> {
    if (query.archived && !holdsAll(actor, 'leads.manage')) throw new ForbiddenException();
    const where = and(
      ...this.filters(actor, query),
      inArray(leads.stage, query.stage),
      query.archived ? isNotNull(leads.archivedAt) : isNull(leads.archivedAt),
      query.clientId ? eq(leads.clientId, query.clientId) : undefined,
    );
    const order = query.order === 'desc' ? desc : asc;
    const sort =
      query.sort === 'createdAt'
        ? order(leads.createdAt)
        : query.sort === 'updatedAt'
          ? order(leads.updatedAt)
          : query.sort === 'stageChangedAt'
            ? order(leads.stageChangedAt)
            : sql`${leads.nextFollowUpOn} ${sql.raw(query.order)} nulls last`;
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(leads)
        .where(where)
        .orderBy(sort, asc(leads.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ value: count() }).from(leads).where(where),
    ]);
    return {
      items: await this.summaries(rows),
      total: total?.value ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Screen 1: a column per stage; Won and Lost hold the last 30 days; 200 cards a column. */
  async board(actor: CurrentUserInfo, query: LeadBoardQuery): Promise<LeadBoard> {
    const since = new Date(Date.now() - LEAD_LIMITS.boardClosedDays * DAY_MS);
    const base = [...this.filters(actor, query), isNull(leads.archivedAt)];
    const columns = await Promise.all(
      LEAD_STAGES.map(async (stage) => {
        const open = isOpenLeadStage(stage);
        const where = and(
          ...base,
          eq(leads.stage, stage),
          open ? undefined : gte(leads.closedAt, since),
        );
        const [rows, [total]] = await Promise.all([
          this.db
            .select()
            .from(leads)
            .where(where)
            .orderBy(open ? asc(leads.nextFollowUpOn) : desc(leads.closedAt), asc(leads.id))
            .limit(LEAD_LIMITS.boardColumn),
          this.db.select({ value: count() }).from(leads).where(where),
        ]);
        const value = total?.value ?? 0;
        return { stage, rows, count: value, truncated: value > rows.length };
      }),
    );
    const items = await this.summaries(columns.flatMap((column) => column.rows));
    const byId = new Map(items.map((item) => [item.id, item]));
    return {
      columns: columns.map(({ stage, rows, count: total, truncated }) => ({
        stage,
        count: total,
        truncated,
        items: rows.flatMap((row) => byId.get(row.id) ?? []),
      })),
    };
  }

  /** 404 outside read access; an archived lead only for lead managers with scope all. */
  async detail(actor: CurrentUserInfo, id: string, executor: Executor = this.db) {
    const [row] = await executor.select().from(leads).where(eq(leads.id, id));
    if (!row || !readsLead(actor, row)) throw new NotFoundException();
    return this.toDetail(actor, row, executor);
  }

  /** Rules 1–3. */
  async create(actor: CurrentUserInfo, input: CreateLead): Promise<LeadDetail> {
    const today = businessDate();
    return this.db.transaction(async (tx) => {
      // The owner stays eligible until commit: archiving them waits (edge case 3).
      await lockAccessChanges(tx);
      const { ownerId, interests, ...fields } = input;
      assertLeadFields(fields);
      assertFollowUp(fields.nextFollowUpOn, today);
      // Rule 1: a caller without scope all owns the leads they create.
      if (!holdsAll(actor, 'leads.manage') && ownerId !== actor.id) throw invalidOwner();
      await this.assertOwner(tx, ownerId);
      await this.assertInterests(tx, interests, []);
      const [row] = await tx
        .insert(leads)
        .values({ ...fields, ownerId, createdById: actor.id })
        .returning();
      if (!row) throw new Error('The lead was not created');
      await this.replaceInterests(tx, row.id, interests);
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'lead.created',
        entityType: 'lead',
        entityId: row.id,
        after: {
          ...identity(row),
          ...editable(row),
          stage: row.stage,
          ownerId,
          interests: interests.map(interestKey),
        },
      });
      await this.notifyAssigned(tx, actor, row);
      return this.toDetail(actor, row, tx);
    });
  }

  /** Rule 7: open leads only, with the loaded `updatedAt`. */
  async update(actor: CurrentUserInfo, id: string, input: UpdateLead): Promise<LeadDetail> {
    const today = businessDate();
    return this.db.transaction(async (tx) => {
      const lead = await this.lockForChange(tx, actor, id);
      assertChangeable(lead);
      if (lead.updatedAt.getTime() !== new Date(input.updatedAt).getTime()) {
        throw new CodedException(409, 'STALE_LEAD', 'The lead changed since it was loaded');
      }
      const { updatedAt: _, interests, ...fields } = input;
      const merged = { ...lead, ...stripUndefined(fields) };
      assertLeadFields(merged);
      if (merged.nextFollowUpOn !== lead.nextFollowUpOn) {
        assertFollowUp(merged.nextFollowUpOn as CalendarDate, today);
      }
      const current = await this.interestRows(tx, [id]);
      const currentKeys = current.map(interestKey);
      const interestsChanged =
        interests !== undefined &&
        JSON.stringify(interests.map(interestKey)) !== JSON.stringify(currentKeys);
      if (interests && interestsChanged) await this.assertInterests(tx, interests, currentKeys);
      const changes = changedFields(editable(lead), editable(merged));
      if (!changes && !interestsChanged) return this.toDetail(actor, lead, tx);
      const [updated] = await tx
        .update(leads)
        .set({ ...editable(merged), updatedAt: new Date() })
        .where(eq(leads.id, id))
        .returning();
      if (!updated) throw new NotFoundException();
      if (interests && interestsChanged) await this.replaceInterests(tx, id, interests);
      const before: Record<string, unknown> = { ...changes?.before };
      const after: Record<string, unknown> = { ...changes?.after };
      if (interests && interestsChanged) {
        before.interests = currentKeys;
        after.interests = interests.map(interestKey);
      }
      const onlyDate = Object.keys(after).length === 1 && 'nextFollowUpOn' in after;
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: onlyDate ? 'lead.follow_up_changed' : 'lead.updated',
        entityType: 'lead',
        entityId: id,
        before: { ...identity(lead), ...before },
        after: { ...identity(updated), ...after },
      });
      return this.toDetail(actor, updated, tx);
    });
  }

  /** Rule 2: a warning only; leads the caller cannot read show name, owner and stage. */
  async duplicates(actor: CurrentUserInfo, query: LeadDuplicateQuery): Promise<LeadDuplicates> {
    const contact = [
      query.phone ? eq(leads.phone, query.phone) : undefined,
      query.email ? eq(leads.email, query.email) : undefined,
    ].filter((filter): filter is SQL => !!filter);
    const leadRows =
      contact.length === 0
        ? []
        : await this.db
            .select()
            .from(leads)
            .where(
              and(
                isNull(leads.archivedAt),
                inArray(leads.stage, [...OPEN_LEAD_STAGES]),
                or(...contact),
                query.excludeLeadId ? sql`${leads.id} <> ${query.excludeLeadId}` : undefined,
              ),
            )
            .orderBy(asc(leads.createdAt), asc(leads.id));
    const clientRows = await this.clients.duplicates({
      names: query.names,
      phone: query.phone,
      email: query.email,
    });
    const people = await this.users.summaries([
      ...leadRows.map((row) => row.ownerId),
      ...clientRows.map((client) => client.accountManagerId),
    ]);
    const person = (id: string) => ({ id, name: people.get(id)?.name ?? '' });
    return {
      leads: leadRows.map((row) => ({
        id: row.id,
        displayName: leadDisplayName(row),
        owner: person(row.ownerId),
        stage: row.stage,
        readable: readsLead(actor, row),
      })),
      clients: clientRows.map((client) => ({
        id: client.id,
        tradeName: client.name,
        status: client.status,
        accountManager: person(client.accountManagerId),
      })),
    };
  }

  /** Rule 1: active users holding `leads.manage`, by name. */
  async owners(): Promise<LeadOwnerOptions> {
    const [managers, accountManagers, members] = await Promise.all([
      this.users.withRole('general_manager'),
      this.users.withRole('account_manager'),
      this.users.activeMembers([...OWNER_DEPARTMENTS]),
    ]);
    const ids = [...new Set([...managers, ...accountManagers, ...members.map((m) => m.id)])];
    const [people, memberships] = await Promise.all([
      this.users.summaries(ids),
      this.users.memberships(ids),
    ]);
    const items = ids
      .flatMap((id) => {
        const user = people.get(id);
        return user && !user.archived
          ? [{ id, name: user.name, departments: [...(memberships.get(id) ?? [])].sort() }]
          : [];
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ar') || a.id.localeCompare(b.id));
    return { items };
  }

  /**
   * Locks a lead row for a change (edge case 1): 404 outside read access, 403 without
   * `leads.manage` over it.
   */
  async lockForChange(tx: Transaction, actor: CurrentUserInfo, id: string): Promise<LeadRow> {
    const [lead] = await tx.select().from(leads).where(eq(leads.id, id)).for('update');
    if (!lead || !readsLead(actor, lead)) throw new NotFoundException();
    if (!coversLead(actor, 'leads.manage', lead)) throw new ForbiddenException();
    return lead;
  }

  /** Rule 1: an active holder of `leads.manage`. */
  async assertOwner(tx: Transaction, ownerId: string): Promise<void> {
    const access = await this.users.access(ownerId, tx);
    if (!access || !hasPermission(access, 'leads.manage')) throw invalidOwner();
  }

  /** `lead_assigned` to a new owner who did not make the change (rule 6). */
  async notifyAssigned(tx: Transaction, actor: CurrentUserInfo, row: LeadRow): Promise<void> {
    await this.center.notify(tx, {
      type: 'lead_assigned',
      data: { lead: leadDisplayName(row) },
      recipients: [row.ownerId],
      actorId: actor.id,
      subjectId: row.id,
    });
  }

  async toDetail(actor: CurrentUserInfo, row: LeadRow, executor: Executor = this.db) {
    const notes = await executor
      .select()
      .from(leadNotes)
      .where(and(eq(leadNotes.leadId, row.id), isNull(leadNotes.archivedAt)))
      .orderBy(desc(leadNotes.occurredAt), desc(leadNotes.id));
    // One after another: inside a transaction they share one connection.
    const people = await this.users.summaries(
      [
        row.ownerId,
        row.createdById,
        ...(row.convertedById ? [row.convertedById] : []),
        ...notes.map((note) => note.authorId),
      ],
      executor,
    );
    const interests = await this.interestsOf(executor, [row.id]);
    const client = row.clientId ? await this.clients.summary(row.clientId, executor) : null;
    const ownerAccess = await this.users.access(row.ownerId, executor);
    const person = (id: string) => ({ id, name: people.get(id)?.name ?? '' });
    const detailInterests = interests.get(row.id) ?? [];
    const permissions = await this.permissionsOf(actor, row, executor);
    return {
      ...this.summary(
        row,
        people.get(row.ownerId),
        detailInterests.map((interest) => interest.name),
        client,
      ),
      phone: row.phone,
      email: row.email,
      socialHandle: row.socialHandle,
      sourceDetail: row.sourceDetail,
      request: row.request,
      sector: row.sector,
      isHealthcare: row.isHealthcare,
      interests: detailInterests,
      ownerCanManage: !!ownerAccess && hasPermission(ownerAccess, 'leads.manage'),
      lostReason: row.lostReason,
      lostNote: row.lostNote,
      convertedBy: row.convertedById ? person(row.convertedById) : null,
      createdBy: person(row.createdById),
      notes: notes.map((note) => noteOf(actor, row, note, person(note.authorId))),
      permissions,
    } satisfies LeadDetail;
  }

  /** The caller's filters shared by the list and the board, with read scope. */
  private filters(actor: CurrentUserInfo, query: LeadBoardQuery): (SQL | undefined)[] {
    const filters: (SQL | undefined)[] = [
      holdsAll(actor, 'leads.read') ? undefined : eq(leads.ownerId, actor.id),
    ];
    if (query.search) {
      const pattern = `%${escapeLike(query.search)}%`;
      filters.push(
        or(
          sql`${leads.contactName} ilike ${pattern}`,
          sql`${leads.companyName} ilike ${pattern}`,
          sql`${leads.email} ilike ${pattern}`,
          sql`${leads.phone} ilike ${`%${escapeLike(query.search.replace(/[\s\-.()]/g, ''))}%`}`,
        ),
      );
    }
    if (query.ownerId) filters.push(eq(leads.ownerId, query.ownerId));
    if (query.source) filters.push(inArray(leads.source, query.source));
    if (query.followUp) {
      const range = followUpFilterRange(query.followUp, businessDate());
      if (range.from) filters.push(gte(leads.nextFollowUpOn, range.from));
      filters.push(lte(leads.nextFollowUpOn, range.to));
    }
    return filters;
  }

  private async permissionsOf(actor: CurrentUserInfo, row: LeadRow, executor: Executor) {
    const manage = coversLead(actor, 'leads.manage', row);
    const archived = !!row.archivedAt;
    const live = manage && !archived;
    const open = isOpenLeadStage(row.stage);
    const scopeAll = holdsAll(actor, 'leads.manage');
    const hasSentQuote =
      live && row.stage === 'quote_sent'
        ? await this.quoteChecks.hasSentQuote(executor, row.id)
        : false;
    const canArchive =
      scopeAll && !archived && row.stage !== 'won'
        ? !(await this.quoteChecks.hasLiveQuotes(executor, row.id))
        : false;
    return {
      canEdit: live && open,
      moves:
        live && open
          ? MANUAL_LEAD_STAGES.filter(
              (stage) => manualLeadMoveRefusal(row.stage, stage, hasSentQuote) === null,
            )
          : [],
      canChangeOwner: live && open,
      canLogActivity: live && open,
      canLose: live && open,
      canReopen: live && row.stage === 'lost',
      canConvert: live && open,
      canArchive,
      canRestore: scopeAll && archived,
      canNewQuote: !archived && open && coversLeadQuotes(actor, 'quotes.manage', row),
    };
  }

  /** List items with their owners, interest names and won clients. */
  private async summaries(rows: LeadRow[]): Promise<Lead[]> {
    if (rows.length === 0) return [];
    const [people, interests, clients] = await Promise.all([
      this.users.summaries(rows.map((row) => row.ownerId)),
      this.interestsOf(
        this.db,
        rows.map((row) => row.id),
      ),
      this.clients.summaries(rows.flatMap((row) => (row.clientId ? [row.clientId] : []))),
    ]);
    return rows.map((row) =>
      this.summary(
        row,
        people.get(row.ownerId),
        (interests.get(row.id) ?? []).map((interest) => interest.name),
        row.clientId ? (clients.get(row.clientId) ?? null) : null,
      ),
    );
  }

  private summary(
    row: LeadRow,
    owner: { name: string; archived: boolean } | undefined,
    interests: string[],
    client: { id: string; name: string } | null,
  ): Lead {
    const today = businessDate();
    const followUp = row.nextFollowUpOn;
    return {
      id: row.id,
      displayName: leadDisplayName(row),
      contactName: row.contactName,
      companyName: row.companyName,
      source: row.source,
      stage: row.stage,
      stageChangedAt: row.stageChangedAt.toISOString(),
      daysInStage: daysInStage(businessDate(row.stageChangedAt), today),
      owner: { id: row.ownerId, name: owner?.name ?? '', archived: owner?.archived ?? false },
      nextFollowUpOn: followUp,
      followUpOverdue: followUp !== null && followUp < today,
      followUpDueToday: followUp === today,
      budgetMinor: row.budgetMinor,
      budgetCurrency: row.budgetCurrency,
      interests,
      client: client && { id: client.id, name: client.name },
      closedAt: row.closedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      archivedAt: row.archivedAt?.toISOString() ?? null,
    };
  }

  private interestRows(executor: Executor, leadIds: string[]) {
    return executor
      .select()
      .from(leadInterests)
      .where(inArray(leadInterests.leadId, leadIds))
      .orderBy(asc(leadInterests.id));
  }

  /** Each lead's interests in the order added, with catalog names and archived marks. */
  private async interestsOf(
    executor: Executor,
    leadIds: string[],
  ): Promise<Map<string, LeadInterest[]>> {
    const rows = leadIds.length === 0 ? [] : await this.interestRows(executor, leadIds);
    const services = await this.catalog.services(
      rows.flatMap((row) => (row.serviceId ? [row.serviceId] : [])),
      executor,
    );
    const packages = await this.catalog.packages(
      rows.flatMap((row) => (row.packageId ? [row.packageId] : [])),
      executor,
    );
    const result = new Map<string, LeadInterest[]>();
    for (const row of rows) {
      const item = row.serviceId ? services.get(row.serviceId) : packages.get(row.packageId ?? '');
      if (!item) continue;
      const list = result.get(row.leadId) ?? [];
      list.push({
        kind: row.serviceId ? 'service' : 'package',
        id: item.id,
        name: item.name,
        archived: item.archived,
      });
      result.set(row.leadId, list);
    }
    return result;
  }

  /**
   * At most 10 (`LIMIT_REACHED`); a new interest must exist and be live (`CATALOG_ITEM_ARCHIVED`);
   * one already on the lead stays even when archived since (edge case 10).
   */
  private async assertInterests(
    tx: Transaction,
    interests: readonly InterestInput[],
    currentKeys: readonly string[],
  ): Promise<void> {
    if (interests.length > LEAD_LIMITS.interests) {
      throw new CodedException(400, 'LIMIT_REACHED', 'A lead has at most 10 interests');
    }
    const added = interests.filter((interest) => !currentKeys.includes(interestKey(interest)));
    const services = await this.catalog.services(
      added.flatMap((interest) => (interest.serviceId ? [interest.serviceId] : [])),
      tx,
    );
    const packages = await this.catalog.packages(
      added.flatMap((interest) => (interest.packageId ? [interest.packageId] : [])),
      tx,
    );
    for (const interest of added) {
      const item = interest.serviceId
        ? services.get(interest.serviceId)
        : packages.get(interest.packageId ?? '');
      if (!item) throw new BadRequestException(`Unknown catalog item ${interestKey(interest)}`);
      if (item.archived) {
        throw new CodedException(409, 'CATALOG_ITEM_ARCHIVED', 'The catalog item is archived', [
          interestKey(interest),
        ]);
      }
    }
  }

  /** `lead_interests` is part of its lead: replaced as a whole, audited on the lead. */
  private async replaceInterests(
    tx: Transaction,
    leadId: string,
    interests: readonly InterestInput[],
  ): Promise<void> {
    await tx.delete(leadInterests).where(eq(leadInterests.leadId, leadId));
    for (const interest of interests) {
      await tx.insert(leadInterests).values({
        leadId,
        serviceId: interest.serviceId ?? null,
        packageId: interest.packageId ?? null,
      });
    }
  }
}

const invalidOwner = () =>
  new CodedException(400, 'INVALID_LEAD_OWNER', 'The owner cannot manage leads');

/** A closed or archived lead is read-only (rules 7 and 12). */
export function assertChangeable(lead: LeadRow): void {
  if (lead.archivedAt) throw new CodedException(409, 'LEAD_ARCHIVED', 'The lead is archived');
  if (!isOpenLeadStage(lead.stage)) {
    throw new CodedException(409, 'LEAD_CLOSED', 'The lead is won or lost');
  }
}

/** Rule 3. */
export function assertFollowUp(date: CalendarDate, today: CalendarDate): void {
  if (!followUpDateInRange(date, today)) {
    throw new CodedException(
      400,
      'INVALID_DATES',
      'The next follow-up date is from today to 180 days ahead',
    );
  }
}

/** One contact method (`CONTACT_REQUIRED`) and a source detail for `other` (`NOTE_REQUIRED`). */
function assertLeadFields(
  lead: Parameters<typeof leadHasContactMethod>[0] & {
    source: LeadRow['source'];
    sourceDetail: string | null;
  },
): void {
  if (!leadHasContactMethod(lead)) {
    throw new CodedException(
      400,
      'CONTACT_REQUIRED',
      'A phone, email or social handle is required',
    );
  }
  if (leadSourceDetailMissing(lead)) {
    throw new CodedException(400, 'NOTE_REQUIRED', 'An other source needs a detail');
  }
}

function stripUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Editing a note: its author; archiving: its author or scope all (spec F03, "Actions"). */
export function noteOf(
  actor: CurrentUserInfo,
  lead: LeadRow,
  note: LeadNoteRow,
  author: { id: string; name: string },
) {
  const writable =
    coversLead(actor, 'leads.manage', lead) && !lead.archivedAt && isOpenLeadStage(lead.stage);
  const isAuthor = note.authorId === actor.id;
  return {
    id: note.id,
    leadId: note.leadId,
    occurredAt: note.occurredAt.toISOString(),
    channel: note.channel,
    summary: note.summary,
    author,
    canEdit: writable && isAuthor,
    canArchive: writable && (isAuthor || holdsAll(actor, 'leads.manage')),
  };
}
