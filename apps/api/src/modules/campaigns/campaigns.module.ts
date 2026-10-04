import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { ClientsModule } from '../clients/index.js';
import { ProjectsModule } from '../projects/index.js';
import { TasksModule } from '../tasks/index.js';
import { CampaignUpdatesService } from './campaign-updates.service.js';
import { CampaignsController } from './campaigns.controller.js';
import { CampaignsService } from './campaigns.service.js';

/**
 * Ad campaigns (F12, ADR 0025): campaigns of a client with a USD budget and periodic updates of
 * spend and results. Reads clients through `ClientDirectory`, users through `UserDirectory`, the
 * linked project or retainer through `projects`' `EngagementDirectory` and the linked task through
 * `tasks`' `TaskLinks`. No module imports it.
 */
@Module({
  imports: [AuthModule, ClientsModule, ProjectsModule, TasksModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, CampaignUpdatesService],
})
export class CampaignsModule {}
