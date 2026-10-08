import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  addDays,
  businessDate,
  type CreateQuote,
  installmentsValid,
  type LeadQuotes,
  needsDiscountApproval,
  QUOTE_LIMITS,
  type Quote,
  type QuoteDetail,
  type QuoteDraft,
  type QuoteLineInput,
  type QuoteListQuery,
  type QuotePage,
  quoteDisplayNumber,
} from '@vertex-hub/contracts';
import {
  type Database,
  newId,
  quoteInstallments,
  quoteLineItems,
  quoteLines,
  quoteNumbers,
  quotes,
  type Transaction,
} from '@vertex-hub/db';
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
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { changedFields, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import {
  CatalogDirectory,
  type CatalogPackageEntry,
  type CatalogServiceEntry,
  CatalogUsage,
  catalogPrice,
} from '../catalog/index.js';
import { ClientDirectory } from '../clients/index.js';
import { LeadDirectory } from '../leads/index.js';
import { EngagementDirectory } from '../projects/index.js';
import {
  actorOf,
  approvesDiscounts,
  assertCanManage,
  assertTakesQuotes,
  canManage,
  canRead,
  clientRecipient,
  covers,
  coversEngagements,
  holdsAll,
  leadRecipient,
  type Recipient,
  snapshotParty,
} from './quote-access.js';
import { QuotePdfService } from './quote-pdf.service.js';
import { QuoteRecipients } from './quote-recipients.js';
import {
  amounts,
  draftContentHash,
  draftSnapshot,
  type InstallmentRow,
  type ItemRow,
  identity,
  type LineRow,
  type LineWithItems,
  NO_DRAFT_PDF,
  type QuoteChildren,
  type QuoteRow,
  quoteChildren,
  renderHash,
  totalsOf,
} from './quote-records.js';
import { QuoteSettingsService } from './quote-settings.service.js';

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** `Q-2026-0007`, `2026-7` or `7`. */
function numberSearch(search: string): SQL | undefined {
  // The number as the screens show it, with its version (`Q-2026-0007 v2`): the list shows the
  // latest version of a number anyway.
  const full = /^(?:q-?)?(\d{4})-0*(\d{1,9})(?:\s*v\d{1,4})?$/i.exec(search);
  if (full) return and(eq(quotes.year, Number(full[1])), eq(quotes.number, Number(full[2])));
  if (/^\d{1,9}$/.test(search)) return eq(quotes.number, Number(search));
  return undefined;
}

/** The latest non-archived version of each number (the quotes table's own alias is `quotes`). */
const isLatest = sql`not exists (select 1 from quotes newer where newer.year = quotes.year
  and newer.number = quotes.number and newer.version > quotes.version
  and newer.archived_at is null)`;

/** Quotes (F04): list, detail, create, save a draft, new version, discard. */
@Injectable()
export class QuotesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly leads: LeadDirectory,
    private readonly users: UserDirectory,
    private readonly catalog: CatalogDirectory,
    private readonly settings: QuoteSettingsService,
    private readonly pdf: QuotePdfService,
    private readonly engagements: EngagementDirectory,
    private readonly recipientsOf: QuoteRecipients,
    usage: CatalogUsage,
  ) {
    // SERVICE_IN_USE: an item on any quote version keeps its billing.
    usage.register(async (tx, item) => {
      const [line] = await tx
        .select({ id: quoteLines.id })
        .from(quoteLines)
        .where(
          item.type === 'service'
            ? eq(quoteLines.serviceId, item.id)
            : eq(quoteLines.packageId, item.id),
        )
        .limit(1);
      if (line || item.type === 'package') return !!line;
      const [quoted] = await tx
        .select({ id: quoteLineItems.id })
        .from(quoteLineItems)
        .where(eq(quoteLineItems.serviceId, item.id))
        .limit(1);
      return !!quoted;
    });
  }

  async list(actor: CurrentUserInfo, query: QuoteListQuery): Promise<QuotePage> {
    if (query.archived && !holdsAll(actor, 'quotes.read')) throw new ForbiddenException();
    // A lead quote has no client until its lead is converted (F03).
    const live = or(isNull(quotes.clientId), this.clients.isLive(quotes.clientId));
    const filters: (SQL | undefined)[] = [
      query.archived
        ? and(isNotNull(quotes.archivedAt), live)
        : and(isNull(quotes.archivedAt), live),
      holdsAll(actor, 'quotes.read') ? undefined : this.managedBy(actor.id),
      inArray(quotes.status, query.status),
    ];
    if (query.latestOnly && !query.archived) filters.push(isLatest);
    if (query.search) {
      filters.push(
        or(
          numberSearch(query.search),
          ilike(quotes.title, `%${escapeLike(query.search)}%`),
          this.clients.nameContains(quotes.clientId, query.search),
          and(isNull(quotes.clientId), this.leads.nameContains(quotes.leadId, query.search)),
        ),
      );
    }
    if (query.clientId) filters.push(eq(quotes.clientId, query.clientId));
    if (query.leadId) filters.push(eq(quotes.leadId, query.leadId));
    if (query.accountManagerId) filters.push(this.managedBy(query.accountManagerId));
    if (query.approval) filters.push(eq(quotes.discountApproval, query.approval));
    if (query.projectId) filters.push(eq(quotes.projectId, query.projectId));
    if (query.retainerId) filters.push(eq(quotes.retainerId, query.retainerId));
    const where = and(...filters);
    const order = query.order === 'desc' ? desc : asc;
    const sorts =
      query.sort === 'number'
        ? [order(quotes.year), order(quotes.number), order(quotes.version)]
        : query.sort === 'validUntil'
          ? [sql`${quotes.validUntil} ${sql.raw(query.order)} nulls last`]
          : [order(quotes.updatedAt)];
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(quotes)
        .where(where)
        .orderBy(...sorts, asc(quotes.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ value: count() }).from(quotes).where(where),
    ]);
    const children = await quoteChildren(
      this.db,
      rows.map((row) => row.id),
    );
    const recipients = await this.recipientsOf.byQuote(rows);
    const people = await this.users.summaries(
      [...recipients.values()].map((recipient) => recipient.accountManagerId),
    );
    const today = businessDate();
    return {
      items: rows.flatMap((row) => {
        const recipient = recipients.get(row.id);
        const kids = children.get(row.id);
        return recipient && kids ? [this.toSummary(row, recipient, kids, people, today)] : [];
      }),
      total: total?.value ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async detail(
    actor: CurrentUserInfo,
    id: string,
    executor: Database | Transaction = this.db,
  ): Promise<QuoteDetail> {
    const [row] = await executor.select().from(quotes).where(eq(quotes.id, id));
    const recipient = row ? await this.recipientsOf.of(row, executor) : null;
    if (!row || !recipient || !canRead(actor, recipient, row)) throw new NotFoundException();
    return this.toDetail(actor, row, recipient, executor);
  }

  /**
   * `GET /api/quotes/by-lead/:leadId` (F03 screen 3): every quote written on a lead the caller
   * reads, latest versions newest first; nets only where `quotes.read` covers the quote.
   */
  async byLead(actor: CurrentUserInfo, leadId: string): Promise<LeadQuotes> {
    const lead = await this.leads.summary(leadId);
    if (!lead || !this.leads.readable(actor, lead)) throw new NotFoundException();
    const rows = await this.db
      .select()
      .from(quotes)
      .where(and(eq(quotes.leadId, leadId), isNull(quotes.archivedAt)))
      .orderBy(desc(quotes.year), desc(quotes.number), asc(quotes.version));
    const latest = new Map<string, QuoteRow>();
    for (const row of rows) latest.set(`${row.year}-${row.number}`, row);
    const shown = [...latest.values()];
    const recipients = await this.recipientsOf.byQuote(shown);
    const children = await quoteChildren(
      this.db,
      shown.map((row) => row.id),
    );
    return {
      items: shown.map((row) => {
        const recipient = recipients.get(row.id);
        const kids = children.get(row.id);
        const totals =
          recipient && kids && covers(actor, 'quotes.read', recipient) ? totalsOf(row, kids) : null;
        return {
          id: row.id,
          displayNumber: quoteDisplayNumber(row),
          version: row.version,
          title: row.title,
          status: row.status,
          currency: row.currency,
          sentAt: row.sentAt?.toISOString() ?? null,
          validUntil: row.validUntil,
          oneOffNetMinor: totals?.oneOff.netMinor ?? null,
          monthlyNetMinor: totals?.monthly.netMinor ?? null,
          versions: rows
            .filter((version) => version.year === row.year && version.number === row.number)
            .map((version) => ({
              id: version.id,
              version: version.version,
              status: version.status,
            })),
        };
      }),
    };
  }

  /** Rules 1 and 2: version 1 of the next number of the year, with the default validity and terms. */
  async create(actor: CurrentUserInfo, input: CreateQuote): Promise<QuoteDetail> {
    return this.db.transaction(async (tx) => {
      const recipient = await this.newRecipient(tx, actor, input);
      assertCanManage(actor, recipient);
      assertTakesQuotes(recipient);
      if (input.contactId) await this.assertContact(tx, recipient, input.contactId);
      const settings = await this.settings.row(tx);
      const year = Number(businessDate().slice(0, 4));
      const number = await this.nextNumber(tx, year);
      const [row] = await tx
        .insert(quotes)
        .values({
          year,
          number,
          version: 1,
          clientId: recipient.kind === 'client' ? recipient.id : null,
          leadId: recipient.kind === 'lead' ? recipient.id : null,
          contactId: input.contactId,
          title: input.title,
          currency: input.currency,
          validityDays: settings.defaultValidityDays,
          terms: settings.defaultTerms || null,
          createdById: actor.id,
        })
        .returning();
      if (!row) throw new Error('The quote was not created');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'quote.created',
        entityType: 'quote',
        entityId: row.id,
        after: { ...identity(row), title: row.title, currency: row.currency },
      });
      return this.toDetail(actor, row, recipient, tx);
    });
  }

  /**
   * Saves the whole draft (edge case 1): rules 3, 4 and 7. Existing lines keep their copied name,
   * template and list price; a currency change re-prices every line from the catalog.
   */
  async saveDraft(actor: CurrentUserInfo, id: string, input: QuoteDraft): Promise<QuoteDetail> {
    return this.db.transaction(async (tx) => {
      const { quote, recipient } = await this.lockForChange(tx, actor, id);
      assertEditable(quote);
      if (quote.updatedAt.getTime() !== new Date(input.updatedAt).getTime()) {
        throw new CodedException(409, 'STALE_QUOTE', 'The draft changed since it was loaded');
      }
      if (input.lines.length > QUOTE_LIMITS.lines) {
        throw new CodedException(409, 'LIMIT_REACHED', 'A quote has at most 50 lines');
      }
      if (input.contactId && input.contactId !== quote.contactId) {
        await this.assertContact(tx, recipient, input.contactId);
      }
      const before = (await quoteChildren(tx, [id])).get(id) ?? { lines: [], installments: [] };
      const lines = await this.buildLines(tx, quote, input, before.lines);
      const hasOneOff = lines.some((line) => line.section === 'one_off');
      if (!installmentsValid(input.installments, hasOneOff, { draft: true })) {
        throw new CodedException(400, 'INVALID_INSTALLMENTS', 'The installments are not valid');
      }
      const installments: InstallmentRow[] = input.installments.map((installment, position) => ({
        id: newId(),
        quoteId: id,
        name: installment.name,
        percent: installment.percent,
        position,
      }));
      const after = { lines, installments };
      const totals = totalsOf(input, after);
      if (
        input.oneOffDiscountMinor > totals.oneOff.subtotalMinor ||
        input.monthlyDiscountMinor > totals.monthly.subtotalMinor
      ) {
        throw new CodedException(400, 'INVALID_DISCOUNT', 'A discount is above its section');
      }
      // Rule 7: a change to what is priced takes an approval back.
      const repriced = pricing(quote, before.lines) !== pricing({ ...quote, ...input }, lines);
      const discountApproval =
        repriced && quote.discountApproval === 'approved' ? 'none' : quote.discountApproval;

      const fields = {
        contactId: input.contactId,
        title: input.title,
        currency: input.currency,
        validityDays: input.validityDays,
        oneOffDiscountMinor: input.oneOffDiscountMinor,
        monthlyDiscountMinor: input.monthlyDiscountMinor,
        monthlyTermMonths: input.monthlyTermMonths,
        clientNotes: input.clientNotes,
        terms: input.terms,
        discountApproval,
      };
      // A save that changes nothing (text that only differed by spaces) keeps `updatedAt` and
      // writes no audit entry.
      if (draftContentHash(pick(quote, fields), before) === draftContentHash(fields, after)) {
        return this.toDetail(actor, quote, recipient, tx);
      }
      await this.replaceChildren(tx, id, after);
      const [updated] = await tx
        .update(quotes)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(quotes.id, id))
        .returning();
      if (!updated) throw new NotFoundException();
      const changes = changedFields(
        {
          ...pick(quote, fields),
          ...amounts(totalsOf(quote, before)),
          lineCount: before.lines.length,
          installments: before.installments.map(({ name, percent }) => ({ name, percent })),
        },
        {
          ...fields,
          ...amounts(totals),
          lineCount: lines.length,
          installments: installments.map(({ name, percent }) => ({ name, percent })),
        },
      );
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'quote.updated',
        entityType: 'quote',
        entityId: id,
        before: { ...identity(quote), ...changes?.before },
        after: { ...identity(updated), ...changes?.after },
      });
      return this.toDetail(actor, updated, recipient, tx);
    });
  }

  /**
   * Rule 8: copies the latest version into a new draft with the next version, list prices
   * refreshed from the catalog and no approval or response.
   */
  async newVersion(actor: CurrentUserInfo, id: string): Promise<QuoteDetail> {
    return this.db.transaction(async (tx) => {
      const { quote, recipient } = await this.lockForChange(tx, actor, id);
      if (quote.archivedAt || !['sent', 'expired', 'rejected'].includes(quote.status)) {
        throw new CodedException(
          409,
          'INVALID_TRANSITION',
          'Only a sent, expired or rejected quote',
        );
      }
      const versions = await this.versionRows(tx, quote);
      const newer = versions.filter((version) => version.version > quote.version);
      if (newer.some((version) => !version.archivedAt && version.status === 'draft')) {
        throw new CodedException(409, 'VERSION_EXISTS', 'A newer draft exists');
      }
      if (newer.some((version) => !version.archivedAt)) {
        throw new CodedException(409, 'INVALID_TRANSITION', 'Only the latest version');
      }
      const version = Math.max(...versions.map((row) => row.version)) + 1;
      const [row] = await tx
        .insert(quotes)
        .values({
          year: quote.year,
          number: quote.number,
          version,
          clientId: quote.clientId,
          leadId: quote.leadId,
          contactId: quote.contactId,
          title: quote.title,
          currency: quote.currency,
          oneOffDiscountMinor: quote.oneOffDiscountMinor,
          monthlyDiscountMinor: quote.monthlyDiscountMinor,
          monthlyTermMonths: quote.monthlyTermMonths,
          validityDays: quote.validityDays,
          clientNotes: quote.clientNotes,
          terms: quote.terms,
          createdById: actor.id,
        })
        .returning();
      if (!row) throw new Error('The version was not created');
      const source = (await quoteChildren(tx, [id])).get(id) ?? { lines: [], installments: [] };
      const services = await this.catalog.services(
        source.lines.flatMap((line) => (line.serviceId ? [line.serviceId] : [])),
        tx,
      );
      const packages = await this.catalog.packages(
        source.lines.flatMap((line) => (line.packageId ? [line.packageId] : [])),
        tx,
      );
      const lines: LineWithItems[] = source.lines.map((line) => {
        const lineId = newId();
        const item = line.serviceId
          ? services.get(line.serviceId)
          : packages.get(line.packageId ?? '');
        return {
          ...line,
          id: lineId,
          quoteId: row.id,
          listUnitPriceMinor: item ? catalogPrice(item, row.currency) : null,
          items: line.items.map((lineItem) => ({ ...lineItem, id: newId(), lineId })),
        };
      });
      const installments = source.installments.map((installment) => ({
        ...installment,
        id: newId(),
        quoteId: row.id,
      }));
      await this.replaceChildren(tx, row.id, { lines, installments });
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'quote.version_created',
        entityType: 'quote',
        entityId: row.id,
        after: { ...identity(row), fromQuoteId: quote.id },
      });
      return this.toDetail(actor, row, recipient, tx);
    });
  }

  /** Discards a draft; its number is never reused (edge case 15). */
  async archive(actor: CurrentUserInfo, id: string): Promise<void> {
    const previewKey = await this.db.transaction(async (tx) => {
      const { quote } = await this.lockForChange(tx, actor, id);
      if (quote.archivedAt || quote.status !== 'draft') {
        throw new CodedException(409, 'INVALID_TRANSITION', 'Only a draft is discarded');
      }
      const archivedAt = new Date();
      // Rule 13: the draft preview goes with the draft.
      await tx
        .update(quotes)
        .set({ archivedAt, ...NO_DRAFT_PDF })
        .where(eq(quotes.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'quote.archived',
        entityType: 'quote',
        entityId: id,
        before: { ...identity(quote), archived: false },
        after: { ...identity(quote), archived: true },
      });
      return quote.draftPdfObjectKey;
    });
    await this.pdf.discardPreview(previewKey);
  }

  /**
   * Locks a quote for a change by a client-scope holder: 404 outside read access, 403 without
   * `quotes.manage` over the client, `CLIENT_ARCHIVED` for an archived client (`LEAD_ARCHIVED`
   * for a lead). A lead quote's lead is locked first, as losing and converting the lead do
   * (F03 edge case 2), so the two never wait on each other in opposite orders.
   */
  async lockForChange(
    tx: Transaction,
    actor: CurrentUserInfo,
    id: string,
  ): Promise<{ quote: QuoteRow; recipient: Recipient }> {
    const [peek] = await tx
      .select({ clientId: quotes.clientId, leadId: quotes.leadId })
      .from(quotes)
      .where(eq(quotes.id, id));
    if (peek?.leadId && !peek.clientId) {
      await this.leads.summary(peek.leadId, tx, { forUpdate: true });
    }
    const [quote] = await tx.select().from(quotes).where(eq(quotes.id, id)).for('update');
    const recipient = quote ? await this.recipientsOf.of(quote, tx) : null;
    if (!quote || !recipient || !canRead(actor, recipient, quote)) throw new NotFoundException();
    assertCanManage(actor, recipient);
    return { quote, recipient };
  }

  /** Quotes of clients `userId` manages, and of leads not converted yet that they own. */
  private managedBy(userId: string): SQL | undefined {
    return or(
      this.clients.managedBy(quotes.clientId, userId),
      and(isNull(quotes.clientId), this.leads.ownedBy(quotes.leadId, userId)),
    );
  }

  /** The recipient of a new quote: 404 for an unknown client or a lead the caller cannot read. */
  private async newRecipient(
    tx: Transaction,
    actor: CurrentUserInfo,
    input: CreateQuote,
  ): Promise<Recipient> {
    if (input.leadId) {
      // Locked so a concurrent loss or conversion waits (F03 edge case 2).
      const lead = await this.leads.summary(input.leadId, tx, { forUpdate: true });
      if (!lead || !this.leads.readable(actor, lead)) throw new NotFoundException();
      return leadRecipient(lead);
    }
    const client = input.clientId ? await this.clients.summary(input.clientId, tx) : null;
    if (!client) throw new NotFoundException();
    return clientRecipient(client);
  }

  /** Every version of the quote's number, archived ones included, oldest first. */
  async versionRows(executor: Database | Transaction, quote: QuoteRow): Promise<QuoteRow[]> {
    return executor
      .select()
      .from(quotes)
      .where(and(eq(quotes.year, quote.year), eq(quotes.number, quote.number)))
      .orderBy(asc(quotes.version));
  }

  async toDetail(
    actor: CurrentUserInfo,
    row: QuoteRow,
    client: Recipient,
    executor: Database | Transaction = this.db,
  ): Promise<QuoteDetail> {
    const children = (await quoteChildren(executor, [row.id])).get(row.id) ?? {
      lines: [],
      installments: [],
    };
    const versions = await this.versionRows(executor, row);
    const settings = await this.settings.row(executor);
    const contacts = await this.clients.contactSummaries(
      [row.contactId, row.responseContactId].filter((value): value is string => !!value),
      executor,
    );
    const people = await this.users.summaries(
      [
        client.accountManagerId,
        row.createdById,
        row.sentById,
        row.respondedById,
        row.discountDecidedById,
      ].filter((value): value is string => !!value),
      executor,
    );
    const person = (userId: string | null) => {
      const user = userId ? people.get(userId) : undefined;
      return user ? { id: user.id, name: user.name } : null;
    };
    const decidedBy = person(row.discountDecidedById);
    const respondedBy = person(row.respondedById);
    const archivedCatalog = await this.archivedCatalogItems(executor, children.lines);
    const totals = totalsOf(row, children);
    const needsApproval = needsDiscountApproval(totals, settings.discountThresholdPercent);
    const newer = versions.filter(
      (version) => version.version > row.version && !version.archivedAt,
    );
    const manages = canManage(actor, client) && !row.archivedAt;
    const isDraft = row.status === 'draft' && !row.archivedAt;
    const editable = manages && isDraft && row.discountApproval !== 'pending';
    const contact = row.contactId ? contacts.get(row.contactId) : undefined;
    // Rule 13: a preview is outdated once the draft (or what it prints) changed.
    const previewOutdated =
      isDraft && row.draftPdfStatus === 'ready' && row.draftPdfHash
        ? renderHash(
            draftSnapshot(row, children, {
              companyDetails: settings.companyDetails,
              ...snapshotParty(client, contact?.name ?? null),
            }),
            true,
          ) !== row.draftPdfHash
        : false;
    const responseContact = row.responseContactId ? contacts.get(row.responseContactId) : undefined;
    const project = row.projectId
      ? (await this.engagements.projects([row.projectId], executor)).get(row.projectId)
      : undefined;
    const retainer = row.retainerId
      ? (await this.engagements.retainers([row.retainerId], executor)).get(row.retainerId)
      : undefined;
    const lead = row.leadId ? await this.leads.summary(row.leadId, executor) : null;
    // F03 rule 14: a lead quote is sent and accepted only while its lead is open.
    const takesQuotes = client.kind === 'client' || client.open;
    return {
      ...this.toSummary(row, client, children, people, businessDate()),
      contact: contact ?? null,
      lead: lead && { id: lead.id, displayName: lead.displayName, stage: lead.stage },
      discountDecision:
        row.discountDecidedAt && decidedBy
          ? { by: decidedBy, at: row.discountDecidedAt.toISOString(), note: row.discountNote }
          : null,
      oneOffDiscountMinor: row.oneOffDiscountMinor,
      monthlyDiscountMinor: row.monthlyDiscountMinor,
      monthlyTermMonths: row.monthlyTermMonths,
      validityDays: row.validityDays,
      clientNotes: row.clientNotes,
      terms: row.terms,
      sentAt: row.sentAt?.toISOString() ?? null,
      sentBy: person(row.sentById),
      response:
        row.respondedOn && respondedBy
          ? {
              respondedOn: row.respondedOn,
              contact: responseContact
                ? { id: responseContact.id, name: responseContact.name }
                : null,
              note: row.responseNote,
              by: respondedBy,
              rejectionReason: row.rejectionReason,
            }
          : null,
      createdBy: person(row.createdById) ?? { id: row.createdById, name: '' },
      createdAt: row.createdAt.toISOString(),
      lines: children.lines.map((line, index) => ({
        id: line.id,
        section: line.section,
        serviceId: line.serviceId,
        packageId: line.packageId,
        name: line.name,
        description: line.description,
        department: line.department,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        listUnitPriceMinor: line.listUnitPriceMinor,
        totalMinor: totals.lineTotalsMinor[index] ?? 0,
        revisionRounds: line.revisionRounds,
        deliverableKind: line.deliverableKind,
        deliverableLabel: line.deliverableLabel,
        templateId: line.templateId,
        catalogArchived: archivedCatalog.has(line.serviceId ?? line.packageId ?? ''),
        items: line.items.map((item) => ({
          id: item.id,
          serviceId: item.serviceId,
          name: item.name,
          department: item.department,
          quantity: item.quantity,
          revisionRounds: item.revisionRounds,
          deliverableKind: item.deliverableKind,
          deliverableLabel: item.deliverableLabel,
          templateId: item.templateId,
        })),
      })),
      installments: children.installments.map((installment, index) => ({
        id: installment.id,
        name: installment.name,
        percent: installment.percent,
        amountMinor: totals.installmentAmountsMinor[index] ?? 0,
      })),
      totals: {
        oneOff: totals.oneOff,
        monthly: totals.monthly,
        monthlyTermTotalMinor: totals.monthlyTermTotalMinor,
      },
      discountThresholdPercent: settings.discountThresholdPercent,
      needsDiscountApproval: needsApproval,
      project: project ? { id: project.id, name: project.name } : null,
      retainer: retainer ? { id: retainer.id, name: retainer.name } : null,
      versions: versions
        .filter((version) => !version.archivedAt || version.id === row.id)
        .map((version) => ({ id: version.id, version: version.version, status: version.status })),
      pdf: row.status !== 'draft' && row.pdfStatus ? { state: row.pdfStatus } : null,
      draftPdf:
        isDraft && row.draftPdfStatus
          ? {
              state: row.draftPdfStatus,
              renderedAt: row.draftPdfAt?.toISOString() ?? null,
              outdated: previewOutdated,
            }
          : null,
      permissions: {
        canEdit: editable,
        canRequestApproval:
          editable && needsApproval && ['none', 'returned'].includes(row.discountApproval),
        canWithdrawApproval: manages && isDraft && row.discountApproval === 'pending',
        canDecideApproval:
          approvesDiscounts(actor) &&
          !client.archived &&
          isDraft &&
          row.discountApproval === 'pending',
        canSend: editable && takesQuotes && children.lines.length > 0,
        canExtend: manages && row.status === 'expired',
        canReject: manages && ['sent', 'expired'].includes(row.status),
        canCreateVersion:
          manages && ['sent', 'expired', 'rejected'].includes(row.status) && newer.length === 0,
        canArchive: manages && isDraft,
        canAccept:
          manages && takesQuotes && row.status === 'sent' && coversEngagements(actor, client),
        canRenderPdf: isDraft ? manages : row.status !== 'draft' && row.pdfStatus !== 'ready',
      },
    };
  }

  private toSummary(
    row: QuoteRow,
    client: Recipient,
    children: QuoteChildren,
    people: Map<string, { id: string; name: string }>,
    today: string,
  ): Quote {
    const totals = totalsOf(row, children);
    const manager = people.get(client.accountManagerId);
    return {
      id: row.id,
      displayNumber: quoteDisplayNumber(row),
      year: row.year,
      number: row.number,
      version: row.version,
      title: row.title,
      client: client.kind === 'client' ? { id: client.id, name: client.name } : null,
      recipient: { kind: client.kind, id: client.id, name: client.name },
      accountManager: { id: client.accountManagerId, name: manager?.name ?? '' },
      currency: row.currency,
      status: row.status,
      discountApproval: row.discountApproval,
      oneOffNetMinor: totals.oneOff.netMinor,
      monthlyNetMinor: totals.monthly.netMinor,
      validUntil: row.validUntil,
      expiresSoon:
        row.status === 'sent' &&
        !!row.validUntil &&
        row.validUntil <= addDays(today, QUOTE_LIMITS.expiresSoonDays),
      updatedAt: row.updatedAt.toISOString(),
      archivedAt: row.archivedAt?.toISOString() ?? null,
    };
  }

  /** Rule 2: the counter row of the year is locked by the upsert until the transaction ends. */
  private async nextNumber(tx: Transaction, year: number): Promise<number> {
    const [row] = await tx
      .insert(quoteNumbers)
      .values({ year, lastNumber: 1 })
      .onConflictDoUpdate({
        target: quoteNumbers.year,
        set: { lastNumber: sql`${quoteNumbers.lastNumber} + 1` },
      })
      .returning({ lastNumber: quoteNumbers.lastNumber });
    if (!row) throw new Error('No quote number');
    return row.lastNumber;
  }

  /** A non-archived contact of the client; a lead quote has none (F03). */
  private async assertContact(tx: Transaction, recipient: Recipient, contactId: string) {
    if (
      recipient.kind !== 'client' ||
      !(await this.clients.isActiveContact(recipient.id, contactId, tx))
    ) {
      throw new CodedException(400, 'UNKNOWN_CONTACT', 'Not a contact of the client');
    }
  }

  /** Rules 3 and 4: the draft's lines as stored, copied from the catalog or the draft. */
  private async buildLines(
    tx: Transaction,
    quote: QuoteRow,
    input: QuoteDraft,
    current: LineWithItems[],
  ): Promise<LineWithItems[]> {
    const services = await this.catalog.services(
      input.lines.flatMap((line) => [
        ...(line.serviceId ? [line.serviceId] : []),
        ...line.items.map((item) => item.serviceId),
      ]),
      tx,
    );
    const packages = await this.catalog.packages(
      input.lines.flatMap((line) => (line.packageId ? [line.packageId] : [])),
      tx,
    );
    const existing = new Map(current.map((line) => [line.id, line]));
    const recurrency = input.currency !== quote.currency;
    const positions = { one_off: 0, monthly: 0 };
    const kept = new Set<string>();
    return input.lines.map((line) => {
      const stored = line.id ? existing.get(line.id) : undefined;
      const same =
        stored &&
        !kept.has(stored.id) &&
        stored.serviceId === line.serviceId &&
        stored.packageId === line.packageId
          ? stored
          : undefined;
      if (same) kept.add(same.id);
      const item = line.serviceId
        ? services.get(line.serviceId)
        : packages.get(line.packageId ?? '');
      if (!same) assertOffered(item, line);
      if ((same?.section ?? item?.billing) !== line.section) {
        throw new BadRequestException('A line sits in the section of its billing');
      }
      const id = same?.id ?? newId();
      const listPrice =
        same && !recurrency
          ? same.listUnitPriceMinor
          : item
            ? catalogPrice(item, input.currency)
            : null;
      const base: LineRow = {
        id,
        quoteId: quote.id,
        section: line.section,
        serviceId: line.serviceId,
        packageId: line.packageId,
        name: same?.name ?? item?.name ?? '',
        // A new line starts with the catalog description unless the builder sent one.
        description: same || line.description ? line.description : (item?.description ?? null),
        department: same
          ? same.department
          : line.serviceId
            ? (item as CatalogServiceEntry).department
            : null,
        quantity: line.quantity,
        unitPriceMinor: recurrency ? (listPrice ?? 0) : line.unitPriceMinor,
        listUnitPriceMinor: listPrice,
        revisionRounds: line.revisionRounds,
        deliverableKind: same ? same.deliverableKind : (serviceOf(item)?.deliverableKind ?? null),
        deliverableLabel: same
          ? same.deliverableLabel
          : (serviceOf(item)?.deliverableLabel ?? null),
        templateId: same ? same.templateId : (item?.templateId ?? null),
        position: positions[line.section]++,
      };
      return { ...base, items: this.buildItems(line, id, same, item, services) };
    });
  }

  /** A package line lists exactly the services it was copied with, in their order. */
  private buildItems(
    line: QuoteLineInput,
    lineId: string,
    stored: LineWithItems | undefined,
    item: CatalogServiceEntry | CatalogPackageEntry | undefined,
    services: Map<string, CatalogServiceEntry>,
  ): ItemRow[] {
    if (!line.packageId) return [];
    const expected: Omit<ItemRow, 'id' | 'lineId' | 'quantity' | 'revisionRounds' | 'position'>[] =
      stored
        ? stored.items
        : ((item as CatalogPackageEntry | undefined)?.items ?? []).map(({ service }) => ({
            serviceId: service.id,
            name: service.name,
            department: service.department,
            deliverableKind: service.deliverableKind,
            deliverableLabel: service.deliverableLabel,
            templateId: service.billing === 'one_off' ? service.templateId : null,
          }));
    const given = new Map(line.items.map((entry) => [entry.serviceId, entry]));
    if (
      expected.length !== line.items.length ||
      expected.some((entry) => !given.has(entry.serviceId) || !services.has(entry.serviceId))
    ) {
      throw new CodedException(
        400,
        'INVALID_PACKAGE_ITEM',
        "A package line lists other services than the package's",
        line.items.map((entry) => entry.serviceId),
      );
    }
    return expected.map((entry, position) => {
      const input = given.get(entry.serviceId);
      return {
        ...entry,
        id: newId(),
        lineId,
        quantity: input?.quantity ?? 1,
        revisionRounds: input?.revisionRounds ?? 0,
        position,
      };
    });
  }

  private async replaceChildren(
    tx: Transaction,
    quoteId: string,
    children: { lines: LineWithItems[]; installments: InstallmentRow[] },
  ): Promise<void> {
    const oldLines = await tx
      .select({ id: quoteLines.id })
      .from(quoteLines)
      .where(eq(quoteLines.quoteId, quoteId));
    if (oldLines.length) {
      await tx.delete(quoteLineItems).where(
        inArray(
          quoteLineItems.lineId,
          oldLines.map((line) => line.id),
        ),
      );
      await tx.delete(quoteLines).where(eq(quoteLines.quoteId, quoteId));
    }
    await tx.delete(quoteInstallments).where(eq(quoteInstallments.quoteId, quoteId));
    if (children.lines.length) {
      await tx.insert(quoteLines).values(children.lines.map(({ items: _items, ...line }) => line));
      const items = children.lines.flatMap((line) => line.items);
      if (items.length) await tx.insert(quoteLineItems).values(items);
    }
    if (children.installments.length) {
      await tx.insert(quoteInstallments).values(children.installments);
    }
  }

  private async archivedCatalogItems(
    executor: Database | Transaction,
    lines: LineWithItems[],
  ): Promise<Set<string>> {
    const services = await this.catalog.services(
      lines.flatMap((line) => (line.serviceId ? [line.serviceId] : [])),
      executor,
    );
    const packages = await this.catalog.packages(
      lines.flatMap((line) => (line.packageId ? [line.packageId] : [])),
      executor,
    );
    return new Set(
      [...services.values(), ...packages.values()].filter((i) => i.archived).map((i) => i.id),
    );
  }
}

/** Rule 3: only a draft whose approval is not pending is edited. */
export function assertEditable(quote: QuoteRow): void {
  if (quote.archivedAt || quote.status !== 'draft') {
    throw new CodedException(409, 'QUOTE_LOCKED', 'Only a draft is edited');
  }
  if (quote.discountApproval === 'pending') {
    throw new CodedException(409, 'APPROVAL_PENDING', 'The discount awaits approval');
  }
}

/** Rule 4: a new line comes from a non-archived catalog item. */
function assertOffered(
  item: CatalogServiceEntry | CatalogPackageEntry | undefined,
  line: QuoteLineInput,
): asserts item is CatalogServiceEntry | CatalogPackageEntry {
  if (!item)
    throw new BadRequestException(`Unknown catalog item ${line.serviceId ?? line.packageId}`);
  if (item.archived) {
    throw new CodedException(409, 'CATALOG_ITEM_ARCHIVED', 'The catalog item is archived', [
      item.id,
    ]);
  }
}

const serviceOf = (item: CatalogServiceEntry | CatalogPackageEntry | undefined) =>
  item && 'department' in item ? item : undefined;

/** What an approval covers (rule 7): currency, discounts, lines, prices and quantities. */
function pricing(
  quote: Pick<QuoteRow, 'currency' | 'oneOffDiscountMinor' | 'monthlyDiscountMinor'>,
  lines: LineWithItems[],
): string {
  return JSON.stringify([
    quote.currency,
    quote.oneOffDiscountMinor,
    quote.monthlyDiscountMinor,
    // By section then position: the order of the request's sections does not matter.
    [...lines]
      .sort((a, b) => a.section.localeCompare(b.section) || a.position - b.position)
      .map((line) => [
        line.serviceId ?? line.packageId,
        line.quantity,
        line.unitPriceMinor,
        line.items.map((item) => [item.serviceId, item.quantity]),
      ]),
  ]);
}

function pick<T extends Record<string, unknown>, K extends keyof T>(
  row: T,
  shape: Record<K, unknown>,
): Pick<T, K> {
  return Object.fromEntries(Object.keys(shape).map((key) => [key, row[key]])) as Pick<T, K>;
}
