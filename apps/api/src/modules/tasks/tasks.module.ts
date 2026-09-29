import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { ClientsModule } from '../clients/index.js';
import { NotificationsModule } from '../notifications/index.js';
import { ProjectsModule } from '../projects/index.js';
import { TaskCommentsController } from './task-comments.controller.js';
import { TaskCommentsService } from './task-comments.service.js';
import { TaskGenerator } from './task-generator.js';
import { TaskHooksService } from './task-hooks.service.js';
import { TaskNotices } from './task-notices.js';
import { TaskPartsController } from './task-parts.controller.js';
import { TaskPartsService } from './task-parts.service.js';
import { TaskReminders } from './task-reminders.js';
import { TaskViewsController } from './task-views.controller.js';
import { TaskViewsService } from './task-views.service.js';
import { TaskWorkflowService } from './task-workflow.service.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

/**
 * Tasks of every department (F06, ADR 0016). Reads users through `auth`'s `UserDirectory`,
 * clients through `clients`' `ClientDirectory` and projects and retainers through `projects`'
 * `EngagementDirectory`; feeds task counts and the project close hooks into `projects`'
 * `WorkProgress` and open assigned tasks into `auth`'s `ResponsibilityRegistry`. Exports
 * `TaskGenerator` for the `templates` module (F07). Sends the task notifications and registers
 * the A07/A08 reminders of the daily job through `notifications` (F14).
 */
@Module({
  imports: [AuthModule, ClientsModule, ProjectsModule, NotificationsModule],
  // The views come first: `tasks/board` and `tasks/workload` must not match `tasks/:id`.
  controllers: [TaskViewsController, TasksController, TaskPartsController, TaskCommentsController],
  providers: [
    TasksService,
    TaskWorkflowService,
    TaskHooksService,
    TaskPartsService,
    TaskCommentsService,
    TaskViewsService,
    TaskGenerator,
    TaskNotices,
    TaskReminders,
  ],
  exports: [TaskGenerator],
})
export class TasksModule {}
