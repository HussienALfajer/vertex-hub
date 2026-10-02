import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { ClientsModule } from '../clients/index.js';
import { ProjectsModule } from '../projects/index.js';
import { QuotesModule } from '../quotes/index.js';
import { InvoiceSettingsController } from './invoice-settings.controller.js';
import { InvoiceSettingsService } from './invoice-settings.service.js';
import { InvoiceWorkflowService } from './invoice-workflow.service.js';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';

/**
 * Invoices (F13): settings with the current rate, drafts billed from milestones, retainer cycles
 * and extra work (through `projects`' `BillingSources`), numbering and issue, due dates and voids.
 * Reads clients through `ClientDirectory` and company details and quote numbers through `quotes`'
 * `QuoteDirectory`.
 */
@Module({
  imports: [AuthModule, ClientsModule, ProjectsModule, QuotesModule],
  controllers: [InvoiceSettingsController, InvoicesController],
  providers: [InvoiceSettingsService, InvoicesService, InvoiceWorkflowService],
})
export class InvoicesModule {}
