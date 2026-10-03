import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { ClientsModule } from '../clients/index.js';
import { FilesModule } from '../files/index.js';
import { NotificationsModule } from '../notifications/index.js';
import { ProjectsModule } from '../projects/index.js';
import { QuotesModule } from '../quotes/index.js';
import { InvoiceBillingController } from './invoice-billing.controller.js';
import { InvoiceBillingService } from './invoice-billing.service.js';
import { InvoiceDrafts } from './invoice-drafts.js';
import { InvoiceDueDates } from './invoice-due-dates.js';
import { InvoiceFileOwner } from './invoice-file-owner.js';
import { InvoiceOverdueService } from './invoice-overdue.service.js';
import { InvoicePdfService } from './invoice-pdf.service.js';
import { InvoiceSettingsController } from './invoice-settings.controller.js';
import { InvoiceSettingsService } from './invoice-settings.service.js';
import { InvoiceSnapshots } from './invoice-snapshots.js';
import { InvoiceWorkflowService } from './invoice-workflow.service.js';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { ProjectExpensesService } from './project-expenses.service.js';

/**
 * Invoices (F13): settings with the current rate, drafts billed from milestones, retainer cycles
 * and extra work (through `projects`' `BillingSources`), numbering and issue, due dates and voids.
 * Reads clients through `ClientDirectory` and company details and quote numbers through `quotes`'
 * `QuoteDirectory`. Drafts automatically through `QuoteAcceptedHooks`, `MilestoneDoneHooks` and
 * `CycleOpenedHooks`, and answers `projects`' `BillingLocks`. Records and voids payments with
 * receipt numbers, keeps payment proofs as invoice documents (`files`' `GeneratedFiles`, owner
 * type `invoice`), renders invoice, draft, receipt and statement PDFs through the worker
 * (`invoices.pdf`, `invoices.pdf-ready`; statement renders purged through `files`' `FilePurges`),
 * marks invoices overdue in `invoices.daily` and repeats the alert as a source of
 * `notifications.daily`. Owns `project_expenses` and serves client balances and statements, and the
 * billing summaries of projects (with their margin) and retainers; exports `InvoiceDueDates` for
 * the company calendar.
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
  controllers: [
    InvoiceSettingsController,
    InvoicesController,
    PaymentsController,
    InvoiceBillingController,
  ],
  providers: [
    InvoiceSettingsService,
    InvoiceSnapshots,
    InvoicesService,
    InvoicePdfService,
    InvoiceWorkflowService,
    InvoiceDrafts,
    PaymentsService,
    InvoiceOverdueService,
    InvoiceFileOwner,
    InvoiceDueDates,
    InvoiceBillingService,
    ProjectExpensesService,
  ],
  exports: [InvoiceDueDates],
})
export class InvoicesModule {}
