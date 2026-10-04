import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type ConvertLead,
  isOpenLeadStage,
  type LeadConversionPlan,
  type LeadConversionPlanQuery,
  type LeadDetail,
  leadDisplayName,
} from '@vertex-hub/contracts';
import { type Database, leadNotes, leads, type Transaction } from '@vertex-hub/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, lockAccessChanges, UserDirectory } from '../auth/index.js';
import { ClientDirectory, ClientFactory } from '../clients/index.js';
import { NotificationCenter } from '../notifications/index.js';
import { actorOf } from './lead-access.js';
import { LeadClosedHooks, LeadQuoteChecks } from './lead-closed-hooks.js';
import { identity, type LeadRow, LeadsService } from './leads.service.js';

type Executor = Database | Transaction;

/** What a conversion created or linked. */
export interface ConversionResult {
  clientId: string;
  clientName: string;
  /** The contact added from the lead, or null. */
  contactId: string | null;
}

/**
 * Rule 10: a won lead becomes a new client or links an existing one, in the caller's
 * transaction: the client through `ClientFactory` (F02's rules, audit and notices), the activity
 * log copied into its communication log, the quotes moved by `quotes` through `LeadClosedHooks`.
 */
@Injectable()
export class LeadConversionService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly leads: LeadsService,
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
    private readonly factory: ClientFactory,
    private readonly center: NotificationCenter,
    private readonly closedHooks: LeadClosedHooks,
    private readonly quoteChecks: LeadQuoteChecks,
  ) {}

  /** `GET /api/leads/:id/conversion-plan`: `leads.manage` covering an open lead. */
  async planFor(
    actor: CurrentUserInfo,
    id: string,
    query: LeadConversionPlanQuery,
  ): Promise<LeadConversionPlan> {
    const lead = await this.leads.manageable(this.db, actor, id);
    return this.plan(lead, query.clientId);
  }

  /** The dialog's defaults; the caller has checked who may convert. Nothing is written. */
  async plan(lead: LeadRow, clientId?: string): Promise<LeadConversionPlan> {
    assertConvertible(lead);
    const existing = clientId ? await this.clients.summary(clientId) : null;
    if (clientId && !existing) throw new NotFoundException();
    if (existing?.archived) {
      throw new CodedException(409, 'CLIENT_ARCHIVED', 'The client is archived');
    }
    const [managerIds, duplicates, notes, quoteCounts] = await Promise.all([
      this.users.withRole('account_manager'),
      this.clients.duplicates({
        names: [...new Set([lead.companyName, lead.contactName].filter((n) => n !== null))],
        phone: lead.phone,
        email: lead.email,
      }),
      this.notes(this.db, lead.id),
      this.quoteChecks.quoteCounts(this.db, [lead.id]),
    ]);
    const people = await this.users.summaries([
      ...managerIds,
      ...duplicates.map((client) => client.accountManagerId),
      ...(existing ? [existing.accountManagerId] : []),
    ]);
    const person = (userId: string) => ({ id: userId, name: people.get(userId)?.name ?? '' });
    const accountManagers = managerIds
      .flatMap((userId) => {
        const user = people.get(userId);
        return user && !user.archived ? [{ id: userId, name: user.name }] : [];
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ar') || a.id.localeCompare(b.id));
    const describe = (client: (typeof duplicates)[number]) => ({
      id: client.id,
      tradeName: client.name,
      status: client.status,
      accountManager: person(client.accountManagerId),
    });
    return {
      client: {
        tradeName: leadDisplayName(lead),
        sector: lead.sector,
        isHealthcare: lead.isHealthcare,
        accountManagerId: accountManagers.some((user) => user.id === lead.ownerId)
          ? lead.ownerId
          : null,
      },
      contact: { name: lead.contactName, phone: lead.phone, email: lead.email },
      accountManagers,
      duplicateClients: duplicates.map(describe),
      noteCount: notes.length,
      quoteCount: quoteCounts.get(lead.id) ?? 0,
      existingClient: existing
        ? {
            ...describe(existing),
            hasContact: await this.factory.hasContact(existing.id, lead),
          }
        : null,
    };
  }

  /** `POST /api/leads/:id/convert`: `leads.manage` covering the lead. */
  async convertFor(actor: CurrentUserInfo, id: string, input: ConvertLead): Promise<LeadDetail> {
    return this.db.transaction(async (tx) => {
      // The account manager stays valid until commit (F02 rule 14).
      await lockAccessChanges(tx);
      const lead = await this.leads.lockForChange(tx, actor, id);
      await this.convert(tx, actor, lead, input);
      return this.leads.detail(actor, id, tx);
    });
  }

  /**
   * Rule 10 on a lead the caller has locked and checked access to, inside its transaction (also
   * step 0 of accepting a lead quote, rule 11). The caller holds `lockAccessChanges`.
   */
  async convert(
    tx: Transaction,
    actor: CurrentUserInfo,
    lead: LeadRow,
    input: ConvertLead,
  ): Promise<ConversionResult> {
    assertConvertible(lead);
    const auditActor = actorOf(actor);
    let clientId: string;
    let clientName: string;
    // Who learns about the win: the owner, and an existing client's account manager.
    const told = [lead.ownerId];
    let assigned: string | null = null;
    if (input.mode === 'new') {
      clientId = await this.factory.create(tx, auditActor, { ...input.client, status: 'active' });
      clientName = input.client.tradeName;
      assigned = input.client.accountManagerId;
    } else {
      const client = await this.clients.summary(input.clientId, tx, { forUpdate: true });
      if (!client) throw new NotFoundException();
      if (client.archived) {
        throw new CodedException(409, 'CLIENT_ARCHIVED', 'The client is archived');
      }
      await this.factory.reactivate(tx, auditActor, client.id);
      clientId = client.id;
      clientName = client.name;
      told.push(client.accountManagerId);
    }
    const contactId = input.contact.add
      ? await this.factory.addContact(tx, auditActor, clientId, input.contact)
      : null;
    const notes = await this.notes(tx, lead.id);
    await this.factory.copyNotes(tx, auditActor, clientId, notes, contactId);
    const ref = { id: lead.id, displayName: leadDisplayName(lead), ownerId: lead.ownerId };
    const movedQuotes = await this.closedHooks.converted(tx, ref, {
      clientId,
      contactId,
      actor: auditActor,
    });
    const now = new Date();
    const [updated] = await tx
      .update(leads)
      .set({
        stage: 'won',
        stageChangedAt: now,
        clientId,
        closedAt: now,
        convertedById: actor.id,
        nextFollowUpOn: null,
        updatedAt: now,
      })
      .where(eq(leads.id, lead.id))
      .returning();
    if (!updated) throw new Error('The lead was not converted');
    await recordAudit(tx, {
      actor: auditActor,
      action: 'lead.converted',
      entityType: 'lead',
      entityId: lead.id,
      before: { ...identity(lead), stage: lead.stage, nextFollowUpOn: lead.nextFollowUpOn },
      after: {
        ...identity(updated),
        stage: 'won',
        mode: input.mode,
        clientId,
        client: clientName,
        ...(contactId ? { contactId } : {}),
        copiedNotes: notes.length,
        movedQuotes,
      },
    });
    // Whoever got `client_account_manager_assigned` for this conversion is not told twice.
    await this.center.notify(tx, {
      type: 'lead_won',
      data: { lead: ref.displayName, client: clientName },
      recipients: told.filter((userId) => userId !== assigned),
      actorId: actor.id,
      subjectId: lead.id,
    });
    return { clientId, clientName, contactId };
  }

  /** The non-archived activities, oldest first: the order they are copied in. */
  private notes(executor: Executor, leadId: string) {
    return executor
      .select({
        authorId: leadNotes.authorId,
        occurredAt: leadNotes.occurredAt,
        channel: leadNotes.channel,
        summary: leadNotes.summary,
      })
      .from(leadNotes)
      .where(and(eq(leadNotes.leadId, leadId), isNull(leadNotes.archivedAt)))
      .orderBy(asc(leadNotes.occurredAt), asc(leadNotes.id));
  }
}

/** Rule 10: from any open stage of a non-archived lead; won is final (edge case 1). */
function assertConvertible(lead: LeadRow): void {
  if (lead.archivedAt) throw new CodedException(409, 'LEAD_ARCHIVED', 'The lead is archived');
  if (!isOpenLeadStage(lead.stage)) {
    throw new CodedException(409, 'INVALID_TRANSITION', `A ${lead.stage} lead is not converted`);
  }
}
