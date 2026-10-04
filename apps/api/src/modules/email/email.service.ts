import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  addDays,
  businessInstant,
  EMAIL_LIMITS,
  EMAIL_PURGE_JOB,
  EMAIL_RESULT_JOB,
  type EmailAddress,
  type EmailListQuery,
  type EmailLogItem,
  type EmailPage,
  type EmailResultJob,
  type EmailSummary,
  emailResultJobSchema,
  STAFF_EMAIL_RETENTION_DAYS,
} from '@vertex-hub/contracts';
import { type Database, emailMessages } from '@vertex-hub/db';
import { testEmail } from '@vertex-hub/messages';
import { and, count, desc, eq, gte, inArray, lt, type SQL, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { JobQueue } from '../../core/jobs/index.js';
import type { EmailSender } from './email-sender.decorator.js';
import { Mailer } from './mailer.js';

type EmailRow = typeof emailMessages.$inferSelect;

/** The email log, the test email, and the `email.result` and `email.purge` jobs (ADR 0028). */
@Injectable()
export class EmailService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly mailer: Mailer,
    private readonly jobs: JobQueue,
  ) {}

  onModuleInit(): void {
    this.jobs.work(EMAIL_RESULT_JOB.queue, (data) =>
      this.recordResult(emailResultJobSchema.parse(data)),
    );
    this.jobs.work(EMAIL_PURGE_JOB.queue, async () => {
      await this.purge();
    });
  }

  /** Screen 6: the outbox, newest first. Never the content of an email beyond its subject. */
  async list(query: EmailListQuery): Promise<EmailPage> {
    const filters: SQL[] = [];
    if (query.status) filters.push(inArray(emailMessages.status, query.status));
    if (query.audience) filters.push(eq(emailMessages.audience, query.audience));
    if (query.kind) filters.push(inArray(emailMessages.kind, query.kind));
    if (query.from) {
      filters.push(gte(emailMessages.createdAt, businessInstant(query.from, '00:00')));
    }
    if (query.to) {
      filters.push(lt(emailMessages.createdAt, businessInstant(addDays(query.to, 1), '00:00')));
    }
    if (query.search) {
      const pattern = `%${query.search.replace(/[\\%_]/g, '\\$&')}%`;
      filters.push(
        sql`exists (select 1 from jsonb_array_elements(${emailMessages.to} || ${emailMessages.cc}) as r
          where r->>'email' ilike ${pattern} or r->>'name' ilike ${pattern})`,
      );
    }
    const where = and(...filters);
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(emailMessages)
        .where(where)
        .orderBy(desc(emailMessages.createdAt), desc(emailMessages.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ value: count() }).from(emailMessages).where(where),
    ]);
    return {
      items: rows.map(logItem),
      total: total?.value ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Rule 26: a test email to the administrator's own address. */
  async sendTest(sender: EmailSender): Promise<EmailSummary> {
    const data = { requestedBy: sender.name };
    const id = await this.db.transaction((tx) =>
      this.mailer.queue(tx, {
        kind: 'test',
        to: [{ name: sender.name, email: sender.email, userId: sender.id }],
        subject: testEmail(data).subject,
        data,
        sender: { id: sender.id, name: sender.name },
      }),
    );
    return this.summary(id);
  }

  async summary(id: string): Promise<EmailSummary> {
    const [row] = await this.db.select().from(emailMessages).where(eq(emailMessages.id, id));
    if (!row) throw new Error(`Email ${id} not found`);
    return emailSummary(row);
  }

  /**
   * Rule 1: the worker's outcome. Only a `queued` email changes, so a repeated result is a no-op
   * and nothing moves an email back.
   */
  async recordResult(result: EmailResultJob): Promise<void> {
    await this.db
      .update(emailMessages)
      .set(
        result.status === 'sent'
          ? {
              status: 'sent',
              attempts: result.attempts,
              sentAt: new Date(result.sentAt),
              providerMessageId: result.providerMessageId,
            }
          : {
              status: 'failed',
              attempts: result.attempts,
              lastError: result.error.slice(0, EMAIL_LIMITS.error),
            },
      )
      .where(and(eq(emailMessages.id, result.id), eq(emailMessages.status, 'queued')));
  }

  /** Rule 25: deletes staff emails created more than 90 days ago; client emails are kept. */
  async purge(now = new Date()): Promise<number> {
    const before = new Date(now.getTime() - STAFF_EMAIL_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const deleted = await this.db
      .delete(emailMessages)
      .where(and(eq(emailMessages.audience, 'staff'), lt(emailMessages.createdAt, before)))
      .returning({ id: emailMessages.id });
    return deleted.length;
  }
}

function emailSummary(row: EmailRow): EmailSummary {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    // Written only by `Mailer.queue`, which validates them.
    to: row.to as EmailAddress[],
    cc: row.cc as EmailAddress[],
    subject: row.subject,
    sender: row.senderId && row.senderName ? { id: row.senderId, name: row.senderName } : null,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
    error: row.lastError,
  };
}

function logItem(row: EmailRow): EmailLogItem {
  return {
    ...emailSummary(row),
    audience: row.audience,
    attempts: row.attempts,
    record: row.recordType && row.recordId ? { type: row.recordType, id: row.recordId } : null,
    clientId: row.clientId,
  };
}
