import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { ClientsModule } from '../clients/index.js';
import { ContentModule } from '../content/index.js';
import { FilesModule } from '../files/index.js';
import { NotificationsModule } from '../notifications/index.js';
import { TasksModule } from '../tasks/index.js';
import { ApprovalNotices } from './approval-notices.js';
import { ApprovalReminders } from './approval-reminders.js';
import { ApprovalReports } from './approval-reports.js';
import { ApprovalsController } from './approvals.controller.js';
import { ApprovalsService } from './approvals.service.js';
import { ClientApprovalsController } from './client-approvals.controller.js';
import { PublicApprovalsController } from './public-approvals.controller.js';
import { PublicApprovalsService } from './public-approvals.service.js';

/**
 * Client approval links (F09, ADR 0020). Owns `approval_requests` and `approval_items`. Reads
 * and moves tasks through `tasks`' `TaskApprovals` and registers into its `ClientReviewHooks`
 * (pending items, and tasks leaving `awaiting_client`); does the same for posts (F08, ADR 0021)
 * through `content`'s `PostApprovals` and `PostReviewHooks`; reads snapshot versions and serves them
 * to the holder of a link through `files`' `FileVersions`; reads clients and contacts through
 * `ClientDirectory` and users through `UserDirectory`; notifies through `notifications`. Works
 * the `approvals.reminders` job. Exports `ApprovalReports` for `reports`, its only importer.
 */
@Module({
  imports: [
    AuthModule,
    ClientsModule,
    FilesModule,
    NotificationsModule,
    TasksModule,
    ContentModule,
  ],
  controllers: [ApprovalsController, ClientApprovalsController, PublicApprovalsController],
  providers: [
    ApprovalsService,
    PublicApprovalsService,
    ApprovalReminders,
    ApprovalNotices,
    ApprovalReports,
  ],
  exports: [ApprovalReports],
})
export class ApprovalsModule {}
