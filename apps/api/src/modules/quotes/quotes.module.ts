import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { CatalogModule } from '../catalog/index.js';
import { ClientsModule } from '../clients/index.js';
import { NotificationsModule } from '../notifications/index.js';
import { QuoteSettingsController } from './quote-settings.controller.js';
import { QuoteSettingsService } from './quote-settings.service.js';
import { QuoteWorkflowService } from './quote-workflow.service.js';
import { QuotesController } from './quotes.controller.js';
import { QuotesService } from './quotes.service.js';

/**
 * Quotes (F04): settings, drafts built from the catalog, discount approval, send, versions and
 * the daily expiry. Copies catalog items through `CatalogDirectory`, reads clients through
 * `ClientDirectory` and notifies through `NotificationCenter`.
 */
@Module({
  imports: [AuthModule, CatalogModule, ClientsModule, NotificationsModule],
  controllers: [QuoteSettingsController, QuotesController],
  providers: [QuoteSettingsService, QuotesService, QuoteWorkflowService],
})
export class QuotesModule {}
