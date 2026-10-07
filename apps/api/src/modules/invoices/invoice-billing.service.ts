import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  businessDate,
  CLIENT_BILLING_LATEST,
  type ClientBilling,
  type ClientStatement,
  type ClientStatementQuery,
  type Currency,
  type InvoiceStatus,
  invoiceDisplayNumber,
  type ProjectBilling,
  type ProjectExpense,
  type RetainerBilling,
  type RetainerCharge,
  type RetainerChargeListQuery,
  type RetainerChargePage,
  receiptDisplayNumber,
  type SourceInvoice,
  statementRows,
  toUsdMinor,
} from '@vertex-hub/contracts';
import { type Database, invoiceLines, invoices, payments, projectExpenses } from '@vertex-hub/db';
import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { ClientDirectory, type ClientSummary } from '../clients/index.js';
import {
  type BillingEngagement,
  BillingSources,
  EngagementDirectory,
  type RetainerChargeRow,
} from '../projects/index.js';
import { covers } from './invoice-access.js';
import { InvoicesService } from './invoices.service.js';

type ExpenseRow = typeof projectExpenses.$inferSelect;

/** Issued, non-void invoices: what statements, balances and margins count. */
const ISSUED: InvoiceStatus[] = ['sent', 'partially_paid', 'paid', 'overdue'];

/**
 * Client balances and statements (rule 28), and the billing summaries of projects (with their
 * expenses and margin, rule 27) and retainers. Every read needs `invoices.read` covering the
 * client (money access).
 */
@Injectable()
export class InvoiceBillingService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly users: UserDirectory,
    private readonly engagements: EngagementDirectory,
    private readonly sources: BillingSources,
    private readonly invoicesService: InvoicesService,
  ) {}

  async clientBilling(actor: CurrentUserInfo, clientId: string): Promise<ClientBilling> {
    const client = await this.readableClient(actor, clientId);
    const [issued, latest] = await Promise.all([
      this.db
        .select({
          currency: invoices.currency,
          status: invoices.status,
          totalMinor: invoices.totalMinor,
          paidMinor: invoices.paidMinor,
        })
        .from(invoices)
        .where(and(eq(invoices.clientId, client.id), inArray(invoices.status, ISSUED))),
      this.db
        .select()
        .from(invoices)
        .where(and(eq(invoices.clientId, client.id), isNull(invoices.archivedAt)))
        .orderBy(desc(invoices.updatedAt), asc(invoices.id))
        .limit(CLIENT_BILLING_LATEST),
    ]);
    const byCurrency = new Map<Currency, ClientBilling['byCurrency'][number]>();
    for (const row of issued) {
      const totals = byCurrency.get(row.currency) ?? {
        currency: row.currency,
        invoicedMinor: 0,
        paidMinor: 0,
        outstandingMinor: 0,
        overdueMinor: 0,
      };
      const balance = row.totalMinor - row.paidMinor;
      totals.invoicedMinor += row.totalMinor;
      totals.paidMinor += row.paidMinor;
      totals.outstandingMinor += balance;
      if (row.status === 'overdue') totals.overdueMinor += balance;
      byCurrency.set(row.currency, totals);
    }
    return {
      byCurrency: [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
      latest: await this.invoicesService.summaries(latest),
    };
  }

  /** Rule 28: one currency over `[from, to]`, by default the current year up to today. */
  async statement(
    actor: CurrentUserInfo,
    clientId: string,
    query: ClientStatementQuery,
  ): Promise<ClientStatement> {
    const client = await this.readableClient(actor, clientId);
    const today = businessDate();
    const from = query.from ?? `${today.slice(0, 4)}-01-01`;
    const to = query.to ?? today;
    if (from > to) {
      throw new CodedException(400, 'INVALID_DATES', 'The period ends before it starts');
    }
    const invoiceRows = await this.db
      .select({
        id: invoices.id,
        year: invoices.year,
        number: invoices.number,
        issuedOn: invoices.issuedOn,
        totalMinor: invoices.totalMinor,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.clientId, client.id),
          eq(invoices.currency, query.currency),
          inArray(invoices.status, ISSUED),
        ),
      );
    const issued = invoiceRows.flatMap((row) =>
      row.year && row.number && row.issuedOn
        ? [
            {
              id: row.id,
              displayNumber: invoiceDisplayNumber({ year: row.year, number: row.number }),
              issuedOn: row.issuedOn,
              totalMinor: row.totalMinor,
            },
          ]
        : [],
    );
    const numbers = new Map(issued.map((invoice) => [invoice.id, invoice.displayNumber]));
    const paymentRows = numbers.size
      ? await this.db
          .select()
          .from(payments)
          .where(and(inArray(payments.invoiceId, [...numbers.keys()]), isNull(payments.voidedAt)))
      : [];
    const result = statementRows({
      invoices: issued,
      payments: paymentRows.map((payment) => ({
        id: payment.id,
        receiptNumber: receiptDisplayNumber(payment),
        invoiceId: payment.invoiceId,
        invoiceNumber: numbers.get(payment.invoiceId) ?? '',
        paidOn: payment.paidOn,
        appliedMinor: payment.appliedMinor,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
      })),
      statementCurrency: query.currency,
      from,
      to,
    });
    const billing = await this.clients.billingDetails(client.id);
    return {
      client: { id: client.id, name: client.name },
      billingName: billing?.name ?? client.name,
      billingAddress: billing?.address ?? null,
      currency: query.currency,
      from,
      to,
      ...result,
      outstandingMinor: result.closingMinor,
    };
  }

  /**
   * The project's milestones with their live invoice, its invoices, expenses and margin
   * (rule 27): 404 when the project is unreadable, 403 without money access.
   */
  async projectBilling(actor: CurrentUserInfo, projectId: string): Promise<ProjectBilling> {
    await this.engagements.readableProject(actor, projectId);
    const project = await this.sources.engagement('project', projectId);
    const client = project ? await this.clients.summary(project.clientId) : null;
    if (!project || !client) throw new NotFoundException();
    if (!covers(actor, 'invoices.read', client)) throw new ForbiddenException();
    const [milestones, invoiceRows, expenseRows] = await Promise.all([
      this.sources.projectMilestones(project.id),
      this.db
        .select()
        .from(invoices)
        .where(and(eq(invoices.projectId, project.id), isNull(invoices.archivedAt)))
        .orderBy(desc(invoices.createdAt), asc(invoices.id)),
      this.db
        .select()
        .from(projectExpenses)
        .where(and(eq(projectExpenses.projectId, project.id), isNull(projectExpenses.archivedAt)))
        .orderBy(desc(projectExpenses.spentOn), desc(projectExpenses.createdAt)),
    ]);
    const issued = invoiceRows.filter((row) => ISSUED.includes(row.status));
    const paid = issued.length
      ? await this.db
          .select({
            amountMinor: payments.amountMinor,
            currency: payments.currency,
            sypPerUsd: payments.sypPerUsd,
          })
          .from(payments)
          .where(
            and(
              inArray(
                payments.invoiceId,
                issued.map((row) => row.id),
              ),
              isNull(payments.voidedAt),
            ),
          )
      : [];
    const held = await this.liveInvoices(
      invoiceLines.milestoneId,
      milestones.map((milestone) => milestone.id),
    );
    const expenses = await this.presentExpenses(expenseRows);
    const invoicedUsdMinor = sum(
      issued.map((row) =>
        row.sypPerUsd ? toUsdMinor(row.totalMinor, row.currency, row.sypPerUsd) : 0,
      ),
    );
    const expensesUsdMinor = sum(expenses.map((expense) => expense.usdMinor));
    return {
      project: {
        id: project.id,
        name: project.name,
        currency: project.currency,
        archived: project.archived,
      },
      milestones: milestones.map((milestone) => ({
        ...milestone,
        invoice: held.get(milestone.id) ?? null,
      })),
      invoices: await this.invoicesService.summaries(invoiceRows),
      expenses,
      margin: {
        invoicedUsdMinor,
        collectedUsdMinor: sum(
          paid.map((payment) =>
            toUsdMinor(payment.amountMinor, payment.currency, payment.sypPerUsd),
          ),
        ),
        expensesUsdMinor,
        marginUsdMinor: invoicedUsdMinor - expensesUsdMinor,
        plannedInstallmentsMinor: sum(
          milestones.map((milestone) => milestone.installmentMinor ?? 0),
        ),
      },
      canManageExpenses: !project.archived && covers(actor, 'expenses.manage', client),
    };
  }

  /**
   * The retainer's charges (F05B) and extra work with their live invoice, and its invoices: 404
   * when the retainer is unreadable, 403 without money access.
   */
  async retainerBilling(actor: CurrentUserInfo, retainerId: string): Promise<RetainerBilling> {
    const retainer = await this.moneyRetainer(actor, retainerId);
    const [work, invoiceRows] = await Promise.all([
      this.sources.retainerWork(retainer.id),
      this.db
        .select()
        .from(invoices)
        .where(and(eq(invoices.retainerId, retainer.id), isNull(invoices.archivedAt)))
        .orderBy(desc(invoices.createdAt), asc(invoices.id)),
    ]);
    const [charges, extraWorkInvoices] = await Promise.all([
      this.withInvoices(work.charges),
      this.liveInvoices(
        invoiceLines.extraWorkItemId,
        work.extraWork.map((item) => item.id),
      ),
    ]);
    return {
      retainer: {
        id: retainer.id,
        name: retainer.name,
        currency: retainer.currency,
        monthlyFeeMinor: work.monthlyFeeMinor,
        archived: retainer.archived,
      },
      charges,
      extraWork: work.extraWork.map((item) => ({
        ...item,
        invoice: extraWorkInvoices.get(item.id) ?? null,
      })),
      invoices: await this.invoicesService.summaries(invoiceRows),
    };
  }

  /** F05B: a page of the retainer's charges with their live invoice; 404 and 403 as billing. */
  async retainerCharges(
    actor: CurrentUserInfo,
    retainerId: string,
    query: RetainerChargeListQuery,
  ): Promise<RetainerChargePage> {
    const retainer = await this.moneyRetainer(actor, retainerId);
    const page = await this.sources.retainerCharges(retainer.id, query);
    return {
      items: await this.withInvoices(page.items),
      total: page.total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** A retainer the actor may read (else 404) with money access over its client (else 403). */
  private async moneyRetainer(
    actor: CurrentUserInfo,
    retainerId: string,
  ): Promise<BillingEngagement> {
    await this.engagements.readableRetainer(actor, retainerId);
    const retainer = await this.sources.engagement('retainer', retainerId);
    const client = retainer ? await this.clients.summary(retainer.clientId) : null;
    if (!retainer || !client) throw new NotFoundException();
    if (!covers(actor, 'invoices.read', client)) throw new ForbiddenException();
    return retainer;
  }

  private async withInvoices(charges: RetainerChargeRow[]): Promise<RetainerCharge[]> {
    const held = await this.liveInvoices(
      invoiceLines.retainerChargeId,
      charges.map((charge) => charge.id),
    );
    return charges.map((charge) => ({ ...charge, invoice: held.get(charge.id) ?? null }));
  }

  async presentExpenses(rows: ExpenseRow[]): Promise<ProjectExpense[]> {
    const people = await this.users.summaries(rows.map((row) => row.loggedById));
    return rows.map((row) => ({
      id: row.id,
      spentOn: row.spentOn,
      description: row.description,
      amountMinor: row.amountMinor,
      currency: row.currency,
      sypPerUsd: row.sypPerUsd,
      note: row.note,
      usdMinor: toUsdMinor(row.amountMinor, row.currency, row.sypPerUsd),
      loggedBy: { id: row.loggedById, name: people.get(row.loggedById)?.name ?? '' },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  /** A client whose invoices the actor may read, else 404 (archived clients included). */
  private async readableClient(actor: CurrentUserInfo, clientId: string): Promise<ClientSummary> {
    const client = await this.clients.summary(clientId);
    if (!client || !covers(actor, 'invoices.read', client)) throw new NotFoundException();
    return client;
  }

  /** The live invoice (not void, not discarded) holding each source in `column`, by source id. */
  private async liveInvoices(column: PgColumn, ids: string[]): Promise<Map<string, SourceInvoice>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({
        sourceId: column,
        id: invoices.id,
        year: invoices.year,
        number: invoices.number,
        status: invoices.status,
      })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
      .where(and(invoiceLines.holdsSource, inArray(column, ids), ne(invoices.status, 'void')));
    return new Map(
      rows.map((row) => [
        row.sourceId as string,
        {
          id: row.id,
          displayNumber:
            row.year && row.number
              ? invoiceDisplayNumber({ year: row.year, number: row.number })
              : null,
          status: row.status,
        },
      ]),
    );
  }
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
