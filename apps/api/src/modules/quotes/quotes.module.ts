import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { CatalogModule } from '../catalog/index.js';
import { ClientsModule } from '../clients/index.js';
import { FilesModule } from '../files/index.js';
import { LeadsModule } from '../leads/index.js';
import { NotificationsModule } from '../notifications/index.js';
import { ProjectsModule } from '../projects/index.js';
import { TemplatesModule } from '../templates/index.js';
import { LeadQuotes } from './lead-quotes.js';
import { QuoteAcceptService } from './quote-accept.service.js';
import { QuoteAcceptedHooks } from './quote-accepted-hooks.js';
import { QuoteDirectory } from './quote-directory.js';
import { QuoteEmailsController } from './quote-emails.controller.js';
import { QuoteEmailsService } from './quote-emails.service.js';
import { QuoteFileOwner } from './quote-file-owner.js';
import { QuotePdfService } from './quote-pdf.service.js';
import { QuoteRecipients } from './quote-recipients.js';
import { QuoteSettingsController } from './quote-settings.controller.js';
import { QuoteSettingsService } from './quote-settings.service.js';
import { QuoteWorkflowService } from './quote-workflow.service.js';
import { QuotesController } from './quotes.controller.js';
import { QuotesService } from './quotes.service.js';

/**
 * Quotes (F04): settings, drafts built from the catalog, discount approval, send, versions and
 * the daily expiry, and their PDFs (rendered by the worker, kept as documents through `files`'s
 * `GeneratedFiles` and the `quote` owner policy). Copies catalog items through
 * `CatalogDirectory`, reads clients through `ClientDirectory` and notifies through
 * `NotificationCenter`. Recording an acceptance runs A01's engagement part through `projects`'
 * `EngagementFactory` and `templates`' `TemplateRunner`, and keeps the proof through `files`'
 * `GeneratedFiles`. Exports `QuoteDirectory` (company details, quote numbers) and `QuoteAcceptedHooks` (the
 * A01 deposit draft, F13) to `invoices`.
 */
@Module({
  imports: [
    AuthModule,
    CatalogModule,
    ClientsModule,
    FilesModule,
    LeadsModule,
    NotificationsModule,
    ProjectsModule,
    TemplatesModule,
  ],
  controllers: [QuoteSettingsController, QuotesController, QuoteEmailsController],
  providers: [
    QuoteSettingsService,
    QuotesService,
    QuoteWorkflowService,
    QuotePdfService,
    QuoteEmailsService,
    QuoteFileOwner,
    QuoteAcceptService,
    QuoteDirectory,
    QuoteAcceptedHooks,
    QuoteRecipients,
    LeadQuotes,
  ],
  exports: [QuoteDirectory, QuoteAcceptedHooks],
})
export class QuotesModule {}
