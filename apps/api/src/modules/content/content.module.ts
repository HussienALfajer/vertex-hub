import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { ClientsModule } from '../clients/index.js';
import { FilesModule } from '../files/index.js';
import { NotificationsModule } from '../notifications/index.js';
import { ProjectsModule } from '../projects/index.js';
import { ContentController } from './content.controller.js';
import { ContentService } from './content.service.js';
import { PostHooksService } from './post-hooks.service.js';
import { PostNotices } from './post-notices.js';
import { PostReminders } from './post-reminders.js';
import { PostReviews } from './post-reviews.js';
import { PostWorkflowService } from './post-workflow.service.js';

/**
 * The content calendar (F08, ADR 0021). Owns `content_posts`, `post_reviews` and
 * `post_client_responses`. Reads users through `auth`'s `UserDirectory` and feeds open posts
 * into its `ResponsibilityRegistry`; reads clients through `ClientDirectory` and registers into
 * `ClientFlagHooks` for healthcare flag changes; reads cycle lines through `projects`'
 * `EngagementDirectory` and adds the posts counted directly to `WorkProgress`; registers the
 * `post` owner policy in `files` and reads post media through `FileVersions`; sends the post
 * notifications and registers the publish reminders of the daily job through `notifications`.
 */
@Module({
  imports: [AuthModule, ClientsModule, ProjectsModule, NotificationsModule, FilesModule],
  controllers: [ContentController],
  providers: [
    ContentService,
    PostWorkflowService,
    PostHooksService,
    PostReviews,
    PostNotices,
    PostReminders,
  ],
})
export class ContentModule {}
