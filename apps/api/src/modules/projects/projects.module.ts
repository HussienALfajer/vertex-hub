import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { ClientsModule } from '../clients/index.js';
import { ProjectMilestonesController } from './project-milestones.controller.js';
import { ProjectMilestonesService } from './project-milestones.service.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import { WorkProgress } from './work-progress.js';

/**
 * Projects and retainers of clients (F05). Reads users through `auth`'s `UserDirectory` and
 * clients through `clients`' `ClientDirectory`, registers the project-manager responsibility
 * (rule 4), and takes task counts from whatever registers in `WorkProgress` (F06).
 */
@Module({
  imports: [AuthModule, ClientsModule],
  controllers: [ProjectsController, ProjectMilestonesController],
  providers: [ProjectsService, ProjectMilestonesService, WorkProgress],
  exports: [WorkProgress],
})
export class ProjectsModule {}
