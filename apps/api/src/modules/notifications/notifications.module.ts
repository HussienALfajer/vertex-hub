import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { DailyReminders } from './daily-reminders.js';
import { NotificationCenter } from './notification-center.js';
import { NotificationStream } from './notification-stream.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

/**
 * In-app notifications (F14, ADR 0018). Other modules store notifications through
 * `NotificationCenter` inside their own transactions and register their part of the
 * `notifications.daily` job with `DailyReminders`; this module never imports them. Reads users
 * through `auth`'s `UserDirectory`.
 */
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationCenter, NotificationStream, DailyReminders],
  exports: [NotificationCenter, DailyReminders],
})
export class NotificationsModule {}
