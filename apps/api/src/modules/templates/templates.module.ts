import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { ClientsModule } from '../clients/index.js';
import { NotificationsModule } from '../notifications/index.js';
import { ProjectsModule } from '../projects/index.js';
import { TasksModule } from '../tasks/index.js';
import { RetainerTemplatesController } from './retainer-templates.controller.js';
import { TemplateDirectory } from './template-directory.js';
import { TemplateRunsController } from './template-runs.controller.js';
import { TemplateRunsService } from './template-runs.service.js';
import { TemplatesController } from './templates.controller.js';
import { TemplatesService } from './templates.service.js';

/**
 * Work templates and their runs (F07, ADR 0017). Reads users and department membership through
 * `auth`'s `UserDirectory`, clients through `clients`' `ClientDirectory` and projects, milestones,
 * retainers and cycles through `projects`' `EngagementDirectory`; creates tasks through `tasks`'
 * `TaskGenerator` and generates each new cycle's tasks through `projects`' `CycleOpenedHooks`;
 * notifies each run's assignees and department managers through `notifications` (F14). Exports
 * `TemplateDirectory` (names, kinds, archived state) for the catalog (F04).
 */
@Module({
  imports: [AuthModule, ClientsModule, ProjectsModule, TasksModule, NotificationsModule],
  controllers: [TemplatesController, TemplateRunsController, RetainerTemplatesController],
  providers: [TemplatesService, TemplateRunsService, TemplateDirectory],
  exports: [TemplateDirectory],
})
export class TemplatesModule {}
