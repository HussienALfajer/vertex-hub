import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/index.js';
import { AuthModule } from '../auth/index.js';
import { CampaignsModule } from '../campaigns/index.js';
import { ClientsModule } from '../clients/index.js';
import { InvoicesModule } from '../invoices/index.js';
import { LeadsModule } from '../leads/index.js';
import { ProjectsModule } from '../projects/index.js';
import { TasksModule } from '../tasks/index.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

/**
 * Dashboards and reports (F15, ADR 0027): computed on read from the read-only report services of
 * `tasks` (`TaskReports`), `projects` (`EngagementReports`), `invoices` (`InvoiceReports`), `leads`
 * (`LeadReports`), `campaigns` (`CampaignReports`) and `approvals` (`ApprovalReports`), with client
 * names from `ClientDirectory`. Owns no business rules of other modules; nothing imports it.
 */
@Module({
  imports: [
    ApprovalsModule,
    AuthModule,
    CampaignsModule,
    ClientsModule,
    InvoicesModule,
    LeadsModule,
    ProjectsModule,
    TasksModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class ReportsModule {}
