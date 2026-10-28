import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  addDays,
  type CalendarDate,
  type InvoiceOrigin,
  invoiceDisplayNumber,
  type NotificationResolution,
} from '@vertex-hub/contracts';
import { type Database, invoices, type Transaction } from '@vertex-hub/db';
import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { runEach } from '../../core/jobs/index.js';
import { UserDirectory } from '../auth/index.js';
import { ClientDirectory, type ClientSummary } from '../clients/index.js';
import { DailyReminders, NotificationCenter } from '../notifications/index.js';
// Types only: `InvoicesService` injects this class.
import type { InvoiceRow } from './invoices.service.js';

/** Part C rule 3: `invoice_due_soon` is sent this many days before the due date, or later. */
const DUE_SOON_DAYS = 3;

/** The invoice as its notices snapshot it. */
export const invoiceNotice = (invoice: InvoiceRow, client: Pick<ClientSummary, 'name'>) => ({
  displayNumber:
    invoice.year && invoice.number
      ? invoiceDisplayNumber({ year: invoice.year, number: invoice.number })
      : '',
  client: client.name,
});

/**
 * F16 part C: the invoice notices. Finance and the Internal Operations managers hear of each
 * automatic draft until it is issued or discarded; the account manager and Finance hear of a
 * voided invoice and of an issued one due in three days, a source of `notifications.daily`.
 */
@Injectable()
export class InvoiceNotices implements OnModuleInit {
  private readonly logger = new Logger(InvoiceNotices.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
    private readonly center: NotificationCenter,
    private readonly reminders: DailyReminders,
  ) {}

  onModuleInit(): void {
    this.reminders.register('invoices-due-soon', (today) => this.remindDueSoon(today));
  }

  /** Rules 2–5: a draft its trigger created; `description` is its line's text. */
  async draftCreated(
    tx: Transaction,
    invoice: InvoiceRow,
    client: ClientSummary,
    origin: Exclude<InvoiceOrigin, 'manual'>,
    description: string,
  ): Promise<void> {
    const finance = await this.users.withRole('finance', tx);
    const managers = await this.users.functionManagers(['internal_operations'], tx);
    await this.center.notify(tx, {
      type: 'invoice_draft_created',
      recipients: [...finance, ...(managers.get('internal_operations') ?? [])],
      actorId: null,
      subjectId: invoice.id,
      data: { client: client.name, origin, description },
    });
  }

  /** Issued: `done`; discarded: `void`. */
  draftClosed(
    tx: Transaction,
    invoiceId: string,
    outcome: NotificationResolution,
    actorId: string,
  ): Promise<number> {
    return this.center.resolve(tx, {
      subject: { type: 'invoice', id: invoiceId },
      types: ['invoice_draft_created'],
      outcome,
      actorId,
    });
  }

  /** Rule 14: an issued invoice was voided; its overdue alert no longer applies. */
  async voided(
    tx: Transaction,
    invoice: InvoiceRow,
    client: ClientSummary,
    actorId: string,
  ): Promise<void> {
    await this.center.notify(
      tx,
      {
        type: 'invoice_voided',
        recipients: [client.accountManagerId, ...(await this.users.withRole('finance', tx))],
        actorId,
        subjectId: invoice.id,
        data: { invoice: invoiceNotice(invoice, client) },
      },
      [
        {
          subject: { type: 'invoice', id: invoice.id },
          types: ['invoice_overdue'],
          outcome: 'void',
          actorId,
        },
      ],
    );
  }

  /**
   * Part C rule 3: once per invoice and due date, an issued invoice not yet paid that is due today
   * or within three days; archived ones are skipped.
   */
  async remindDueSoon(today: CalendarDate): Promise<number> {
    const due = and(
      inArray(invoices.status, ['sent', 'partially_paid']),
      isNull(invoices.archivedAt),
      gte(invoices.dueOn, today),
      lte(invoices.dueOn, addDays(today, DUE_SOON_DAYS)),
    );
    const candidates = await this.db
      .select({ id: invoices.id })
      .from(invoices)
      .where(due)
      .orderBy(asc(invoices.id));
    let sent = 0;
    await runEach(
      candidates,
      this.logger,
      ({ id }) => `Invoice due soon reminder ${id}`,
      async ({ id }) => {
        // Read again under the lock, so an invoice paid since the candidates were read is left.
        const recorded = await this.db.transaction(async (tx) => {
          const [invoice] = await tx
            .select()
            .from(invoices)
            .where(and(eq(invoices.id, id), due))
            .for('update');
          if (!invoice?.dueOn) return false;
          const client = await this.clients.summary(invoice.clientId, tx);
          if (!client) return false;
          return this.reminders.remindOnce(
            tx,
            { kind: 'invoice_due_soon', subjectId: invoice.id, occurrence: invoice.dueOn },
            today,
            {
              type: 'invoice_due_soon',
              recipients: [client.accountManagerId, ...(await this.users.withRole('finance', tx))],
              actorId: null,
              subjectId: invoice.id,
              data: { invoice: invoiceNotice(invoice, client), dueOn: invoice.dueOn },
            },
          );
        });
        if (recorded) sent += 1;
      },
    );
    return sent;
  }
}
