import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { ClientsModule } from '../clients/index.js';
import { FilesModule } from '../files/index.js';
import { NotificationsModule } from '../notifications/index.js';
import { BillingSources } from './billing-sources.js';
import { CycleOpenedHooks } from './cycle-opened-hooks.js';
import { EngagementDirectory } from './engagement-directory.js';
import { EngagementFactory } from './engagement-factory.js';
import { EngagementFileOwners } from './engagement-file-owners.js';
import { ExtraWorkController } from './extra-work.controller.js';
import { ExtraWorkService } from './extra-work.service.js';
import { ProjectMilestonesController } from './project-milestones.controller.js';
import { ProjectMilestonesService } from './project-milestones.service.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import { RetainerBehindAlerts } from './retainer-behind.js';
import { RetainerCyclesController } from './retainer-cycles.controller.js';
import { RetainerCyclesService } from './retainer-cycles.service.js';
import { RetainerRenewals } from './retainer-renewals.js';
import { RetainersController } from './retainers.controller.js';
import { RetainersService } from './retainers.service.js';
import { WorkProgress } from './work-progress.js';

/**
 * Projects and retainers of clients (F05). Reads users through `auth`'s `UserDirectory` and
 * clients through `clients`' `ClientDirectory`, registers the project-manager responsibility
 * (rule 4), takes task counts from whatever registers in `WorkProgress` (F06), and works the
 * `retainers.cycles` job that `apps/worker` schedules (R2). Notifies new project managers and
 * registers the renewal reminder and the behind alert (A09) in `notifications`' daily job (F14). Exports `EngagementDirectory` for
 * the `tasks` and `templates` modules, `CycleOpenedHooks` for `templates` (F07 rule 16) and
 * `EngagementFactory` for `quotes` (F04 A01).
 * Registers the `project` and `retainer` owner policies in `files` (F10).
 */
@Module({
  imports: [AuthModule, ClientsModule, NotificationsModule, FilesModule],
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
    EngagementFactory,
    BillingSources,
    CycleOpenedHooks,
    RetainerRenewals,
    RetainerBehindAlerts,
    EngagementFileOwners,
  ],
  exports: [WorkProgress, EngagementDirectory, EngagementFactory, BillingSources, CycleOpenedHooks],
})
export class ProjectsModule {}
