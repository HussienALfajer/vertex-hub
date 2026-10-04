import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/index.js';
import { AuthModule } from '../auth/index.js';
import { CalendarModule } from '../calendar/index.js';
import { CampaignsModule } from '../campaigns/index.js';
import { CatalogModule } from '../catalog/index.js';
import { ClientsModule } from '../clients/index.js';
import { ContentModule } from '../content/index.js';
import { FilesModule } from '../files/index.js';
import { InvoicesModule } from '../invoices/index.js';
import { LeadsModule } from '../leads/index.js';
import { ProjectsModule } from '../projects/index.js';
import { QuotesModule } from '../quotes/index.js';
import { TasksModule } from '../tasks/index.js';
import { ClientReportController } from './client-report.controller.js';
import { ClientReportService } from './client-report.service.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

/**
 * Dashboards and reports (F15, ADR 0027): computed on read from the read-only report services of
 * `tasks` (`TaskReports`), `projects` (`EngagementReports`), `invoices` (`InvoiceReports`), `leads`
 * (`LeadReports`), `campaigns` (`CampaignReports`), `approvals` (`ApprovalReports`), `content`
 * (`ContentReports`) and `calendar` (`ShootReports`), with names from `ClientDirectory`,
 * `UserDirectory` and `catalog`'s `CatalogDirectory`. Owns `client_report_notes` and
 * `client_report_pdfs`: renders the monthly client report PDF through the worker (`reports.pdf`),
 * serves it through `files`' `GeneratedFiles` and purges it through `FilePurges`, with the
 * company details from `quotes`' `QuoteDirectory`. Owns no business rules of other modules;
 * nothing imports it.
 */
@Module({
  imports: [
    ApprovalsModule,
    AuthModule,
    CalendarModule,
    CampaignsModule,
    CatalogModule,
    ClientsModule,
    ContentModule,
    FilesModule,
    InvoicesModule,
    LeadsModule,
    ProjectsModule,
    QuotesModule,
    TasksModule,
  ],
  controllers: [DashboardController, ReportsController, ClientReportController],
  providers: [DashboardService, ReportsService, ClientReportService],
})
export class ReportsModule {}
