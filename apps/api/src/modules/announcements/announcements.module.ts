import { Module } from '@nestjs/common';
import { AudiencesModule } from '../audiences/index.js';
import { AuthModule } from '../auth/index.js';
import { FilesModule } from '../files/index.js';
import { NotificationsModule } from '../notifications/index.js';
import { AnnouncementDelivery } from './announcement-delivery.js';
import { AnnouncementFileOwner } from './announcement-file-owner.js';
import { AnnouncementsController } from './announcements.controller.js';
import { AnnouncementsService } from './announcements.service.js';

/**
 * Announcements (F16 part D, ADR 0038). Owns `announcements` and `announcement_recipients`.
 * Resolves audiences through `audiences`' `AudienceResolver`, reads users through `auth`'s
 * `UserDirectory`, notifies through `notifications` (and registers its scheduled sends in the
 * minute job and its acknowledgement reminders in the daily job), and registers the
 * `announcement` file owner with `files`. Nothing imports it.
 */
@Module({
  imports: [AudiencesModule, AuthModule, FilesModule, NotificationsModule],
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService, AnnouncementDelivery, AnnouncementFileOwner],
})
export class AnnouncementsModule {}
