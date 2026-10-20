import { Module } from '@nestjs/common';
import { AudiencesModule } from '../audiences/index.js';
import { AuthModule } from '../auth/index.js';
import { FilesModule } from '../files/index.js';
import { NotificationsModule } from '../notifications/index.js';
import { AnnouncementDelivery } from './announcement-delivery.js';
import { AnnouncementFileOwner } from './announcement-file-owner.js';
import { AnnouncementPolls } from './announcement-polls.js';
import { AnnouncementTemplatesController } from './announcement-templates.controller.js';
import { AnnouncementTemplatesService } from './announcement-templates.service.js';
import { AnnouncementsController } from './announcements.controller.js';
import { AnnouncementsService } from './announcements.service.js';

/**
 * Announcements (F16 part D, ADR 0038). Owns `announcements`, `announcement_recipients`, the
 * poll tables and `announcement_templates`.
 * Resolves audiences through `audiences`' `AudienceResolver`, reads users through `auth`'s
 * `UserDirectory`, notifies through `notifications` (and registers its scheduled sends in the
 * minute job, with poll closing and its reminders, and its acknowledgement reminders in the daily
 * job), and registers the
 * `announcement` file owner with `files`. Nothing imports it.
 */
@Module({
  imports: [AudiencesModule, AuthModule, FilesModule, NotificationsModule],
  controllers: [AnnouncementsController, AnnouncementTemplatesController],
  providers: [
    AnnouncementsService,
    AnnouncementDelivery,
    AnnouncementFileOwner,
    AnnouncementPolls,
    AnnouncementTemplatesService,
  ],
})
export class AnnouncementsModule {}
