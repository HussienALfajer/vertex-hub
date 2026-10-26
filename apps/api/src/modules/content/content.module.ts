import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { ClientsModule } from '../clients/index.js';
import { FilesModule } from '../files/index.js';
import { HrModule } from '../hr/index.js';
import { NotificationsModule } from '../notifications/index.js';
import { ProjectsModule } from '../projects/index.js';
import { TasksModule } from '../tasks/index.js';
import { ContentController } from './content.controller.js';
import { ContentService } from './content.service.js';
import { ContentIdeasService } from './content-ideas.service.js';
import { ContentOccasionsService } from './content-occasions.service.js';
import { ContentPlanner } from './content-planner.js';
import { ContentPlanningController } from './content-planning.controller.js';
import { ContentReports } from './content-reports.js';
import { ContentSettingsService } from './content-settings.service.js';
import { PostApprovals } from './post-approvals.js';
import { PostCaptions } from './post-captions.js';
import { PostHooksService } from './post-hooks.service.js';
import { PostLinksService } from './post-links.service.js';
import { PostMedia } from './post-media.js';
import { PostMovesService } from './post-moves.service.js';
import { PostNotices } from './post-notices.js';
import { PostPack } from './post-pack.js';
import { PostReminders } from './post-reminders.js';
import { PostReviewHooks } from './post-review-hooks.js';
import { PostReviews } from './post-reviews.js';
import { PostTeams } from './post-teams.js';
import { PostWorkflowService } from './post-workflow.service.js';

/**
 * The content calendar (F08, ADR 0021; F08B, ADR 0042). Owns `content_posts`, `post_captions`,
 * `post_reviews`, `post_client_responses` and the planning aids (`content_pillars`,
 * `content_occasions`, `content_occasion_dates`, `content_planning_settings`, `content_snippets`,
 * `content_ideas`). Reads users through `auth`'s `UserDirectory` and feeds open posts
 * into its `ResponsibilityRegistry`; reads clients through `ClientDirectory` and registers into
 * `ClientFlagHooks` for healthcare flag changes; reads cycle lines through `projects`'
 * `EngagementDirectory` and adds the posts counted directly to `WorkProgress`; registers the
 * `post` owner policy in `files` and reads post media through `FileVersions`; sends the post
 * notifications and registers the publish reminders of the daily job through `notifications`.
 * Links tasks to posts through `tasks`' `PostTasks` and registers into its `PostTaskHooks`
 * (a linked task approved, cancelled or archived). Exports `PostApprovals` and the
 * `PostReviewHooks` registry for the `approvals` module, which it never imports, and the
 * read-only `ContentReports` for `reports` (F15). Skips public holidays in post task due dates and
 * publish reminders through `hr`'s `HolidayCalendar` (F17 rule B1).
 */
@Module({
  imports: [
    AuthModule,
    ClientsModule,
    ProjectsModule,
    NotificationsModule,
    FilesModule,
    HrModule,
    TasksModule,
  ],
  controllers: [ContentController, ContentPlanningController],
  providers: [
    ContentService,
    PostWorkflowService,
    PostLinksService,
    PostHooksService,
    PostReviews,
    PostMedia,
    PostNotices,
    PostReminders,
    PostApprovals,
    PostReviewHooks,
    ContentReports,
    PostTeams,
    PostCaptions,
    PostPack,
    PostMovesService,
    ContentSettingsService,
    ContentOccasionsService,
    ContentIdeasService,
    ContentPlanner,
  ],
  exports: [PostApprovals, PostReviewHooks, ContentReports, PostTeams],
})
export class ContentModule {}
