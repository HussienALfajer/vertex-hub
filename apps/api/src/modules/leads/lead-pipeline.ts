import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type ConvertLead,
  type LeadConversionPlan,
  type LeadStage,
  MANUAL_LEAD_STAGES,
} from '@vertex-hub/contracts';
import { type Database, leads, type Transaction } from '@vertex-hub/db';
import { eq } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { type ConversionResult, LeadConversionService } from './lead-conversion.service.js';
import { identity, LeadsService } from './leads.service.js';

/**
 * The pipeline steps other modules drive (ADR 0026): `quotes` moves a lead to Quote sent when one
 * of its quotes is sent (rule 14) and converts it as step 0 of an acceptance (rule 11). The
 * caller checks access through its own permissions.
 */
@Injectable()
export class LeadPipeline {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly leads: LeadsService,
    private readonly conversion: LeadConversionService,
  ) {}

  /** Rule 14: New, Contacted or Meeting → Quote sent, audited as the sender's stage change. */
  async markQuoteSent(
    tx: Transaction,
    actor: AuditActor,
    leadId: string,
    quote: { id: string; displayNumber: string },
  ): Promise<void> {
    const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId)).for('update');
    if (!lead || !(MANUAL_LEAD_STAGES as readonly LeadStage[]).includes(lead.stage)) return;
    const [updated] = await tx
      .update(leads)
      .set({ stage: 'quote_sent', stageChangedAt: new Date(), updatedAt: new Date() })
      .where(eq(leads.id, leadId))
      .returning();
    if (!updated) throw new Error('The lead was not updated');
    await recordAudit(tx, {
      actor,
      action: 'lead.stage_changed',
      entityType: 'lead',
      entityId: leadId,
      before: { ...identity(lead), stage: lead.stage },
      after: {
        ...identity(updated),
        stage: updated.stage,
        quoteId: quote.id,
        quote: quote.displayNumber,
      },
    });
  }

  /** Step 0's defaults (rule 11); `clientId` for the existing-client mode. */
  async conversionPlan(leadId: string, clientId?: string): Promise<LeadConversionPlan> {
    const lead = await this.leads.row(this.db, leadId);
    if (!lead) throw new NotFoundException();
    return this.conversion.plan(lead, clientId);
  }

  /**
   * Rule 10 inside the caller's transaction, which holds `lockAccessChanges` and has locked the
   * lead (`LeadDirectory.summary` with `forUpdate`).
   */
  async convert(
    tx: Transaction,
    actor: CurrentUserInfo,
    leadId: string,
    input: ConvertLead,
  ): Promise<ConversionResult> {
    const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId)).for('update');
    if (!lead) throw new NotFoundException();
    return this.conversion.convert(tx, actor, lead, input);
  }
}
