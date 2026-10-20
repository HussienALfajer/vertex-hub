import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  addDays,
  type CalendarDate,
  type NotificationResolution,
  quoteDisplayNumber,
} from '@vertex-hub/contracts';
import { type Database, quotes, type Transaction } from '@vertex-hub/db';
import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { runEach } from '../../core/jobs/index.js';
import { UserDirectory } from '../auth/index.js';
import { DailyReminders, NotificationCenter, type Resolution } from '../notifications/index.js';
import type { Recipient } from './quote-access.js';
import { QuoteRecipients } from './quote-recipients.js';
import type { QuoteRow } from './quote-records.js';

/** Part C rule 3: `quote_expiring` is sent this many days before the last valid day, or later. */
const EXPIRING_DAYS = 3;

/** The quote as its notices snapshot it. */
export const quoteNotice = (quote: QuoteRow, recipient: Pick<Recipient, 'name'>) => ({
  displayNumber: quoteDisplayNumber(quote),
  title: quote.title,
  client: recipient.name,
});

/** F16 part C: what closes a quote's `quote_expiring`. */
export const expiringClosed = (
  quoteId: string,
  outcome: NotificationResolution,
  actorId: string | null,
): Resolution => ({
  subject: { type: 'quote', id: quoteId },
  types: ['quote_expiring'],
  outcome,
  actorId,
});

/**
 * F16 part C: the quote notices of the sales modules. The account manager (a lead quote's owner)
 * and the quote's creator hear that it is expiring, expired or rejected; the General Managers
 * hear of rejections too. `quote_expiring` is a source of the `notifications.daily` job.
 */
@Injectable()
export class QuoteNotices implements OnModuleInit {
  private readonly logger = new Logger(QuoteNotices.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly center: NotificationCenter,
    private readonly recipients: QuoteRecipients,
    private readonly reminders: DailyReminders,
  ) {}

  onModuleInit(): void {
    this.reminders.register('quote-expiring', (today) => this.remindExpiring(today));
  }

  /** The client's no was recorded, or the lead was lost (F03 rule 8). */
  async rejected(
    tx: Transaction,
    quote: QuoteRow,
    recipient: Pick<Recipient, 'name' | 'accountManagerId'>,
    actorId: string,
  ): Promise<void> {
    const managers = await this.users.withRole('general_manager', tx);
    await this.center.notify(
      tx,
      {
        type: 'quote_rejected',
        data: { quote: quoteNotice(quote, recipient) },
        recipients: [recipient.accountManagerId, quote.createdById, ...managers],
        actorId,
        subjectId: quote.id,
      },
      [expiringClosed(quote.id, 'done', actorId)],
    );
  }

  /** F04 rule 9: the daily job expired the quote. */
  async expired(tx: Transaction, quote: QuoteRow): Promise<void> {
    const recipient = await this.recipients.of(quote, tx);
    if (!recipient) return;
    await this.center.notify(
      tx,
      {
        type: 'quote_expired',
        data: { quote: quoteNotice(quote, recipient) },
        recipients: [recipient.accountManagerId, quote.createdById],
        actorId: null,
        subjectId: quote.id,
      },
      [expiringClosed(quote.id, 'void', null)],
    );
  }

  /** Accepted or extended: the reminder is done. */
  resolveExpiring(tx: Transaction, quoteId: string, actorId: string): Promise<number> {
    return this.center.resolve(tx, expiringClosed(quoteId, 'done', actorId));
  }

  /**
   * Part C rule 3: once per quote and last valid day, a sent quote valid until three days from
   * today or sooner, and still valid; archived ones are skipped.
   */
  async remindExpiring(today: CalendarDate): Promise<number> {
    const due = and(
      eq(quotes.status, 'sent'),
      isNull(quotes.archivedAt),
      gte(quotes.validUntil, today),
      lte(quotes.validUntil, addDays(today, EXPIRING_DAYS)),
    );
    const candidates = await this.db
      .select({ id: quotes.id })
      .from(quotes)
      .where(due)
      .orderBy(asc(quotes.id));
    let sent = 0;
    await runEach(
      candidates,
      this.logger,
      ({ id }) => `Quote expiring reminder ${id}`,
      async ({ id }) => {
        // Read again under the lock, so a quote answered since the candidates were read is left.
        const recorded = await this.db.transaction(async (tx) => {
          const [quote] = await tx
            .select()
            .from(quotes)
            .where(and(eq(quotes.id, id), due))
            .for('update');
          const recipient = quote && (await this.recipients.of(quote, tx));
          if (!quote?.validUntil || !recipient) return false;
          return this.reminders.remindOnce(
            tx,
            { kind: 'quote_expiring', subjectId: quote.id, occurrence: quote.validUntil },
            today,
            {
              type: 'quote_expiring',
              data: { quote: quoteNotice(quote, recipient), validUntil: quote.validUntil },
              recipients: [recipient.accountManagerId, quote.createdById],
              actorId: null,
              subjectId: quote.id,
            },
          );
        });
        if (recorded) sent += 1;
      },
    );
    return sent;
  }
}
