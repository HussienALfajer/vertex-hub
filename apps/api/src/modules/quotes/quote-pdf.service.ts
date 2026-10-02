import type { IncomingMessage, ServerResponse } from 'node:http';
import { Inject, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import {
  QUOTES_PDF_JOB,
  QUOTES_PDF_READY_JOB,
  type QuotePdfJob,
  type QuotePdfReadyJob,
  type QuotePdfRender,
  quotePdfReadyJobSchema,
  quoteSnapshotSchema,
} from '@vertex-hub/contracts';
import { type Database, quotes, type Transaction } from '@vertex-hub/db';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { JobQueue } from '../../core/jobs/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientDirectory, type ClientSummary } from '../clients/index.js';
import { GeneratedFiles } from '../files/index.js';
import { assertCanManage, canRead } from './quote-access.js';
import {
  draftSnapshot,
  pdfFileName,
  type QuoteRow,
  quoteChildren,
  renderHash,
} from './quote-records.js';
import { QuoteSettingsService } from './quote-settings.service.js';

const PDF_MIME_TYPE = 'application/pdf';

// PDF state is not an edit: every update keeps `updated_at`, so the builder's next save is not
// refused as stale (edge case 1).

/**
 * Quote PDFs (spec F04 rules 12 and 13): queues renders for the worker, takes their results
 * (`quotes.pdf-ready`), and serves the PDF of a sent version or the draft preview.
 */
@Injectable()
export class QuotePdfService implements OnModuleInit {
  private readonly logger = new Logger(QuotePdfService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly settings: QuoteSettingsService,
    private readonly clients: ClientDirectory,
    private readonly files: GeneratedFiles,
    private readonly jobs: JobQueue,
  ) {}

  onModuleInit(): void {
    this.jobs.work(QUOTES_PDF_READY_JOB.queue, (data) =>
      this.ready(quotePdfReadyJobSchema.parse(data)),
    );
  }

  /**
   * "Preview PDF" on a draft (client scope), or "Render again" on a sent version whose PDF is not
   * ready (any reader). A preview of an unchanged draft is not rendered twice.
   */
  async render(actor: CurrentUserInfo, id: string): Promise<QuotePdfRender> {
    const { state, job } = await this.db.transaction(async (tx) => {
      const [quote] = await tx.select().from(quotes).where(eq(quotes.id, id)).for('update');
      const client = quote ? await this.clients.summary(quote.clientId, tx) : null;
      if (!quote || !client || !canRead(actor, client, quote)) throw new NotFoundException();
      if (quote.status === 'draft') return this.requestPreview(tx, actor, quote, client);
      if (quote.pdfStatus === 'ready') return { state: 'ready' as const, job: null };
      await tx
        .update(quotes)
        .set({ pdfStatus: 'pending', updatedAt: quote.updatedAt })
        .where(eq(quotes.id, id));
      return { state: 'pending' as const, job: sentJob(quote) };
    });
    if (job) await this.queue(job);
    return { state };
  }

  /** Rule 12: queues the PDF of a version just sent, once its transaction committed. */
  async queueSent(quote: QuoteRow): Promise<void> {
    await this.queue(sentJob(quote));
  }

  /**
   * Edge case 13: sent versions whose render never came back (the worker or the queue was down)
   * are queued again by the daily run.
   */
  async requeuePending(): Promise<number> {
    const pending = await this.db
      .select()
      .from(quotes)
      .where(and(eq(quotes.pdfStatus, 'pending'), ne(quotes.status, 'draft')));
    for (const quote of pending) await this.queueSent(quote);
    return pending.length;
  }

  /**
   * `quotes.pdf-ready`: attaches a sent version's PDF once as a document of the quote, keeps the
   * latest asked-for draft preview (deleting the one it replaces), or records a failure. Results
   * nobody waits for any more are deleted. Safe to run twice.
   */
  async ready(result: QuotePdfReadyJob): Promise<void> {
    const removals: string[] = [];
    await this.db.transaction(async (tx) => {
      const [quote] = await tx
        .select()
        .from(quotes)
        .where(eq(quotes.id, result.quoteId))
        .for('update');
      const key = result.file?.storageKey ?? null;
      if (!quote) {
        if (key) removals.push(key);
        return;
      }
      if (result.draft) {
        const awaited =
          quote.status === 'draft' &&
          !quote.archivedAt &&
          quote.draftPdfRequestedHash === result.hash;
        if (!awaited) {
          if (key && key !== quote.draftPdfObjectKey) removals.push(key);
          return;
        }
        if (!result.file) {
          await tx
            .update(quotes)
            .set({ draftPdfStatus: 'failed', updatedAt: quote.updatedAt })
            .where(eq(quotes.id, quote.id));
          return;
        }
        if (quote.draftPdfObjectKey && quote.draftPdfObjectKey !== result.file.storageKey) {
          removals.push(quote.draftPdfObjectKey);
        }
        await tx
          .update(quotes)
          .set({
            draftPdfStatus: 'ready',
            draftPdfObjectKey: result.file.storageKey,
            draftPdfAt: new Date(),
            draftPdfHash: result.hash,
            updatedAt: quote.updatedAt,
          })
          .where(eq(quotes.id, quote.id));
        return;
      }
      // A sent version: attached once; a result of another payload is not this version's PDF.
      if (quote.status === 'draft' || quote.pdfFileItemId || !quote.snapshot) return;
      if (renderHash(quoteSnapshotSchema.parse(quote.snapshot), false) !== result.hash) {
        if (key) removals.push(key);
        return;
      }
      if (!result.file) {
        await tx
          .update(quotes)
          .set({ pdfStatus: 'failed', updatedAt: quote.updatedAt })
          .where(eq(quotes.id, quote.id));
        return;
      }
      const pdfFileItemId = await this.files.attachDocument(tx, {
        ownerType: 'quote',
        ownerId: quote.id,
        clientId: quote.clientId,
        name: pdfFileName(quote),
        storageKey: result.file.storageKey,
        mimeType: PDF_MIME_TYPE,
        sizeBytes: result.file.sizeBytes,
        sha256: result.file.sha256,
        createdById: quote.sentById ?? quote.createdById,
      });
      await tx
        .update(quotes)
        .set({ pdfStatus: 'ready', pdfFileItemId, updatedAt: quote.updatedAt })
        .where(eq(quotes.id, quote.id));
    });
    for (const key of removals) await this.removeObject(key);
  }

  /** The PDF of a sent version, or the draft preview with `draft`; 404 until it exists. */
  async serve(
    actor: CurrentUserInfo,
    id: string,
    draft: boolean,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const [quote] = await this.db.select().from(quotes).where(eq(quotes.id, id));
    const client = quote ? await this.clients.summary(quote.clientId) : null;
    if (!quote || !client || !canRead(actor, client, quote)) throw new NotFoundException();
    const name = `${client.name} - ${pdfFileName(quote)}`;
    if (draft) {
      if (
        quote.status !== 'draft' ||
        quote.draftPdfStatus !== 'ready' ||
        !quote.draftPdfObjectKey
      ) {
        throw new NotFoundException();
      }
      await this.files.serve(quote.draftPdfObjectKey, name, PDF_MIME_TYPE, request, response);
      return;
    }
    const file = quote.pdfFileItemId ? await this.files.latest(quote.pdfFileItemId) : null;
    if (!file) throw new NotFoundException();
    await this.files.serve(file.storageKey, name, file.mimeType, request, response);
  }

  /** Rule 13: deletes the preview object of a draft that was just sent or discarded. */
  async discardPreview(objectKey: string | null): Promise<void> {
    if (objectKey) await this.removeObject(objectKey);
  }

  private async requestPreview(
    tx: Transaction,
    actor: CurrentUserInfo,
    quote: QuoteRow,
    client: ClientSummary,
  ): Promise<{ state: QuotePdfRender['state']; job: QuotePdfJob | null }> {
    assertCanManage(actor, client);
    if (quote.archivedAt) {
      throw new CodedException(409, 'INVALID_TRANSITION', 'A discarded draft is not previewed');
    }
    const children = (await quoteChildren(tx, [quote.id])).get(quote.id) ?? {
      lines: [],
      installments: [],
    };
    const settings = await this.settings.row(tx);
    const contacts = await this.clients.contactSummaries(
      quote.contactId ? [quote.contactId] : [],
      tx,
    );
    const snapshot = draftSnapshot(quote, children, {
      companyDetails: settings.companyDetails,
      client: client.name,
      addressee: quote.contactId ? (contacts.get(quote.contactId)?.name ?? null) : null,
    });
    const hash = renderHash(snapshot, true);
    if (quote.draftPdfStatus === 'ready' && quote.draftPdfHash === hash) {
      return { state: 'ready', job: null };
    }
    // The previous preview stays until the new one replaces it.
    await tx
      .update(quotes)
      .set({ draftPdfStatus: 'pending', draftPdfRequestedHash: hash, updatedAt: quote.updatedAt })
      .where(and(eq(quotes.id, quote.id), isNull(quotes.archivedAt)));
    return { state: 'pending', job: { quoteId: quote.id, draft: true, hash, snapshot } };
  }

  private async queue(job: QuotePdfJob): Promise<void> {
    await this.jobs.send(QUOTES_PDF_JOB.queue, job, { retryLimit: QUOTES_PDF_JOB.retryLimit });
  }

  private async removeObject(key: string): Promise<void> {
    try {
      await this.files.remove(key);
    } catch (error) {
      this.logger.warn(`Could not delete ${key}: ${String(error)}`);
    }
  }
}

/** The render of a sent version: its frozen snapshot. */
function sentJob(quote: QuoteRow): QuotePdfJob {
  const snapshot = quoteSnapshotSchema.parse(quote.snapshot);
  return { quoteId: quote.id, draft: false, hash: renderHash(snapshot, false), snapshot };
}
