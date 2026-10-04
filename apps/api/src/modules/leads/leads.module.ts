import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { CatalogModule } from '../catalog/index.js';
import { ClientsModule } from '../clients/index.js';
import { NotificationsModule } from '../notifications/index.js';
import { LeadClosedHooks, LeadQuoteChecks } from './lead-closed-hooks.js';
import { LeadConversionService } from './lead-conversion.service.js';
import { LeadDirectory } from './lead-directory.js';
import { LeadNotesService } from './lead-notes.service.js';
import { LeadPipeline } from './lead-pipeline.js';
import { LeadPipelineService } from './lead-pipeline.service.js';
import { LeadReminders } from './lead-reminders.js';
import { LeadsController } from './leads.controller.js';
import { LeadsService } from './leads.service.js';

/**
 * Leads (F03, ADR 0026): the sales pipeline from New to Won or Lost, with an owner, a mandatory
 * next follow-up date on open leads, the activity log, the conversion into a client and the A12
 * follow-up reminders (sources of `notifications.daily`). Reads users through `UserDirectory`,
 * clients through `ClientDirectory` and catalog items through `CatalogDirectory`; creates clients
 * through `ClientFactory`; blocks archiving a user who owns open leads (`ResponsibilityRegistry`).
 * Exports `LeadDirectory` and `LeadPipeline` to `quotes`, which registers into `LeadClosedHooks`
 * and `LeadQuoteChecks`; `leads` never imports `quotes`.
 */
@Module({
  imports: [AuthModule, CatalogModule, ClientsModule, NotificationsModule],
  controllers: [LeadsController],
  providers: [
    LeadsService,
    LeadPipelineService,
    LeadNotesService,
    LeadReminders,
    LeadClosedHooks,
    LeadQuoteChecks,
    LeadConversionService,
    LeadDirectory,
    LeadPipeline,
  ],
  exports: [LeadDirectory, LeadPipeline, LeadClosedHooks, LeadQuoteChecks],
})
export class LeadsModule {}
