import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  businessDate,
  type CreateLeadNote,
  type LeadNote,
  type UpdateLeadNote,
} from '@vertex-hub/contracts';
import { type Database, leadNotes, leads, type Transaction } from '@vertex-hub/db';
import { and, eq, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { changedFields, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { actorOf, holdsAll } from './lead-access.js';
import {
  assertChangeable,
  assertFollowUp,
  identity,
  type LeadRow,
  LeadsService,
  noteOf,
} from './leads.service.js';

type LeadNoteRow = typeof leadNotes.$inferSelect;

const noteFields = (note: Pick<LeadNoteRow, 'occurredAt' | 'channel' | 'summary'>) => ({
  occurredAt: note.occurredAt.toISOString(),
  channel: note.channel,
  summary: note.summary,
});

/**
 * The lead's activity log (spec F03 rule 4): logging an activity on an open lead sets its next
 * follow-up date in the same transaction. Notes are edited by their author and archived by their
 * author or a lead manager with scope all, while the lead is open.
 */
@Injectable()
export class LeadNotesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly leads: LeadsService,
    private readonly users: UserDirectory,
  ) {}

  async create(actor: CurrentUserInfo, leadId: string, input: CreateLeadNote): Promise<LeadNote> {
    const today = businessDate();
    return this.db.transaction(async (tx) => {
      const lead = await this.leads.lockForChange(tx, actor, leadId);
      assertChangeable(lead);
      assertFollowUp(input.nextFollowUpOn, today);
      const [note] = await tx
        .insert(leadNotes)
        .values({
          leadId,
          authorId: actor.id,
          channel: input.channel,
          summary: input.summary,
          ...(input.occurredAt ? { occurredAt: new Date(input.occurredAt) } : {}),
        })
        .returning();
      if (!note) throw new Error('The note was not created');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'lead_note.created',
        entityType: 'lead_note',
        entityId: note.id,
        after: { leadId, ...identity(lead), ...noteFields(note) },
      });
      if (input.nextFollowUpOn !== lead.nextFollowUpOn) {
        await tx
          .update(leads)
          .set({ nextFollowUpOn: input.nextFollowUpOn, updatedAt: new Date() })
          .where(eq(leads.id, leadId));
        await recordAudit(tx, {
          actor: actorOf(actor),
          action: 'lead.follow_up_changed',
          entityType: 'lead',
          entityId: leadId,
          before: { ...identity(lead), nextFollowUpOn: lead.nextFollowUpOn },
          after: { ...identity(lead), nextFollowUpOn: input.nextFollowUpOn },
        });
      }
      return noteOf(actor, lead, note, { id: actor.id, name: actor.name });
    });
  }

  /** The author only. */
  async update(
    actor: CurrentUserInfo,
    leadId: string,
    noteId: string,
    input: UpdateLeadNote,
  ): Promise<LeadNote> {
    return this.db.transaction(async (tx) => {
      const { lead, note } = await this.lockNote(tx, actor, leadId, noteId);
      if (note.authorId !== actor.id) throw new ForbiddenException();
      const next = {
        occurredAt: input.occurredAt ?? note.occurredAt.toISOString(),
        channel: input.channel ?? note.channel,
        summary: input.summary ?? note.summary,
      };
      const changes = changedFields(noteFields(note), {
        ...next,
        occurredAt: new Date(next.occurredAt).toISOString(),
      });
      if (!changes) return this.present(actor, lead, note, tx);
      const [updated] = await tx
        .update(leadNotes)
        .set({
          occurredAt: new Date(next.occurredAt),
          channel: next.channel,
          summary: next.summary,
          updatedAt: new Date(),
        })
        .where(eq(leadNotes.id, noteId))
        .returning();
      if (!updated) throw new NotFoundException();
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'lead_note.updated',
        entityType: 'lead_note',
        entityId: noteId,
        before: { leadId, ...identity(lead), ...changes.before },
        after: { leadId, ...identity(lead), ...changes.after },
      });
      return this.present(actor, lead, updated, tx);
    });
  }

  /** The author, or a lead manager with scope all. */
  async archive(actor: CurrentUserInfo, leadId: string, noteId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const { lead, note } = await this.lockNote(tx, actor, leadId, noteId);
      if (note.authorId !== actor.id && !holdsAll(actor, 'leads.manage')) {
        throw new ForbiddenException();
      }
      await tx.update(leadNotes).set({ archivedAt: new Date() }).where(eq(leadNotes.id, noteId));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'lead_note.archived',
        entityType: 'lead_note',
        entityId: noteId,
        before: { leadId, ...identity(lead), archived: false },
        after: { leadId, ...identity(lead), archived: true },
      });
    });
  }

  /** A non-archived note of an open, non-archived lead the caller manages. */
  private async lockNote(tx: Transaction, actor: CurrentUserInfo, leadId: string, noteId: string) {
    const lead = await this.leads.lockForChange(tx, actor, leadId);
    const [note] = await tx
      .select()
      .from(leadNotes)
      .where(
        and(eq(leadNotes.id, noteId), eq(leadNotes.leadId, leadId), isNull(leadNotes.archivedAt)),
      );
    if (!note) throw new NotFoundException();
    assertChangeable(lead);
    return { lead, note };
  }

  private async present(
    actor: CurrentUserInfo,
    lead: LeadRow,
    note: LeadNoteRow,
    executor: Database | Transaction,
  ): Promise<LeadNote> {
    const author = (await this.users.summaries([note.authorId], executor)).get(note.authorId);
    return noteOf(actor, lead, note, { id: note.authorId, name: author?.name ?? '' });
  }
}
