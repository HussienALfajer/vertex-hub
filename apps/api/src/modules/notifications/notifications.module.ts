import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { EmailModule } from '../email/index.js';
import { DailyReminders } from './daily-reminders.js';
import { EmailFailureNotices } from './email-failure-notices.js';
import { NotificationCenter } from './notification-center.js';
import { NotificationEmails } from './notification-emails.js';
import { DEFAULT_STREAM_TIMING, NotificationStream, STREAM_TIMING } from './notification-stream.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { PushController } from './push.controller.js';
import { PushService } from './push.service.js';
import { PushQueue } from './push-queue.js';

/**
 * In-app notifications (F14, ADR 0018). Other modules store notifications through
 * `NotificationCenter` inside their own transactions and register their part of the
 * `notifications.daily` job with `DailyReminders` and their digest part with `NotificationEmails`
 * (F14 email); this module never imports them. Queues emails through `email`'s `Mailer` and tells
 * the senders of failed client emails (`EmailFailureNotices`). Reads users
 * through `auth`'s `UserDirectory`. Pushes stored notifications to signed-in devices (F16,
 * ADR 0036) through `push.send` jobs the worker sends, and shows each device's push state in
 * `auth`'s device list through `DevicePushStates`.
 */
@Module({
  imports: [AuthModule, EmailModule],
  controllers: [NotificationsController, PushController],
  providers: [
    NotificationsService,
    NotificationCenter,
    NotificationStream,
    DailyReminders,
    NotificationEmails,
    EmailFailureNotices,
    PushQueue,
    PushService,
    { provide: STREAM_TIMING, useValue: DEFAULT_STREAM_TIMING },
  ],
  exports: [NotificationCenter, DailyReminders, NotificationEmails],
})
export class NotificationsModule {}
