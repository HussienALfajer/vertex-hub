import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  type BillableItems,
  type BillableItemsQuery,
  businessDate,
  type CreateInvoice,
  type Currency,
  daysInclusive,
  INVOICE_LIMITS,
  type Invoice,
  type InvoiceDetail,
  type InvoiceDraft,
  type InvoiceListQuery,
  type InvoicePage,
  type InvoiceSource,
  type InvoiceStatus,
  invoiceDisplayNumber,
  invoiceTotal,
  OPEN_INVOICE_STATUSES,
  type Payment,
  type Permission,
  receiptDisplayNumber,
  toUsdMinor,
} from '@vertex-hub/contracts';
import { type Database, invoiceLines, invoices, payments, type Transaction } from '@vertex-hub/db';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { changedFields, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { CatalogDirectory } from '../catalog/index.js';
import { ClientDirectory, type ClientSummary } from '../clients/index.js';
import { GeneratedFiles } from '../files/index.js';
import {
  type BillingEngagement,
  type BillingSource,
  BillingSources,
  sourceKey,
} from '../projects/index.js';
import { QuoteDirectory } from '../quotes/index.js';
import {
  actorOf,
  assertCanManage,
  assertClientNotArchived,
  canManage,
  covers,
  holdsAll,
} from './invoice-access.js';
import { InvoiceSettingsService } from './invoice-settings.service.js';
import { InvoiceSnapshots } from './invoice-snapshots.js';

export type InvoiceRow = typeof invoices.$inferSelect;

export type InvoiceLineRow = typeof invoiceLines.$inferSelect;

type NewLine = Omit<InvoiceLineRow, 'id' | 'invoiceId' | 'holdsSource' | 'position'>;

/** `INV-2026-0012`, `2026-12` or `12`. */
function numberSearch(search: string): SQL | undefined {
  const full = /^(?:inv-?)?(\d{4})-0*(\d{1,9})$/i.exec(search);
  if (full) return and(eq(invoices.year, Number(full[1])), eq(invoices.number, Number(full[2])));
  if (/^\d{1,9}$/.test(search)) return eq(invoices.number, Number(search));
  return undefined;
}

/** The source a line bills, if any. */
export function lineSource(line: InvoiceLineRow): InvoiceSource | null {
  if (line.milestoneId) return { type: 'milestone', id: line.milestoneId };
  if (line.retainerCycleId) return { type: 'retainer_cycle', id: line.retainerCycleId };
  if (line.extraWorkItemId) return { type: 'extra_work', id: line.extraWorkItemId };
  return null;
}

const sourceColumns = (source: InvoiceSource | null) => ({
  milestoneId: source?.type === 'milestone' ? source.id : null,
  retainerCycleId: source?.type === 'retainer_cycle' ? source.id : null,
  extraWorkItemId: source?.type === 'extra_work' ? source.id : null,
});

/** What every invoice audit entry carries: its client and its number once issued. */
export const identity = (row: InvoiceRow) => ({
  clientId: row.clientId,
  number:
    row.year && row.number ? invoiceDisplayNumber({ year: row.year, number: row.number }) : null,
});

const displayNumber = (row: InvoiceRow) => identity(row).number;

/** An invoice without a draft preview: before the first, and once issued or discarded. */
export const NO_DRAFT_PDF = {
  draftPdfStatus: null,
  draftPdfRequestedHash: null,
  draftPdfObjectKey: null,
  draftPdfAt: null,
  draftPdfHash: null,
} as const;

/** Rule 21's "days overdue": whole days after the due date. */
function daysOverdue(row: InvoiceRow, today: string): number | null {
  if (row.status !== 'overdue' || !row.dueOn) return null;
  const days = daysInclusive(row.dueOn, today) - 1;
  return days >= 1 ? days : null;
}

const archivedCode = (engagement: BillingEngagement) =>
  engagement.type === 'project' ? ('PROJECT_ARCHIVED' as const) : ('RETAINER_ARCHIVED' as const);

/** Invoices (F13): list, detail, billable items, manual drafts, whole-draft save, discard. */
@Injectable()
export class InvoicesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly users: UserDirectory,
    private readonly sources: BillingSources,
    private readonly quotes: QuoteDirectory,
    private readonly settings: InvoiceSettingsService,
    private readonly files: GeneratedFiles,
    private readonly snapshots: InvoiceSnapshots,
    private readonly catalog: CatalogDirectory,
  ) {}

  private readonly logger = new Logger(InvoicesService.name);

  async list(actor: CurrentUserInfo, query: InvoiceListQuery): Promise<InvoicePage> {
    const base: (SQL | undefined)[] = [
      isNull(invoices.archivedAt),
      holdsAll(actor, 'invoices.read')
        ? undefined
        : this.clients.managedBy(invoices.clientId, actor.id),
    ];
    if (query.search) {
      base.push(
        or(numberSearch(query.search), this.clients.nameContains(invoices.clientId, query.search)),
      );
    }
    if (query.clientId) base.push(eq(invoices.clientId, query.clientId));
    if (query.projectId) base.push(eq(invoices.projectId, query.projectId));
    if (query.retainerId) base.push(eq(invoices.retainerId, query.retainerId));
    if (query.currency) base.push(eq(invoices.currency, query.currency));
    if (query.origin) base.push(eq(invoices.origin, query.origin));
    if (query.accountManagerId) {
      base.push(this.clients.managedBy(invoices.clientId, query.accountManagerId));
    }
    if (query.dueFrom) base.push(gte(invoices.dueOn, query.dueFrom));
    if (query.dueTo) base.push(lte(invoices.dueOn, query.dueTo));
    const where = and(...base, inArray(invoices.status, query.status));
    const order = query.order === 'desc' ? desc : asc;
    const nullsLast = (column: PgColumn) => sql`${column} ${sql.raw(query.order)} nulls last`;
    const sorts =
      query.sort === 'number'
        ? [nullsLast(invoices.year), nullsLast(invoices.number)]
        : query.sort === 'dueOn'
          ? [nullsLast(invoices.dueOn)]
          : [order(invoices.updatedAt)];
    const [rows, [total], open] = await Promise.all([
      this.db
        .select()
        .from(invoices)
        .where(where)
        .orderBy(...sorts, asc(invoices.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ value: count() }).from(invoices).where(where),
      this.db
        .select({
          currency: invoices.currency,
          status: invoices.status,
          totalMinor: invoices.totalMinor,
          paidMinor: invoices.paidMinor,
          sypPerUsd: invoices.sypPerUsd,
        })
        .from(invoices)
        .where(and(...base, inArray(invoices.status, [...OPEN_INVOICE_STATUSES]))),
    ]);
    const summaries = await this.summaries(rows);
    return {
      items: summaries,
      total: total?.value ?? 0,
      page: query.page,
      pageSize: query.pageSize,
      totals: outstandingTotals(open),
    };
  }

  async detail(
    actor: CurrentUserInfo,
    id: string,
    executor: Database | Transaction = this.db,
  ): Promise<InvoiceDetail> {
    const [row] = await executor.select().from(invoices).where(eq(invoices.id, id));
    const client = row ? await this.clients.summary(row.clientId, executor) : null;
    if (!row || !client || !covers(actor, 'invoices.read', client)) throw new NotFoundException();
    return this.toDetail(actor, row, client, executor);
  }

  /** Rule 6: the client's work in the currency that no live invoice holds yet. */
  async billable(actor: CurrentUserInfo, query: BillableItemsQuery): Promise<BillableItems> {
    const client = await this.clients.summary(query.clientId);
    if (!client || !covers(actor, 'invoices.read', client)) throw new NotFoundException();
    assertCanManage(actor, client);
    const work = await this.sources.billable(client.id, query.currency);
    const taken = await this.takenSources(this.db, [
      ...work.milestones.map((item) => ({ type: 'milestone' as const, id: item.id })),
      ...work.cycles.map((item) => ({ type: 'retainer_cycle' as const, id: item.id })),
      ...work.extraWork.map((item) => ({ type: 'extra_work' as const, id: item.id })),
    ]);
    return {
      milestones: work.milestones.filter((item) => !taken.has(`milestone:${item.id}`)),
      cycles: work.cycles.filter((item) => !taken.has(`retainer_cycle:${item.id}`)),
      extraWork: work.extraWork.filter((item) => !taken.has(`extra_work:${item.id}`)),
    };
  }

  /** Rules 1 and 6: a manual draft with a line per source at its default amount. */
  async create(actor: CurrentUserInfo, input: CreateInvoice): Promise<InvoiceDetail> {
    return this.db.transaction(async (tx) => {
      const client = await this.clients.summary(input.clientId, tx);
      if (!client || !covers(actor, 'invoices.read', client)) throw new NotFoundException();
      assertCanManage(actor, client);
      assertClientNotArchived(client);
      const prepared = await this.prepareLines(
        tx,
        client,
        input.currency,
        input.sources.map((source) => ({ source })),
        input,
        null,
      );
      const settings = await this.settings.row(tx);
      const [row] = await tx
        .insert(invoices)
        .values({
          clientId: client.id,
          projectId: prepared.engagement?.type === 'project' ? prepared.engagement.id : null,
          retainerId: prepared.engagement?.type === 'retainer' ? prepared.engagement.id : null,
          origin: 'manual',
          currency: input.currency,
          paymentTermsDays: settings.paymentTermsDays,
          totalMinor: invoiceTotal(prepared.lines),
          createdById: actor.id,
        })
        .returning();
      if (!row) throw new Error('The invoice was not created');
      await this.insertLines(tx, row.id, prepared.lines);
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'invoice.created',
        entityType: 'invoice',
        entityId: row.id,
        after: {
          ...identity(row),
          origin: row.origin,
          currency: row.currency,
          totalMinor: row.totalMinor,
          sources: input.sources,
        },
      });
      return this.toDetail(actor, row, client, tx);
    });
  }

  /** Rule 7: the whole draft at once; lines are copies, edited freely. */
  async saveDraft(actor: CurrentUserInfo, id: string, input: InvoiceDraft): Promise<InvoiceDetail> {
    return this.db.transaction(async (tx) => {
      const { invoice, client } = await this.lockForChange(tx, actor, id);
      if (invoice.archivedAt || invoice.status !== 'draft') {
        throw new CodedException(409, 'INVOICE_LOCKED', 'Only a draft is edited');
      }
      if (invoice.updatedAt.getTime() !== new Date(input.updatedAt).getTime()) {
        throw new CodedException(409, 'STALE_INVOICE', 'The draft changed since it was loaded');
      }
      assertClientNotArchived(client);
      if (input.lines.length > INVOICE_LIMITS.lines) {
        throw new CodedException(409, 'LIMIT_REACHED', 'An invoice has at most 50 lines');
      }
      const before = await this.lines(tx, id);
      await this.assertServices(
        tx,
        input.lines.map((line) => line.serviceId),
        before.map((line) => line.serviceId),
      );
      const prepared = await this.prepareLines(
        tx,
        client,
        invoice.currency,
        input.lines,
        input,
        id,
      );
      await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, id));
      await this.insertLines(tx, id, prepared.lines);
      const fields = {
        projectId: prepared.engagement?.type === 'project' ? prepared.engagement.id : null,
        retainerId: prepared.engagement?.type === 'retainer' ? prepared.engagement.id : null,
        paymentTermsDays: input.paymentTermsDays,
        notes: input.notes,
        totalMinor: invoiceTotal(prepared.lines),
      };
      const [updated] = await tx
        .update(invoices)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(invoices.id, id))
        .returning();
      if (!updated) throw new NotFoundException();
      const changes = changedFields(
        {
          projectId: invoice.projectId,
          retainerId: invoice.retainerId,
          paymentTermsDays: invoice.paymentTermsDays,
          notes: invoice.notes,
          totalMinor: invoice.totalMinor,
          lineCount: before.length,
        },
        { ...fields, lineCount: prepared.lines.length },
      );
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'invoice.updated',
        entityType: 'invoice',
        entityId: id,
        before: { ...identity(invoice), ...changes?.before },
        after: { ...identity(updated), ...changes?.after },
      });
      return this.toDetail(actor, updated, client, tx);
    });
  }

  /** Rule 8: discarding a draft archives it and releases its sources. */
  async archive(actor: CurrentUserInfo, id: string): Promise<void> {
    const preview = await this.db.transaction(async (tx) => {
      const { invoice } = await this.lockForChange(tx, actor, id);
      if (invoice.archivedAt || invoice.status !== 'draft') {
        throw new CodedException(409, 'INVALID_TRANSITION', 'Only a draft is discarded');
      }
      await tx
        .update(invoices)
        .set({ archivedAt: new Date(), ...NO_DRAFT_PDF })
        .where(eq(invoices.id, id));
      await tx
        .update(invoiceLines)
        .set({ holdsSource: false })
        .where(eq(invoiceLines.invoiceId, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'invoice.archived',
        entityType: 'invoice',
        entityId: id,
        before: { ...identity(invoice), archived: false },
        after: { ...identity(invoice), archived: true },
      });
      return invoice.draftPdfObjectKey;
    });
    // The preview of a discarded draft is deleted.
    if (preview) {
      await this.files.remove(preview).catch((error: unknown) => {
        this.logger.warn(`Could not delete ${preview}: ${String(error)}`);
      });
    }
  }

  /**
   * Locks an invoice for a change: 404 outside read access, 403 without `permission` over the
   * client (`invoices.manage`, or `payments.manage` for payments).
   */
  async lockForChange(
    tx: Transaction,
    actor: CurrentUserInfo,
    id: string,
    permission: Extract<Permission, 'invoices.manage' | 'payments.manage'> = 'invoices.manage',
  ): Promise<{ invoice: InvoiceRow; client: ClientSummary }> {
    const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, id)).for('update');
    const client = invoice ? await this.clients.summary(invoice.clientId, tx) : null;
    if (!invoice || !client || !covers(actor, 'invoices.read', client)) {
      throw new NotFoundException();
    }
    if (!covers(actor, permission, client)) throw new ForbiddenException();
    return { invoice, client };
  }

  /**
   * F15 rules 21–22: each chosen service exists, and is not archived unless a line already had it
   * (`INVALID_SERVICE`).
   */
  async assertServices(
    executor: Database | Transaction,
    chosen: readonly (string | null)[],
    kept: readonly (string | null)[],
  ): Promise<void> {
    const ids = chosen.filter((serviceId): serviceId is string => !!serviceId);
    const services = await this.catalog.services(ids, executor);
    for (const serviceId of ids) {
      const service = services.get(serviceId);
      if (!service || (service.archived && !kept.includes(serviceId))) {
        throw new CodedException(409, 'INVALID_SERVICE', 'Choose a non-archived catalog service', [
          serviceId,
        ]);
      }
    }
  }

  async lines(executor: Database | Transaction, invoiceId: string): Promise<InvoiceLineRow[]> {
    return executor
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoiceId))
      .orderBy(asc(invoiceLines.position));
  }

  async toDetail(
    actor: CurrentUserInfo,
    row: InvoiceRow,
    client: ClientSummary,
    executor: Database | Transaction = this.db,
  ): Promise<InvoiceDetail> {
    const lines = await this.lines(executor, row.id);
    const sources = await this.sources.resolve(
      lines.flatMap((line) => lineSource(line) ?? []),
      executor,
    );
    const services = await this.catalog.services(
      lines.flatMap((line) => line.serviceId ?? []),
      executor,
    );
    const [summary] = await this.summaries([row], executor);
    if (!summary) throw new NotFoundException();
    const billing = await this.clients.billingDetails(row.clientId, executor);
    const snapshot = row.snapshot as { billingName: string; billingAddress: string | null } | null;
    const quoteNumbers = await this.quotes.displayNumbers(
      row.quoteId ? [row.quoteId] : [],
      executor,
    );
    const people = await this.users.summaries(
      [row.issuedById, row.voidedById, row.createdById].filter((id): id is string => !!id),
      executor,
    );
    const person = (userId: string | null) => {
      const user = userId ? people.get(userId) : undefined;
      return user ? { id: user.id, name: user.name } : null;
    };
    const paymentRows = await executor
      .select()
      .from(payments)
      .where(eq(payments.invoiceId, row.id))
      .orderBy(asc(payments.year), asc(payments.number));
    const proofs = await this.files.names(
      paymentRows.flatMap((payment) => payment.proofFileItemId ?? []),
      executor,
    );
    const recorders = await this.users.summaries(
      paymentRows.flatMap((payment) => [payment.recordedById, payment.voidedById ?? []]).flat(),
      executor,
    );
    const recorder = (userId: string) => ({
      id: userId,
      name: recorders.get(userId)?.name ?? '',
    });
    const rate = row.sypPerUsd;
    const manages = canManage(actor, client);
    const takesPayments = covers(actor, 'payments.manage', client);
    const isDraft = row.status === 'draft' && !row.archivedAt;
    const voidedBy = person(row.voidedById);
    // A preview is outdated once the draft (or what it prints) changed.
    const previewOutdated =
      isDraft && row.draftPdfStatus && row.draftPdfHash
        ? (await this.snapshots.draftHash(row, lines, client, executor)) !== row.draftPdfHash
        : false;
    return {
      ...summary,
      billingName: snapshot?.billingName ?? billing?.name ?? client.name,
      billingAddress: snapshot ? snapshot.billingAddress : (billing?.address ?? null),
      year: row.year,
      number: row.number,
      quote:
        row.quoteId && quoteNumbers.has(row.quoteId)
          ? { id: row.quoteId, displayNumber: quoteNumbers.get(row.quoteId) ?? '' }
          : null,
      paymentTermsDays: row.paymentTermsDays,
      sypPerUsd: rate,
      usd:
        rate && row.status !== 'draft'
          ? {
              totalMinor: toUsdMinor(row.totalMinor, row.currency, rate),
              paidMinor: toUsdMinor(row.paidMinor, row.currency, rate),
              balanceMinor: toUsdMinor(summary.balanceMinor, row.currency, rate),
            }
          : null,
      notes: row.notes,
      lines: lines.map((line) => {
        const ref = lineSource(line);
        const source = ref ? sources.get(sourceKey(ref)) : undefined;
        const service = line.serviceId ? services.get(line.serviceId) : undefined;
        return {
          id: line.id,
          description: line.description,
          quantity: line.quantity,
          unitPriceMinor: line.unitPriceMinor,
          totalMinor: line.quantity * line.unitPriceMinor,
          source:
            ref && source
              ? {
                  ...ref,
                  name: source.name,
                  project:
                    source.engagement.type === 'project'
                      ? { id: source.engagement.id, name: source.engagement.name }
                      : null,
                  retainer:
                    source.engagement.type === 'retainer'
                      ? { id: source.engagement.id, name: source.engagement.name }
                      : null,
                }
              : null,
          service: service
            ? { id: service.id, name: service.name, archived: service.archived }
            : null,
        };
      }),
      payments: paymentRows.map(
        (payment): Payment => ({
          id: payment.id,
          receiptNumber: receiptDisplayNumber(payment),
          paidOn: payment.paidOn,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          sypPerUsd: payment.sypPerUsd,
          appliedMinor: payment.appliedMinor,
          method: payment.method,
          reference: payment.reference,
          note: payment.note,
          proof: payment.proofFileItemId
            ? { id: payment.proofFileItemId, name: proofs.get(payment.proofFileItemId) ?? '' }
            : null,
          receiptPdf: payment.receiptPdfStatus ? { state: payment.receiptPdfStatus } : null,
          recordedBy: recorder(payment.recordedById),
          createdAt: payment.createdAt.toISOString(),
          voided:
            payment.voidedAt && payment.voidedById
              ? {
                  at: payment.voidedAt.toISOString(),
                  by: recorder(payment.voidedById),
                  reason: payment.voidReason ?? '',
                }
              : null,
        }),
      ),
      pdf: row.status !== 'draft' && row.pdfStatus ? { state: row.pdfStatus } : null,
      draftPdf:
        isDraft && row.draftPdfStatus
          ? {
              state: row.draftPdfStatus,
              renderedAt: row.draftPdfAt?.toISOString() ?? null,
              outdated: previewOutdated,
            }
          : null,
      issuedBy: person(row.issuedById),
      voided:
        row.voidedAt && voidedBy
          ? { at: row.voidedAt.toISOString(), by: voidedBy, reason: row.voidReason ?? '' }
          : null,
      createdBy: person(row.createdById),
      createdAt: row.createdAt.toISOString(),
      permissions: {
        canEdit: manages && isDraft && !client.archived,
        canIssue: manages && isDraft && !client.archived,
        canArchive: manages && isDraft,
        canChangeDueDate: manages && OPEN_STATUSES.includes(row.status),
        canVoid: manages && ['sent', 'overdue'].includes(row.status) && row.paidMinor === 0,
        canRecordPayment: takesPayments && OPEN_STATUSES.includes(row.status),
        canVoidPayments: takesPayments && row.status !== 'draft' && row.status !== 'void',
        canRenderPdf: isDraft ? manages : row.status !== 'draft' && row.pdfStatus !== 'ready',
        canEditServices: manages && row.status !== 'draft' && row.status !== 'void',
      },
    };
  }

  async summaries(
    rows: InvoiceRow[],
    executor: Database | Transaction = this.db,
  ): Promise<Invoice[]> {
    const clients = await this.clients.summaries(
      rows.map((row) => row.clientId),
      executor,
    );
    const people = await this.users.summaries(
      [...clients.values()].map((client) => client.accountManagerId),
      executor,
    );
    const engagements = await this.sources.engagements(
      {
        projectIds: rows.flatMap((row) => (row.projectId ? [row.projectId] : [])),
        retainerIds: rows.flatMap((row) => (row.retainerId ? [row.retainerId] : [])),
      },
      executor,
    );
    const today = businessDate();
    return rows.flatMap((row) => {
      const client = clients.get(row.clientId);
      if (!client) return [];
      const engagement = engagements.get(row.projectId ?? row.retainerId ?? '');
      return [
        {
          id: row.id,
          displayNumber: displayNumber(row),
          client: { id: client.id, name: client.name },
          accountManager: {
            id: client.accountManagerId,
            name: people.get(client.accountManagerId)?.name ?? '',
          },
          engagement: engagement
            ? { type: engagement.type, id: engagement.id, name: engagement.name }
            : null,
          origin: row.origin,
          currency: row.currency,
          status: row.status,
          issuedOn: row.issuedOn,
          dueOn: row.dueOn,
          totalMinor: row.totalMinor,
          paidMinor: row.paidMinor,
          balanceMinor: row.status === 'void' ? 0 : row.totalMinor - row.paidMinor,
          daysOverdue: daysOverdue(row, today),
          updatedAt: row.updatedAt.toISOString(),
          archivedAt: row.archivedAt?.toISOString() ?? null,
        },
      ];
    });
  }

  /**
   * Rules 1, 4 and 6: checks the sources of the lines and the engagement they belong to. Every
   * source belongs to the client, is billable and in the invoice's currency; all sources share
   * one project or retainer (`MIXED_ENGAGEMENTS`), which a free-line draft may name instead.
   */
  private async prepareLines(
    tx: Transaction,
    client: ClientSummary,
    currency: Currency,
    inputs: {
      description?: string;
      quantity?: number;
      unitPriceMinor?: number;
      source?: InvoiceSource | null;
      serviceId?: string | null;
    }[],
    named: { projectId: string | null; retainerId: string | null },
    invoiceId: string | null,
  ): Promise<{ lines: NewLine[]; engagement: BillingEngagement | null }> {
    const refs = inputs.flatMap((input) => input.source ?? []);
    const keys = refs.map(sourceKey);
    if (new Set(keys).size !== keys.length) {
      throw new CodedException(409, 'ALREADY_INVOICED', 'A source is billed once per invoice');
    }
    // Locked so rule 25's refusals and automatic drafts wait for this draft (edge case 4).
    const resolved = await this.sources.resolve(refs, tx, { lock: true });
    const engagements = new Map<string, BillingEngagement>();
    for (const ref of refs) {
      const source = resolved.get(sourceKey(ref));
      if (!source || source.engagement.clientId !== client.id) {
        throw new BadRequestException(`Unknown ${ref.type} ${ref.id} for this client`);
      }
      assertBillable(source);
      engagements.set(source.engagement.id, source.engagement);
    }
    let engagement = [...engagements.values()][0] ?? null;
    if (engagements.size > 1) {
      throw new CodedException(409, 'MIXED_ENGAGEMENTS', 'Sources of several engagements');
    }
    const namedId = named.projectId ?? named.retainerId;
    if (namedId) {
      const chosen = await this.sources.engagement(
        named.projectId ? 'project' : 'retainer',
        namedId,
        tx,
      );
      if (!chosen || chosen.clientId !== client.id) {
        throw new BadRequestException('Not a project or retainer of this client');
      }
      if (engagement && engagement.id !== chosen.id) {
        throw new CodedException(409, 'MIXED_ENGAGEMENTS', 'The sources belong elsewhere');
      }
      engagement = chosen;
    }
    if (engagement) {
      if (engagement.archived) {
        throw new CodedException(409, archivedCode(engagement), 'The engagement is archived');
      }
      if (engagement.currency !== currency) {
        throw new CodedException(409, 'CURRENCY_MISMATCH', 'The engagement bills another currency');
      }
    }
    const taken = await this.takenSources(tx, refs, invoiceId);
    if (taken.size > 0) {
      throw new CodedException(409, 'ALREADY_INVOICED', 'A source is on another live invoice', [
        ...taken,
      ]);
    }
    const lines = inputs.map((input): NewLine => {
      const source = input.source ? resolved.get(sourceKey(input.source)) : undefined;
      return {
        description: input.description ?? source?.description ?? '',
        quantity: input.quantity ?? 1,
        unitPriceMinor: input.unitPriceMinor ?? source?.amountMinor ?? 0,
        ...sourceColumns(input.source ?? null),
        serviceId: input.serviceId ?? null,
      };
    });
    return { lines, engagement };
  }

  /** The sources (as `type:id`) held by a live invoice other than `exceptInvoiceId`. */
  private async takenSources(
    executor: Database | Transaction,
    refs: InvoiceSource[],
    exceptInvoiceId: string | null = null,
  ): Promise<Set<string>> {
    if (refs.length === 0) return new Set();
    const ids = (type: InvoiceSource['type']) =>
      refs.filter((ref) => ref.type === type).map((ref) => ref.id);
    const byType: [InvoiceSource['type'], PgColumn][] = [
      ['milestone', invoiceLines.milestoneId],
      ['retainer_cycle', invoiceLines.retainerCycleId],
      ['extra_work', invoiceLines.extraWorkItemId],
    ];
    const conditions = byType.flatMap(([type, column]) =>
      ids(type).length ? [inArray(column, ids(type))] : [],
    );
    const rows = await executor
      .select()
      .from(invoiceLines)
      .where(
        and(
          invoiceLines.holdsSource,
          or(...conditions),
          exceptInvoiceId ? ne(invoiceLines.invoiceId, exceptInvoiceId) : undefined,
        ),
      );
    return new Set(rows.flatMap((row) => lineSource(row) ?? []).map(sourceKey));
  }

  private async insertLines(tx: Transaction, invoiceId: string, lines: NewLine[]) {
    if (lines.length === 0) return;
    await tx
      .insert(invoiceLines)
      .values(lines.map((line, index) => ({ ...line, invoiceId, position: index + 1 })));
  }
}

const OPEN_STATUSES: readonly InvoiceStatus[] = OPEN_INVOICE_STATUSES;

/** A source can be billed: not archived, and extra work still unbilled. */
function assertBillable(source: BillingSource): void {
  if (source.archived) {
    throw new BadRequestException(`The ${source.type} is archived`);
  }
  if (source.type === 'extra_work' && source.billingStatus !== 'unbilled') {
    throw new CodedException(409, 'ALREADY_INVOICED', 'The extra work is billed or waived', [
      sourceKey(source),
    ]);
  }
}

/** Balances of open invoices per currency and in USD, each at its own rate. */
function outstandingTotals(
  rows: {
    currency: Currency;
    status: InvoiceStatus;
    totalMinor: number;
    paidMinor: number;
    sypPerUsd: string | null;
  }[],
): InvoicePage['totals'] {
  const byCurrency = new Map<Currency, { outstandingMinor: number; overdueMinor: number }>();
  const usd = { outstandingMinor: 0, overdueMinor: 0 };
  for (const row of rows) {
    const balance = row.totalMinor - row.paidMinor;
    const current = byCurrency.get(row.currency) ?? { outstandingMinor: 0, overdueMinor: 0 };
    current.outstandingMinor += balance;
    if (row.status === 'overdue') current.overdueMinor += balance;
    byCurrency.set(row.currency, current);
    // Issued invoices always carry a rate; a USD balance needs none.
    const inUsd =
      row.currency === 'USD'
        ? balance
        : row.sypPerUsd
          ? toUsdMinor(balance, 'SYP', row.sypPerUsd)
          : 0;
    usd.outstandingMinor += inUsd;
    if (row.status === 'overdue') usd.overdueMinor += inUsd;
  }
  return {
    byCurrency: [...byCurrency.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, totals]) => ({ currency, ...totals })),
    usd,
  };
}
