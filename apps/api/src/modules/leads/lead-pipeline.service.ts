import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  businessDate,
  isOpenLeadStage,
  type LeadDetail,
  type LeadOwnerChange,
  type LeadStageChange,
  type LoseLead,
  type LoseLeadResult,
  leadDisplayName,
  manualLeadMoveRefusal,
  type ReopenLead,
} from '@vertex-hub/contracts';
import { type Database, leads, type Transaction } from '@vertex-hub/db';
import { eq } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, lockAccessChanges } from '../auth/index.js';
import { actorOf, holdsAll } from './lead-access.js';
import { LeadClosedHooks, LeadQuoteChecks } from './lead-closed-hooks.js';
import {
  assertChangeable,
  assertFollowUp,
  identity,
  type LeadRow,
  LeadsService,
} from './leads.service.js';

const invalidTransition = (message: string) =>
  new CodedException(409, 'INVALID_TRANSITION', message);

const assertNotArchived = (lead: LeadRow) => {
  if (lead.archivedAt) throw new CodedException(409, 'LEAD_ARCHIVED', 'The lead is archived');
};

/**
 * The pipeline actions on a lead (spec F03): manual stage moves, owner change, lose and reopen,
 * archive and restore. Each locks the lead row first (edge cases 1 and 2).
 */
@Injectable()
export class LeadPipelineService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly leads: LeadsService,
    private readonly closedHooks: LeadClosedHooks,
    private readonly quoteChecks: LeadQuoteChecks,
  ) {}

  /** Rule 5, with an optional new follow-up date (rule 3). */
  async changeStage(
    actor: CurrentUserInfo,
    id: string,
    input: LeadStageChange,
  ): Promise<LeadDetail> {
    const today = businessDate();
    return this.db.transaction(async (tx) => {
      const lead = await this.leads.lockForChange(tx, actor, id);
      assertNotArchived(lead);
      const hasSentQuote =
        lead.stage === 'quote_sent' ? await this.quoteChecks.hasSentQuote(tx, id) : false;
      const refusal = manualLeadMoveRefusal(lead.stage, input.stage, hasSentQuote);
      if (refusal === 'LEAD_HAS_SENT_QUOTE') {
        throw new CodedException(409, refusal, 'The lead has a sent quote');
      }
      if (refusal) throw invalidTransition(`A ${lead.stage} lead cannot move to ${input.stage}`);
      const nextFollowUpOn = input.nextFollowUpOn ?? lead.nextFollowUpOn;
      if (nextFollowUpOn !== lead.nextFollowUpOn && nextFollowUpOn) {
        assertFollowUp(nextFollowUpOn, today);
      }
      const [updated] = await tx
        .update(leads)
        .set({
          stage: input.stage,
          stageChangedAt: new Date(),
          nextFollowUpOn,
          updatedAt: new Date(),
        })
        .where(eq(leads.id, id))
        .returning();
      if (!updated) throw new Error('The lead was not updated');
      const dateChanged = nextFollowUpOn !== lead.nextFollowUpOn;
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'lead.stage_changed',
        entityType: 'lead',
        entityId: id,
        before: {
          ...identity(lead),
          stage: lead.stage,
          ...(dateChanged ? { nextFollowUpOn: lead.nextFollowUpOn } : {}),
        },
        after: {
          ...identity(updated),
          stage: updated.stage,
          ...(dateChanged ? { nextFollowUpOn: updated.nextFollowUpOn } : {}),
        },
      });
      return this.leads.toDetail(actor, updated, tx);
    });
  }

  /** Rule 6: to another eligible owner; the new owner gets `lead_assigned`. */
  async changeOwner(
    actor: CurrentUserInfo,
    id: string,
    input: LeadOwnerChange,
  ): Promise<LeadDetail> {
    return this.db.transaction(async (tx) => {
      // The new owner stays eligible until commit: archiving them waits (edge case 3).
      await lockAccessChanges(tx);
      const lead = await this.leads.lockForChange(tx, actor, id);
      assertChangeable(lead);
      if (input.ownerId === lead.ownerId) return this.leads.toDetail(actor, lead, tx);
      await this.leads.assertOwner(tx, input.ownerId);
      const [updated] = await tx
        .update(leads)
        .set({ ownerId: input.ownerId, updatedAt: new Date() })
        .where(eq(leads.id, id))
        .returning();
      if (!updated) throw new Error('The lead was not updated');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'lead.owner_changed',
        entityType: 'lead',
        entityId: id,
        before: { ...identity(lead), ownerId: lead.ownerId },
        after: { ...identity(updated), ownerId: updated.ownerId },
      });
      await this.leads.notifyAssigned(tx, actor, updated);
      return this.leads.toDetail(actor, updated, tx);
    });
  }

  /** Rule 8: the loss rejects the lead's sent and expired quotes in the same transaction. */
  async lose(actor: CurrentUserInfo, id: string, input: LoseLead): Promise<LoseLeadResult> {
    const today = businessDate();
    return this.db.transaction(async (tx) => {
      const lead = await this.leads.lockForChange(tx, actor, id);
      assertNotArchived(lead);
      if (!isOpenLeadStage(lead.stage))
        throw invalidTransition(`A ${lead.stage} lead cannot be lost`);
      if (input.reason === 'other' && !input.note) {
        throw new CodedException(400, 'NOTE_REQUIRED', 'Losing for another reason needs a note');
      }
      const rejectedQuotes = await this.closedHooks.lost(
        tx,
        { id, displayName: leadDisplayName(lead), ownerId: lead.ownerId },
        { reason: input.reason, note: input.note, actor: actorOf(actor), today },
      );
      const now = new Date();
      const [updated] = await tx
        .update(leads)
        .set({
          stage: 'lost',
          stageChangedAt: now,
          lostReason: input.reason,
          lostNote: input.note,
          closedAt: now,
          nextFollowUpOn: null,
          updatedAt: now,
        })
        .where(eq(leads.id, id))
        .returning();
      if (!updated) throw new Error('The lead was not updated');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'lead.lost',
        entityType: 'lead',
        entityId: id,
        before: { ...identity(lead), stage: lead.stage, nextFollowUpOn: lead.nextFollowUpOn },
        after: {
          ...identity(updated),
          stage: updated.stage,
          lostReason: input.reason,
          lostNote: input.note,
          rejectedQuotes,
        },
      });
      return { ...(await this.leads.toDetail(actor, updated, tx)), rejectedQuotes };
    });
  }

  /**
   * Rule 9: back to New or Contacted with a follow-up date, optionally to another eligible owner
   * (who gets `lead_assigned`); rejected quotes stay rejected.
   */
  async reopen(actor: CurrentUserInfo, id: string, input: ReopenLead): Promise<LeadDetail> {
    const today = businessDate();
    return this.db.transaction(async (tx) => {
      // An open lead needs an eligible owner (rule 1, edge case 3); archiving them waits.
      await lockAccessChanges(tx);
      const lead = await this.leads.lockForChange(tx, actor, id);
      assertNotArchived(lead);
      if (lead.stage !== 'lost') throw invalidTransition('Only a lost lead is reopened');
      assertFollowUp(input.nextFollowUpOn, today);
      const ownerId = input.ownerId ?? lead.ownerId;
      await this.leads.assertOwner(tx, ownerId);
      const [updated] = await tx
        .update(leads)
        .set({
          stage: input.stage,
          stageChangedAt: new Date(),
          lostReason: null,
          lostNote: null,
          closedAt: null,
          nextFollowUpOn: input.nextFollowUpOn,
          ownerId,
          updatedAt: new Date(),
        })
        .where(eq(leads.id, id))
        .returning();
      if (!updated) throw new Error('The lead was not updated');
      const ownerChanged = ownerId !== lead.ownerId;
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'lead.reopened',
        entityType: 'lead',
        entityId: id,
        before: {
          ...identity(lead),
          stage: lead.stage,
          lostReason: lead.lostReason,
          lostNote: lead.lostNote,
          ...(ownerChanged ? { ownerId: lead.ownerId } : {}),
        },
        after: {
          ...identity(updated),
          stage: updated.stage,
          nextFollowUpOn: updated.nextFollowUpOn,
          ...(ownerChanged ? { ownerId } : {}),
        },
      });
      if (ownerChanged) await this.leads.notifyAssigned(tx, actor, updated);
      return this.leads.toDetail(actor, updated, tx);
    });
  }

  /** Rule 12: an open or lost lead with no non-archived quote; never a won one. */
  async archive(actor: CurrentUserInfo, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const lead = await this.lockForArchive(tx, actor, id);
      if (lead.archivedAt) throw invalidTransition('The lead is already archived');
      if (lead.stage === 'won') throw invalidTransition('A won lead is never archived');
      if (await this.quoteChecks.hasLiveQuotes(tx, id)) {
        throw new CodedException(409, 'LEAD_HAS_QUOTES', 'The lead has quotes');
      }
      await this.setArchived(tx, actor, lead, true);
    });
  }

  /** Rule 12: back to its stage; the next daily run reminds a passed follow-up date. */
  async restore(actor: CurrentUserInfo, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const lead = await this.lockForArchive(tx, actor, id);
      if (!lead.archivedAt) throw invalidTransition('The lead is not archived');
      await this.setArchived(tx, actor, lead, false);
    });
  }

  private async lockForArchive(tx: Transaction, actor: CurrentUserInfo, id: string) {
    const lead = await this.leads.lockForChange(tx, actor, id);
    if (!holdsAll(actor, 'leads.manage')) throw new ForbiddenException();
    return lead;
  }

  private async setArchived(
    tx: Transaction,
    actor: CurrentUserInfo,
    lead: LeadRow,
    archive: boolean,
  ): Promise<void> {
    await tx
      .update(leads)
      .set({ archivedAt: archive ? new Date() : null })
      .where(eq(leads.id, lead.id));
    await recordAudit(tx, {
      actor: actorOf(actor),
      action: archive ? 'lead.archived' : 'lead.restored',
      entityType: 'lead',
      entityId: lead.id,
      before: { ...identity(lead), archived: !archive },
      after: { ...identity(lead), archived: archive },
    });
  }
}
