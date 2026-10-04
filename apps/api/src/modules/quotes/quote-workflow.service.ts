import { Inject, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import {
  addDays,
  businessDate,
  type ExtendQuote,
  installmentsValid,
  needsDiscountApproval,
  QUOTE_LIMITS,
  QUOTES_DAILY_JOB,
  type QuoteApprovalAction,
  type QuoteApprovalDecision,
  type QuoteDetail,
  quoteDisplayNumber,
  quoteValidUntil,
  type RejectQuote,
  type SendQuote,
} from '@vertex-hub/contracts';
import { type Database, quotes, type Transaction } from '@vertex-hub/db';
import { and, asc, eq, inArray, isNull, lt, ne } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { JobQueue, runEach } from '../../core/jobs/index.js';
import { recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { LeadPipeline } from '../leads/index.js';
import { NotificationCenter } from '../notifications/index.js';
import {
  actorOf,
  approvesDiscounts,
  archivedError,
  assertTakesQuotes,
  type Recipient,
  snapshotParty,
} from './quote-access.js';
import { QuotePdfService } from './quote-pdf.service.js';
import { QuoteRecipients } from './quote-recipients.js';
import {
  buildSnapshot,
  identity,
  NO_DRAFT_PDF,
  type QuoteChildren,
  type QuoteRow,
  quoteChildren,
  totalsOf,
} from './quote-records.js';
import { QuoteSettingsService } from './quote-settings.service.js';
import { QuotesService } from './quotes.service.js';

/** Quote states (F04): discount approval, send, extend, reject and the daily expiry. */
@Injectable()
export class QuoteWorkflowService implements OnModuleInit {
  private readonly logger = new Logger(QuoteWorkflowService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly quotes: QuotesService,
    private readonly settings: QuoteSettingsService,
    private readonly clients: ClientDirectory,
    private readonly users: UserDirectory,
    private readonly notifications: NotificationCenter,
    private readonly jobs: JobQueue,
    private readonly pdf: QuotePdfService,
    private readonly leadPipeline: LeadPipeline,
    private readonly recipients: QuoteRecipients,
  ) {}

  onModuleInit(): void {
    this.jobs.work(QUOTES_DAILY_JOB.queue, async () => {
      const expired = await this.runDaily();
      const requeued = await this.pdf.requeuePending();
      this.logger.log(`Quotes: ${expired} expired, ${requeued} PDFs queued again`);
    });
  }

  /** Rule 7: asks the General Managers to approve the discount, or withdraws the request. */
  async approval(
    actor: CurrentUserInfo,
    id: string,
    input: QuoteApprovalAction,
  ): Promise<QuoteDetail> {
    return this.db.transaction(async (tx) => {
      const { quote, recipient: client } = await this.quotes.lockForChange(tx, actor, id);
      if (quote.archivedAt || quote.status !== 'draft') {
        throw new CodedException(409, 'QUOTE_LOCKED', 'Only a draft asks for approval');
      }
      if (input.action === 'withdraw') {
        if (quote.discountApproval !== 'pending') {
          throw new CodedException(409, 'INVALID_TRANSITION', 'No approval is pending');
        }
        const updated = await this.setApproval(tx, quote, { discountApproval: 'none' });
        await this.audit(tx, actor, quote, 'quote.approval_withdrawn', {
          discountApproval: 'none',
        });
        return this.quotes.toDetail(actor, updated, client, tx);
      }
      if (!['none', 'returned'].includes(quote.discountApproval)) {
        throw new CodedException(409, 'INVALID_TRANSITION', 'Approval is pending or given');
      }
      const children = await this.children(tx, quote);
      const { discountThresholdPercent } = await this.settings.row(tx);
      if (!needsDiscountApproval(totalsOf(quote, children), discountThresholdPercent)) {
        throw new CodedException(409, 'APPROVAL_NOT_NEEDED', 'The discount is below the threshold');
      }
      const updated = await this.setApproval(tx, quote, {
        discountApproval: 'pending',
        discountRequestedById: actor.id,
      });
      await this.audit(tx, actor, quote, 'quote.approval_requested', {
        discountApproval: 'pending',
      });
      await this.notifications.notify(tx, {
        type: 'quote_approval_requested',
        data: { quote: noticeOf(quote, client) },
        recipients: await this.users.withRole('general_manager', tx),
        actorId: actor.id,
        subjectId: quote.id,
      });
      return this.quotes.toDetail(actor, updated, client, tx);
    });
  }

  /** Rule 7: the General Manager approves the discount or returns it with a note. */
  async decide(
    actor: CurrentUserInfo,
    id: string,
    input: QuoteApprovalDecision,
  ): Promise<QuoteDetail> {
    return this.db.transaction(async (tx) => {
      const [quote] = await tx.select().from(quotes).where(eq(quotes.id, id)).for('update');
      const client = quote ? await this.recipients.of(quote, tx) : null;
      if (!quote || !client) throw new NotFoundException();
      if (client.archived) throw archivedError(client);
      if (quote.archivedAt || quote.status !== 'draft' || quote.discountApproval !== 'pending') {
        throw new CodedException(409, 'INVALID_TRANSITION', 'No approval is pending');
      }
      const approved = input.decision === 'approve';
      const updated = await this.setApproval(tx, quote, {
        discountApproval: approved ? 'approved' : 'returned',
        discountDecidedById: actor.id,
        discountDecidedAt: new Date(),
        discountNote: input.note,
      });
      await this.audit(
        tx,
        actor,
        quote,
        approved ? 'quote.approval_approved' : 'quote.approval_returned',
        { discountApproval: updated.discountApproval, ...(input.note ? { note: input.note } : {}) },
      );
      if (quote.discountRequestedById) {
        await this.notifications.notify(tx, {
          type: 'quote_approval_decided',
          data: { quote: noticeOf(quote, client), decision: input.decision, note: input.note },
          recipients: [quote.discountRequestedById],
          actorId: actor.id,
          subjectId: quote.id,
        });
      }
      return this.quotes.toDetail(actor, updated, client, tx);
    });
  }

  /**
   * Rule 6: checks the draft, freezes its snapshot, starts its validity and supersedes the
   * previous sent or expired version. A sender who approves discounts approves by sending.
   */
  async send(actor: CurrentUserInfo, id: string, input: SendQuote): Promise<QuoteDetail> {
    const { detail, sent, previewKey } = await this.db.transaction(async (tx) => {
      const { quote, recipient: client } = await this.quotes.lockForChange(tx, actor, id);
      if (quote.archivedAt || quote.status !== 'draft') {
        throw new CodedException(409, 'INVALID_TRANSITION', 'Only a draft is sent');
      }
      if (quote.discountApproval === 'pending') {
        throw new CodedException(409, 'APPROVAL_PENDING', 'The discount awaits approval');
      }
      assertTakesQuotes(client);
      const children = await this.children(tx, quote);
      if (children.lines.length === 0) {
        throw new CodedException(409, 'QUOTE_EMPTY', 'A quote needs a line');
      }
      const hasOneOff = children.lines.some((line) => line.section === 'one_off');
      if (!installmentsValid(children.installments, hasOneOff, { draft: false })) {
        throw new CodedException(409, 'INVALID_INSTALLMENTS', 'The installments are not valid');
      }
      if (!input.confirmZeroPrice && children.lines.some((line) => line.unitPriceMinor === 0)) {
        throw new CodedException(409, 'ZERO_PRICE', 'Some lines are priced 0');
      }
      const settings = await this.settings.row(tx);
      const totals = totalsOf(quote, children);
      const needsApproval = needsDiscountApproval(totals, settings.discountThresholdPercent);
      let approval: Partial<QuoteRow> = {};
      if (needsApproval && quote.discountApproval !== 'approved') {
        if (!approvesDiscounts(actor)) {
          throw new CodedException(
            409,
            'DISCOUNT_APPROVAL_REQUIRED',
            'The discount needs approval',
          );
        }
        approval = {
          discountApproval: 'approved',
          discountDecidedById: actor.id,
          discountDecidedAt: new Date(),
          discountNote: null,
        };
        await this.audit(tx, actor, quote, 'quote.approval_approved', {
          discountApproval: 'approved',
        });
      }
      const sentOn = businessDate();
      const validUntil = quoteValidUntil(sentOn, quote.validityDays);
      const contacts = await this.clients.contactSummaries(
        quote.contactId ? [quote.contactId] : [],
        tx,
      );
      const snapshot = buildSnapshot(quote, children, {
        companyDetails: settings.companyDetails,
        ...snapshotParty(
          client,
          quote.contactId ? (contacts.get(quote.contactId)?.name ?? null) : null,
        ),
        sentOn,
        validUntil,
      });
      const [updated] = await tx
        .update(quotes)
        .set({
          ...approval,
          status: 'sent',
          sentAt: new Date(),
          sentById: actor.id,
          validUntil,
          snapshot,
          // Rule 12: the PDF is queued once committed; rule 13: the draft preview is discarded.
          pdfStatus: 'pending',
          ...NO_DRAFT_PDF,
          updatedAt: new Date(),
        })
        .where(eq(quotes.id, id))
        .returning();
      if (!updated) throw new Error('The quote was not sent');
      await this.audit(tx, actor, quote, 'quote.sent', { status: 'sent', validUntil });
      const previous = await tx
        .select()
        .from(quotes)
        .where(
          and(
            eq(quotes.year, quote.year),
            eq(quotes.number, quote.number),
            ne(quotes.id, quote.id),
            inArray(quotes.status, ['sent', 'expired']),
          ),
        )
        .for('update');
      for (const older of previous) {
        await tx
          .update(quotes)
          .set({ status: 'superseded', updatedAt: new Date() })
          .where(eq(quotes.id, older.id));
        await recordAudit(tx, {
          actor: actorOf(actor),
          action: 'quote.superseded',
          entityType: 'quote',
          entityId: older.id,
          before: { ...identity(older), status: older.status },
          after: { ...identity(older), status: 'superseded', byQuoteId: quote.id },
        });
      }
      // F03 rule 14: sending a lead quote moves the lead to Quote sent.
      if (client.kind === 'lead') {
        await this.leadPipeline.markQuoteSent(tx, actorOf(actor), client.id, {
          id: quote.id,
          displayNumber: quoteDisplayNumber(quote),
        });
      }
      const detail = await this.quotes.toDetail(actor, updated, client, tx);
      return { detail, sent: updated, previewKey: quote.draftPdfObjectKey };
    });
    await this.pdf.queueSent(sent);
    await this.pdf.discardPreview(previewKey);
    return detail;
  }

  /** Rule 10: an expired quote is sent again until a new last valid day. */
  async extend(actor: CurrentUserInfo, id: string, input: ExtendQuote): Promise<QuoteDetail> {
    return this.db.transaction(async (tx) => {
      const { quote, recipient: client } = await this.quotes.lockForChange(tx, actor, id);
      if (quote.archivedAt || quote.status !== 'expired') {
        throw new CodedException(409, 'INVALID_TRANSITION', 'Only an expired quote is extended');
      }
      const today = businessDate();
      if (
        input.validUntil < today ||
        input.validUntil > addDays(today, QUOTE_LIMITS.validityDays)
      ) {
        throw new CodedException(400, 'INVALID_DATES', 'Valid from today up to 90 days');
      }
      const [updated] = await tx
        .update(quotes)
        .set({ status: 'sent', validUntil: input.validUntil, updatedAt: new Date() })
        .where(eq(quotes.id, id))
        .returning();
      if (!updated) throw new Error('The quote was not extended');
      // F03 rule 14: sent again, the lead is back in Quote sent.
      if (client.kind === 'lead') {
        await this.leadPipeline.markQuoteSent(tx, actorOf(actor), client.id, {
          id: quote.id,
          displayNumber: quoteDisplayNumber(quote),
        });
      }
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'quote.extended',
        entityType: 'quote',
        entityId: id,
        before: { ...identity(quote), status: quote.status, validUntil: quote.validUntil },
        after: { ...identity(quote), status: 'sent', validUntil: input.validUntil },
      });
      return this.quotes.toDetail(actor, updated, client, tx);
    });
  }

  /** Rule 11: the client's no, final. */
  async reject(actor: CurrentUserInfo, id: string, input: RejectQuote): Promise<QuoteDetail> {
    return this.db.transaction(async (tx) => {
      const { quote, recipient: client } = await this.quotes.lockForChange(tx, actor, id);
      if (quote.archivedAt || !['sent', 'expired'].includes(quote.status)) {
        throw new CodedException(409, 'INVALID_TRANSITION', 'Only a sent or expired quote');
      }
      const sentOn = quote.sentAt ? businessDate(quote.sentAt) : businessDate();
      if (input.respondedOn > businessDate() || input.respondedOn < sentOn) {
        throw new CodedException(400, 'INVALID_DATES', 'From the sent day to today');
      }
      if (
        input.contactId &&
        (client.kind !== 'client' ||
          !(await this.clients.isActiveContact(client.id, input.contactId, tx)))
      ) {
        throw new CodedException(400, 'UNKNOWN_CONTACT', 'Not a contact of the client');
      }
      if (input.reason === 'other' && !input.note) {
        throw new CodedException(400, 'NOTE_REQUIRED', 'Another reason needs a note');
      }
      const [updated] = await tx
        .update(quotes)
        .set({
          status: 'rejected',
          respondedOn: input.respondedOn,
          responseContactId: input.contactId,
          responseNote: input.note,
          respondedById: actor.id,
          rejectionReason: input.reason,
          updatedAt: new Date(),
        })
        .where(eq(quotes.id, id))
        .returning();
      if (!updated) throw new Error('The quote was not rejected');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'quote.rejected',
        entityType: 'quote',
        entityId: id,
        before: { ...identity(quote), status: quote.status },
        after: {
          ...identity(quote),
          status: 'rejected',
          reason: input.reason,
          respondedOn: input.respondedOn,
          contactId: input.contactId,
          ...(input.note ? { note: input.note } : {}),
        },
      });
      return this.quotes.toDetail(actor, updated, client, tx);
    });
  }

  /**
   * Rule 9: expires every sent quote whose last valid day is before `today`, archived clients'
   * too (G2). Idempotent; one quote failing does not hold back the others.
   */
  async runDaily(today: string = businessDate()): Promise<number> {
    const due = await this.db
      .select({ id: quotes.id })
      .from(quotes)
      .where(
        and(eq(quotes.status, 'sent'), lt(quotes.validUntil, today), isNull(quotes.archivedAt)),
      )
      .orderBy(asc(quotes.id));
    let expired = 0;
    await runEach(
      due,
      this.logger,
      ({ id }) => `Quote ${id}`,
      async ({ id }) => {
        await this.db.transaction(async (tx) => {
          const [quote] = await tx.select().from(quotes).where(eq(quotes.id, id)).for('update');
          if (quote?.status !== 'sent' || !quote.validUntil || quote.validUntil >= today) {
            return;
          }
          await tx
            .update(quotes)
            .set({ status: 'expired', updatedAt: new Date() })
            .where(eq(quotes.id, id));
          await recordAudit(tx, {
            actor: null,
            action: 'quote.expired',
            entityType: 'quote',
            entityId: id,
            before: { ...identity(quote), status: 'sent' },
            after: { ...identity(quote), status: 'expired' },
          });
          expired += 1;
        });
      },
    );
    return expired;
  }

  private async children(tx: Transaction, quote: QuoteRow): Promise<QuoteChildren> {
    return (await quoteChildren(tx, [quote.id])).get(quote.id) ?? { lines: [], installments: [] };
  }

  private async setApproval(
    tx: Transaction,
    quote: QuoteRow,
    fields: Partial<QuoteRow>,
  ): Promise<QuoteRow> {
    const [updated] = await tx
      .update(quotes)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(quotes.id, quote.id))
      .returning();
    if (!updated) throw new Error('The quote was not updated');
    return updated;
  }

  private async audit(
    tx: Transaction,
    actor: CurrentUserInfo,
    quote: QuoteRow,
    action:
      | 'quote.approval_requested'
      | 'quote.approval_withdrawn'
      | 'quote.approval_approved'
      | 'quote.approval_returned'
      | 'quote.sent',
    after: Record<string, unknown>,
  ): Promise<void> {
    const before = Object.fromEntries(
      Object.keys(after)
        .filter((key) => key in quote)
        .map((key) => [key, quote[key as keyof QuoteRow]]),
    );
    await recordAudit(tx, {
      actor: actorOf(actor),
      action,
      entityType: 'quote',
      entityId: quote.id,
      before: { ...identity(quote), ...before },
      after: { ...identity(quote), ...after },
    });
  }
}

const noticeOf = (quote: QuoteRow, client: Recipient) => ({
  displayNumber: quoteDisplayNumber(quote),
  title: quote.title,
  client: client.name,
});
