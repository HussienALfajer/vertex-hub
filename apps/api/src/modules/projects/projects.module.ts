import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { ClientsModule } from '../clients/index.js';
import { CycleOpenedHooks } from './cycle-opened-hooks.js';
import { EngagementDirectory } from './engagement-directory.js';
import { ExtraWorkController } from './extra-work.controller.js';
import { ExtraWorkService } from './extra-work.service.js';
import { ProjectMilestonesController } from './project-milestones.controller.js';
import { ProjectMilestonesService } from './project-milestones.service.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import { RetainerCyclesController } from './retainer-cycles.controller.js';
import { RetainerCyclesService } from './retainer-cycles.service.js';
import { RetainersController } from './retainers.controller.js';
import { RetainersService } from './retainers.service.js';
import { WorkProgress } from './work-progress.js';

/**
 * Projects and retainers of clients (F05). Reads users through `auth`'s `UserDirectory` and
 * clients through `clients`' `ClientDirectory`, registers the project-manager responsibility
 * (rule 4), takes task counts from whatever registers in `WorkProgress` (F06), and works the
 * `retainers.cycles` job that `apps/worker` schedules (R2). Exports `EngagementDirectory` for
 * the `tasks` and `templates` modules, and `CycleOpenedHooks` for `templates` (F07 rule 16).
 */
@Module({
  imports: [AuthModule, ClientsModule],
  controllers: [
    ProjectsController,
    ProjectMilestonesController,
    RetainersController,
    RetainerCyclesController,
    ExtraWorkController,
  ],
  providers: [
    ProjectsService,
    ProjectMilestonesService,
    RetainersService,
    RetainerCyclesService,
    ExtraWorkService,
    WorkProgress,
    EngagementDirectory,
    CycleOpenedHooks,
  ],
  exports: [WorkProgress, EngagementDirectory, CycleOpenedHooks],
})
export class ProjectsModule {}
