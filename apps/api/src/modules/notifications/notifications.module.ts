import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { EmailModule } from '../email/index.js';
import { DailyReminders } from './daily-reminders.js';
import { NotificationCenter } from './notification-center.js';
import { NotificationEmails } from './notification-emails.js';
import { DEFAULT_STREAM_TIMING, NotificationStream, STREAM_TIMING } from './notification-stream.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

/**
 * In-app notifications (F14, ADR 0018). Other modules store notifications through
 * `NotificationCenter` inside their own transactions and register their part of the
 * `notifications.daily` job with `DailyReminders` and their digest part with `NotificationEmails`
 * (F14 email); this module never imports them. Queues emails through `email`'s `Mailer`. Reads users
 * through `auth`'s `UserDirectory`.
 */
@Module({
  imports: [AuthModule, EmailModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationCenter,
    NotificationStream,
    DailyReminders,
    NotificationEmails,
    { provide: STREAM_TIMING, useValue: DEFAULT_STREAM_TIMING },
  ],
  exports: [NotificationCenter, DailyReminders, NotificationEmails],
})
export class NotificationsModule {}
