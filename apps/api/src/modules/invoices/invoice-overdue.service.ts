import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  addDays,
  businessDate,
  type CalendarDate,
  daysInclusive,
  INVOICES_DAILY_JOB,
  invoiceStatus,
} from '@vertex-hub/contracts';
import { type Database, invoices, type Transaction } from '@vertex-hub/db';
import { and, asc, eq, inArray, isNull, lt } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { JobQueue, runEach } from '../../core/jobs/index.js';
import { recordAudit } from '../audit/index.js';
import { UserDirectory } from '../auth/index.js';
import { ClientDirectory, type ClientSummary } from '../clients/index.js';
import { DailyReminders, type Notice, NotificationCenter } from '../notifications/index.js';
import { type InvoiceRow, identity } from './invoices.service.js';

/** The overdue alert repeats every this many days while the invoice stays overdue (A10). */
const REMINDER_EVERY_DAYS = 7;

/**
 * A10 (spec F13): the `invoices.daily` job marks issued invoices past their due date `overdue`
 * (rule 21) and alerts Finance, the Internal Operations manager and the account manager; the
 * `invoices-overdue` source of `notifications.daily` repeats the alert every 7 days while the
 * invoice stays overdue. `apps/worker` schedules the job; this process works it.
 */
@Injectable()
export class InvoiceOverdueService implements OnModuleInit {
  private readonly logger = new Logger(InvoiceOverdueService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly jobs: JobQueue,
    private readonly reminders: DailyReminders,
    private readonly center: NotificationCenter,
    private readonly clients: ClientDirectory,
    private readonly users: UserDirectory,
  ) {}

  onModuleInit(): void {
    this.jobs.work(INVOICES_DAILY_JOB.queue, async () => {
      const marked = await this.runDaily();
      this.logger.log(`Daily invoices: ${marked} marked overdue`);
    });
    this.reminders.register('invoices-overdue', (today) => this.remind(today));
  }

  /**
   * One transaction per invoice under its row lock; idempotent, since an invoice already overdue
   * is left alone. A run after missed days marks each past-due invoice once (edge case 14).
   */
  async runDaily(today: CalendarDate = businessDate()): Promise<number> {
    const candidates = await this.db
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(
          isNull(invoices.archivedAt),
          inArray(invoices.status, ['sent', 'partially_paid']),
          lt(invoices.dueOn, today),
        ),
      )
      .orderBy(asc(invoices.id));
    let marked = 0;
    await runEach(
      candidates,
      this.logger,
      ({ id }) => `Overdue invoice ${id}`,
      async ({ id }) => {
        const changed = await this.db.transaction(async (tx) => {
          const [invoice] = await tx
            .select()
            .from(invoices)
            .where(eq(invoices.id, id))
            .for('update');
          if (!invoice || !['sent', 'partially_paid'].includes(invoice.status)) return false;
          if (invoiceStatus({ ...invoice, today }) !== 'overdue') return false;
          const [updated] = await tx
            .update(invoices)
            .set({ status: 'overdue', updatedAt: new Date() })
            .where(eq(invoices.id, id))
            .returning();
          if (!updated) return false;
          await recordAudit(tx, {
            actor: null,
            action: 'invoice.overdue',
            entityType: 'invoice',
            entityId: id,
            before: { ...identity(invoice), status: invoice.status },
            after: { ...identity(updated), status: updated.status, dueOn: updated.dueOn },
          });
          const client = await this.clients.summary(updated.clientId, tx);
          if (client) await this.alert(tx, updated, client, today);
          return true;
        });
        if (changed) marked += 1;
      },
    );
    return marked;
  }

  /**
   * The weekly reminder: on the 8th, 15th… day overdue, keyed by that day so a rerun sends it
   * once; a missed week mark is not sent late (edge case 14).
   */
  async remind(today: CalendarDate): Promise<number> {
    const candidates = await this.db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(isNull(invoices.archivedAt), eq(invoices.status, 'overdue')))
      .orderBy(asc(invoices.id));
    let sent = 0;
    await runEach(
      candidates,
      this.logger,
      ({ id }) => `Overdue reminder ${id}`,
      async ({ id }) => {
        const recorded = await this.db.transaction(async (tx) => {
          const [invoice] = await tx
            .select()
            .from(invoices)
            .where(and(eq(invoices.id, id), eq(invoices.status, 'overdue')))
            .for('update');
          if (!invoice?.dueOn) return false;
          const weeks = Math.floor((daysOverdue(invoice.dueOn, today) - 1) / REMINDER_EVERY_DAYS);
          if (weeks < 1) return false;
          const client = await this.clients.summary(invoice.clientId, tx);
          if (!client) return false;
          return this.reminders.remindOnce(
            tx,
            {
              kind: 'invoice_overdue',
              subjectId: invoice.id,
              occurrence: addDays(invoice.dueOn, 1 + weeks * REMINDER_EVERY_DAYS),
            },
            today,
            await this.overdueNotice(tx, invoice, client, today),
          );
        });
        if (recorded) sent += 1;
      },
    );
    return sent;
  }

  /**
   * The first `invoice_overdue` alert, sent when the invoice becomes overdue: by this job, or by
   * a payment change that recomputes its status (rule 21).
   */
  async alert(
    tx: Transaction,
    invoice: InvoiceRow,
    client: ClientSummary,
    today: CalendarDate,
  ): Promise<void> {
    await this.center.notify(tx, await this.overdueNotice(tx, invoice, client, today));
  }

  /** Users with the Finance role, the Internal Operations manager(s) and the account manager. */
  private async overdueNotice(
    tx: Transaction,
    invoice: InvoiceRow,
    client: ClientSummary,
    today: CalendarDate,
  ): Promise<Notice> {
    const finance = await this.users.withRole('finance', tx);
    const managers = await this.users.departmentManagers(['internal_operations'], tx);
    return {
      type: 'invoice_overdue',
      recipients: [
        ...finance,
        ...(managers.get('internal_operations') ?? []),
        client.accountManagerId,
      ],
      actorId: null,
      subjectId: invoice.id,
      data: {
        invoice: { displayNumber: identity(invoice).number ?? '', client: client.name },
        daysOverdue: Math.max(1, daysOverdue(invoice.dueOn ?? today, today)),
      },
    };
  }
}

/** Whole days after the due date. */
const daysOverdue = (dueOn: CalendarDate, today: CalendarDate) => daysInclusive(dueOn, today) - 1;
