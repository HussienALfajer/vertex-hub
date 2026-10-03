import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { ClientsModule } from '../clients/index.js';
import { FilesModule } from '../files/index.js';
import { NotificationsModule } from '../notifications/index.js';
import { ProjectsModule } from '../projects/index.js';
import { QuotesModule } from '../quotes/index.js';
import { InvoiceDrafts } from './invoice-drafts.js';
import { InvoiceFileOwner } from './invoice-file-owner.js';
import { InvoiceOverdueService } from './invoice-overdue.service.js';
import { InvoiceSettingsController } from './invoice-settings.controller.js';
import { InvoiceSettingsService } from './invoice-settings.service.js';
import { InvoiceWorkflowService } from './invoice-workflow.service.js';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

/**
 * Invoices (F13): settings with the current rate, drafts billed from milestones, retainer cycles
 * and extra work (through `projects`' `BillingSources`), numbering and issue, due dates and voids.
 * Reads clients through `ClientDirectory` and company details and quote numbers through `quotes`'
 * `QuoteDirectory`. Drafts automatically through `QuoteAcceptedHooks`, `MilestoneDoneHooks` and
 * `CycleOpenedHooks`, and answers `projects`' `BillingLocks`. Records and voids payments with
 * receipt numbers, keeps payment proofs as invoice documents (`files`' `GeneratedFiles`, owner
 * type `invoice`), marks invoices overdue in `invoices.daily` and repeats the alert as a source of
 * `notifications.daily`.
 */
@Module({
  imports: [
    AuthModule,
    ClientsModule,
    FilesModule,
    NotificationsModule,
    ProjectsModule,
    QuotesModule,
  ],
  controllers: [InvoiceSettingsController, InvoicesController, PaymentsController],
  providers: [
    InvoiceSettingsService,
    InvoicesService,
    InvoiceWorkflowService,
    InvoiceDrafts,
    PaymentsService,
    InvoiceOverdueService,
    InvoiceFileOwner,
  ],
})
export class InvoicesModule {}
