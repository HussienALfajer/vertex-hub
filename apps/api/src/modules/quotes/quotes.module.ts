import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { CatalogModule } from '../catalog/index.js';
import { ClientsModule } from '../clients/index.js';
import { FilesModule } from '../files/index.js';
import { NotificationsModule } from '../notifications/index.js';
import { ProjectsModule } from '../projects/index.js';
import { TemplatesModule } from '../templates/index.js';
import { QuoteAcceptService } from './quote-accept.service.js';
import { QuoteFileOwner } from './quote-file-owner.js';
import { QuotePdfService } from './quote-pdf.service.js';
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
 * `GeneratedFiles`.
 */
@Module({
  imports: [
    AuthModule,
    CatalogModule,
    ClientsModule,
    FilesModule,
    NotificationsModule,
    ProjectsModule,
    TemplatesModule,
  ],
  controllers: [QuoteSettingsController, QuotesController],
  providers: [
    QuoteSettingsService,
    QuotesService,
    QuoteWorkflowService,
    QuotePdfService,
    QuoteFileOwner,
    QuoteAcceptService,
  ],
})
export class QuotesModule {}
