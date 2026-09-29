import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { ClientsModule } from '../clients/index.js';
import { ProjectsModule } from '../projects/index.js';
import { TaskHooksService } from './task-hooks.service.js';
import { TaskWorkflowService } from './task-workflow.service.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

/**
 * Tasks of every department (F06, ADR 0016). Reads users through `auth`'s `UserDirectory`,
 * clients through `clients`' `ClientDirectory` and projects and retainers through `projects`'
 * `EngagementDirectory`; feeds task counts and the project close hooks into `projects`'
 * `WorkProgress` and open assigned tasks into `auth`'s `ResponsibilityRegistry`.
 */
@Module({
  imports: [AuthModule, ClientsModule, ProjectsModule],
  controllers: [TasksController],
  providers: [TasksService, TaskWorkflowService, TaskHooksService],
})
export class TasksModule {}
