import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { ClientsModule } from '../clients/index.js';
import { FilesModule } from '../files/index.js';
import { HrModule } from '../hr/index.js';
import { NotificationsModule } from '../notifications/index.js';
import { ProjectsModule } from '../projects/index.js';
import { ClientReviewHooks } from './client-review-hooks.js';
import { OverLimitReminders } from './over-limit-reminders.js';
import { PostTaskHooks } from './post-task-hooks.js';
import { PostTasks } from './post-tasks.js';
import { QuestionReminders } from './question-reminders.js';
import { ShootTasks } from './shoot-tasks.js';
import { SubtaskRuns } from './subtask-runs.js';
import { TaskApprovals } from './task-approvals.js';
import { TaskCommentsController } from './task-comments.controller.js';
import { TaskCommentsService } from './task-comments.service.js';
import { TaskCreation } from './task-creation.js';
import { TaskDigest } from './task-digest.js';
import { TaskFileOwner } from './task-file-owner.js';
import { TaskGenerator } from './task-generator.js';
import { TaskGuards } from './task-guards.js';
import { TaskHooksService } from './task-hooks.service.js';
import { TaskLinks } from './task-links.js';
import { TaskNotices } from './task-notices.js';
import { TaskPartsController } from './task-parts.controller.js';
import { TaskPartsService } from './task-parts.service.js';
import { TaskQuestionsController } from './task-questions.controller.js';
import { TaskQuestionsService } from './task-questions.service.js';
import { TaskQueueHooks } from './task-queue-hooks.js';
import { TaskReadinessService } from './task-readiness.service.js';
import { TaskReminders } from './task-reminders.js';
import { TaskReports } from './task-reports.js';
import { TaskReviewsController } from './task-reviews.controller.js';
import { TaskReviews } from './task-reviews.js';
import { TaskReviewsService } from './task-reviews.service.js';
import { TaskSubtasksController } from './task-subtasks.controller.js';
import { TaskSubtasksService } from './task-subtasks.service.js';
import { TaskTemplateHooks } from './task-template-hooks.js';
import { TaskTemplates } from './task-templates.js';
import { TaskTreeService } from './task-tree.service.js';
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
 * the A07/A08 reminders of the daily job through `notifications` (F14). Registers the `task`
 * owner policy in `files` and calls its `FileVersions` on approval and client changes (F10).
 * Owns the review stage, the review snapshots and the client responses (F09, ADR 0020): registers
 * into `clients`' `ClientFlagHooks` for healthcare flag changes, and exports `TaskApprovals` and
 * the `ClientReviewHooks` registry for the `approvals` module, which it never imports. Owns the
 * link of a task to a post (F08, ADR 0021): exports `PostTasks` and the `PostTaskHooks` registry
 * for the `content` module, which it never imports either. Exports `ShootTasks` and the
 * `TaskGuards` registry for the `calendar` module (F11, ADR 0022), which it never imports, and
 * `TaskLinks` (task summaries) for the `campaigns` module (F12), and `TaskReports` for `reports` (F15).
 * Warns of an assignee's approved leave through `hr`'s `LeaveDirectory` and feeds open tasks into
 * its `LeaveWorkSources` (F17 rules B14 and B17). Owns subtasks, their stages and run, and the
 * questions of a task's thread (F06B, ADR 0041): attaches their files through `files`'
 * `FileAttachments` and counts reminders in work hours with `hr`'s `HolidayCalendar`. Creates a
 * task with its parts in one transaction, checks readiness and shows estimates against `hr`'s
 * `WorkCapacity`, draws a project's tree, and exports `TaskTemplates` (snapshots and draft
 * assignees) and the `TaskTemplateHooks` registry, where `templates` records the run of a task
 * template, for the `templates` module (F06B part D).
 */
@Module({
  imports: [AuthModule, ClientsModule, ProjectsModule, NotificationsModule, FilesModule, HrModule],
  // The views come first: `tasks/board` and `tasks/workload` must not match `tasks/:id`.
  controllers: [
    TaskViewsController,
    TasksController,
    TaskReviewsController,
    TaskPartsController,
    TaskCommentsController,
    TaskQuestionsController,
    TaskSubtasksController,
  ],
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
    TaskDigest,
    OverLimitReminders,
    TaskFileOwner,
    TaskReviews,
    TaskReviewsService,
    TaskApprovals,
    ClientReviewHooks,
    PostTasks,
    PostTaskHooks,
    ShootTasks,
    TaskGuards,
    TaskLinks,
    TaskReports,
    TaskQueueHooks,
    SubtaskRuns,
    TaskSubtasksService,
    TaskQuestionsService,
    QuestionReminders,
    TaskCreation,
    TaskReadinessService,
    TaskTreeService,
    TaskTemplates,
    TaskTemplateHooks,
  ],
  exports: [
    TaskGenerator,
    TaskQueueHooks,
    TaskApprovals,
    ClientReviewHooks,
    PostTasks,
    PostTaskHooks,
    ShootTasks,
    TaskGuards,
    TaskLinks,
    TaskReports,
    TaskTemplates,
    TaskTemplateHooks,
  ],
})
export class TasksModule {}
